/**
 * 知识库混合检索器
 *
 * 高级封装：整合向量检索和全文检索的知识库检索接口。
 */

import * as lancedb from '@lancedb/lancedb';
import { Database } from 'bun:sqlite';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { getLogger } from '@logtape/logtape';
import type { KnowledgeChunk, KnowledgeDocument } from '../types';
import type { EmbeddingServiceProvider } from '../types';
import { SourceAnnotator, type AnnotatedResult } from './source-annotator';
import {
  KNOWLEDGE_VECTORS_PATH,
  KNOWLEDGE_FTS_DB_PATH,
} from '../../config/defaults';

const log = getLogger(['sdk', 'knowledge', 'searcher']);

/** 检索配置 Schema */
export const KnowledgeSearcherConfigSchema = z.object({
  /** 向量数据库路径 */
  vectorDbPath: z.string().optional(),
  /** 向量表名 */
  vectorTableName: z.string().default('knowledge_chunks'),
  /** FTS 数据库路径 */
  ftsDbPath: z.string().optional(),
  /** FTS 表名 */
  ftsTableName: z.string().default('knowledge_fts'),
  /** 默认检索结果数 */
  defaultLimit: z.number().min(1).max(100).default(10),
  /** 最小相似度阈值 */
  minScore: z.number().min(0).max(1).default(0.5),
  /** 向量检索权重（RRF） */
  vectorWeight: z.number().min(0).max(2).default(1.0),
  /** 全文检索权重（RRF） */
  fulltextWeight: z.number().min(0).max(2).default(0.8),
  /** RRF 常数 K */
  rrfK: z.number().min(1).default(60),
});

/** 检索配置类型 */
export type KnowledgeSearcherConfig = z.infer<typeof KnowledgeSearcherConfigSchema>;

/** 检索选项 */
export interface SearchOptions {
  /** 返回结果数 */
  limit?: number;
  /** 最小相似度 */
  minScore?: number;
  /** 文档类型过滤 */
  docTypes?: string[];
  /** 文档路径过滤 */
  docPaths?: string[];
  /** 检索模式 */
  mode?: 'hybrid' | 'vector' | 'fulltext';
}

/** 检索结果 */
export interface KnowledgeSearchResult {
  /** 分块 ID */
  chunkId: string;
  /** 文档 ID */
  docId: string;
  /** 分块内容 */
  content: string;
  /** 相似度分数 */
  score: number;
  /** 来源标注 */
  source: AnnotatedResult;
  /** 检索来源 */
  retrievedBy: ('vector' | 'fulltext')[];
}

/** 分块向量记录（用于 LanceDB） */
export interface ChunkVectorRecord {
  id: string;
  docId: string;
  content: string;
  vector: number[];
}

/**
 * 知识库混合检索器
 *
 * 功能：
 * - 向量语义检索
 * - 全文关键词检索
 * - RRF 结果融合
 * - 来源标注
 */
export class KnowledgeSearcher {
  private config: Required<
    Pick<KnowledgeSearcherConfig, 'vectorDbPath' | 'vectorTableName' | 'ftsDbPath' | 'ftsTableName' | 'defaultLimit' | 'minScore' | 'vectorWeight' | 'fulltextWeight' | 'rrfK'>
  >;
  private vectorDb: lancedb.Connection | null = null;
  private vectorTable: lancedb.Table | null = null;
  private ftsDb: Database | null = null;
  private sourceAnnotator: SourceAnnotator;
  private initialized = false;

  constructor(
    config?: Partial<KnowledgeSearcherConfig>,
    private embeddingService?: EmbeddingServiceProvider,
    private documentProvider?: () => Map<string, KnowledgeDocument>
  ) {
    const parsed = KnowledgeSearcherConfigSchema.parse(config ?? {});
    this.config = {
      vectorDbPath: parsed.vectorDbPath ?? KNOWLEDGE_VECTORS_PATH,
      vectorTableName: parsed.vectorTableName,
      ftsDbPath: parsed.ftsDbPath ?? KNOWLEDGE_FTS_DB_PATH,
      ftsTableName: parsed.ftsTableName,
      defaultLimit: parsed.defaultLimit,
      minScore: parsed.minScore,
      vectorWeight: parsed.vectorWeight,
      fulltextWeight: parsed.fulltextWeight,
      rrfK: parsed.rrfK,
    };
    this.sourceAnnotator = new SourceAnnotator();
  }

  /**
   * 初始化检索器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // 初始化向量数据库
      await mkdir(this.config.vectorDbPath, { recursive: true });
      this.vectorDb = await lancedb.connect(this.config.vectorDbPath);

      const tables = await this.vectorDb.tableNames();
      if (tables.includes(this.config.vectorTableName)) {
        this.vectorTable = await this.vectorDb.openTable(this.config.vectorTableName);
      }

      // 初始化 FTS 数据库
      this.ftsDb = new Database(join(this.config.ftsDbPath, 'knowledge_fts.db'));
      this.ensureFTSTable();

      this.initialized = true;
      log.info('知识库检索器已初始化');
    } catch (error) {
      log.error('知识库检索器初始化失败', { error: String(error) });
      throw error;
    }
  }

  /**
   * 执行检索
   * @param query - 查询文本
   * @param options - 检索选项
   * @returns 检索结果
   */
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<KnowledgeSearchResult[]> {
    await this.ensureInitialized();

    const {
      limit = this.config.defaultLimit,
      minScore = this.config.minScore,
      mode = 'hybrid',
      docTypes,
      docPaths,
    } = options;

    let results: KnowledgeSearchResult[] = [];

    switch (mode) {
      case 'vector':
        results = await this.vectorSearch(query, limit * 2, minScore);
        break;
      case 'fulltext':
        results = this.fulltextSearch(query, limit * 2, minScore);
        break;
      case 'hybrid':
      default:
        results = await this.hybridSearch(query, limit, minScore);
        break;
    }

    // 应用过滤
    if (docTypes && docTypes.length > 0) {
      results = results.filter(r => docTypes.includes(r.source.docType));
    }
    if (docPaths && docPaths.length > 0) {
      results = results.filter(r => docPaths.some(p => r.source.docPath.includes(p)));
    }

    // 标注来源
    const documents = this.documentProvider?.() ?? new Map();
    for (const result of results) {
      result.source = this.sourceAnnotator.annotate(
        result.chunkId,
        result.docId,
        result.content,
        documents
      );
    }

    log.debug('知识库检索完成', {
      query: query.slice(0, 50),
      mode,
      resultCount: results.length,
    });

    return results.slice(0, limit);
  }

  /**
   * 向量检索
   */
  private async vectorSearch(
    query: string,
    limit: number,
    minScore: number
  ): Promise<KnowledgeSearchResult[]> {
    if (!this.embeddingService?.isAvailable() || !this.vectorTable) {
      log.warn('向量检索不可用');
      return [];
    }

    try {
      const queryVector = await this.embeddingService.embed(query);
      const results = await this.vectorTable
        .vectorSearch(queryVector)
        .limit(limit)
        .toArray() as ChunkVectorRecord[];

      return results
        .map((r, index) => ({
          chunkId: r.id,
          docId: r.docId,
          content: r.content,
          score: 1 - (index * 0.01), // 简化的分数计算
          source: {} as AnnotatedResult,
          retrievedBy: ['vector'] as ('vector' | 'fulltext')[],
        }))
        .filter(r => r.score >= minScore);
    } catch (error) {
      log.warn('向量检索失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 全文检索
   */
  private fulltextSearch(
    query: string,
    limit: number,
    minScore: number
  ): KnowledgeSearchResult[] {
    if (!this.ftsDb) {
      return [];
    }

    try {
      const stmt = this.ftsDb.prepare(`
        SELECT 
          id,
          docId,
          content,
          bm25(${this.config.ftsTableName}) as score
        FROM ${this.config.ftsTableName}
        WHERE ${this.config.ftsTableName} MATCH ?
        ORDER BY score ASC
        LIMIT ?
      `);

      const rows = stmt.all(query, limit) as Array<{
        id: string;
        docId: string;
        content: string;
        score: number;
      }>;

      return rows
        .map(r => ({
          chunkId: r.id,
          docId: r.docId,
          content: r.content,
          score: -r.score, // BM25 返回负分
          source: {} as AnnotatedResult,
          retrievedBy: ['fulltext'] as ('vector' | 'fulltext')[],
        }))
        .filter(r => r.score >= minScore);
    } catch (error) {
      log.warn('全文检索失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 混合检索（RRF 融合）
   */
  private async hybridSearch(
    query: string,
    limit: number,
    minScore: number
  ): Promise<KnowledgeSearchResult[]> {
    // 并行执行两种检索
    const [vectorResults, ftsResults] = await Promise.all([
      this.vectorSearch(query, limit * 2, 0),
      Promise.resolve(this.fulltextSearch(query, limit * 2, 0)),
    ]);

    // RRF 融合
    const rrfScores = new Map<string, { result: KnowledgeSearchResult; score: number }>();

    // 计算向量检索的 RRF 分数
    vectorResults.forEach((result, index) => {
      const rrfScore = this.config.vectorWeight / (this.config.rrfK + index + 1);
      const existing = rrfScores.get(result.chunkId);
      if (existing) {
        existing.score += rrfScore;
        existing.result.retrievedBy.push('vector');
      } else {
        rrfScores.set(result.chunkId, {
          result: { ...result, retrievedBy: ['vector'] },
          score: rrfScore,
        });
      }
    });

    // 计算全文检索的 RRF 分数
    ftsResults.forEach((result, index) => {
      const rrfScore = this.config.fulltextWeight / (this.config.rrfK + index + 1);
      const existing = rrfScores.get(result.chunkId);
      if (existing) {
        existing.score += rrfScore;
        if (!existing.result.retrievedBy.includes('fulltext')) {
          existing.result.retrievedBy.push('fulltext');
        }
      } else {
        rrfScores.set(result.chunkId, {
          result: { ...result, retrievedBy: ['fulltext'] },
          score: rrfScore,
        });
      }
    });

    // 排序并过滤
    const fusedResults = Array.from(rrfScores.values())
      .map(({ result, score }) => ({
        ...result,
        score,
      }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score);

    return fusedResults;
  }

  /**
   * 索引分块（用于 FTS）
   */
  indexChunk(chunk: KnowledgeChunk, doc: KnowledgeDocument): void {
    if (!this.ftsDb) return;

    const stmt = this.ftsDb.prepare(`
      INSERT OR REPLACE INTO ${this.config.ftsTableName} (id, docId, content, docType, docPath)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.id,
      chunk.docId,
      chunk.content,
      doc.metadata.fileType,
      doc.path
    );
  }

  /**
   * 批量索引
   */
  indexChunks(chunks: Array<{ chunk: KnowledgeChunk; doc: KnowledgeDocument }>): void {
    if (!this.ftsDb) return;

    const stmt = this.ftsDb.prepare(`
      INSERT OR REPLACE INTO ${this.config.ftsTableName} (id, docId, content, docType, docPath)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = this.ftsDb.transaction(() => {
      for (const { chunk, doc } of chunks) {
        stmt.run(
          chunk.id,
          chunk.docId,
          chunk.content,
          doc.metadata.fileType,
          doc.path
        );
      }
    });

    transaction();
    log.debug('FTS 批量索引完成', { count: chunks.length });
  }

  /**
   * 删除文档索引
   */
  deleteDocumentIndex(docId: string): void {
    if (!this.ftsDb) return;

    this.ftsDb.run(`DELETE FROM ${this.config.ftsTableName} WHERE docId = ?`, [docId]);
    log.debug('文档 FTS 索引已删除', { docId });
  }

  /**
   * 获取统计
   */
  getStats(): { vectorCount: number; ftsCount: number } {
    let vectorCount = 0;
    let ftsCount = 0;

    // 向量数量 - LanceDB countRows 返回的是 Promise
    if (this.vectorTable) {
      try {
        const count = this.vectorTable.countRows();
        if (typeof count === 'number') {
          vectorCount = count;
        } else if (count && typeof (count as any).then === 'function') {
          vectorCount = 0;
        }
      } catch {
        vectorCount = 0;
      }
    }

    // FTS 数量
    if (this.ftsDb) {
      try {
        const row = this.ftsDb.prepare(`SELECT COUNT(*) as count FROM ${this.config.ftsTableName}`).get() as { count: number } | null;
        ftsCount = row?.count ?? 0;
      } catch {
        ftsCount = 0;
      }
    }

    return { vectorCount, ftsCount };
  }

  /**
   * 关闭检索器
   */
  close(): void {
    this.ftsDb?.close();
    this.vectorDb = null;
    this.vectorTable = null;
    this.ftsDb = null;
    this.initialized = false;
    log.info('知识库检索器已关闭');
  }

  /**
   * 设置嵌入服务
   */
  setEmbeddingService(service: EmbeddingServiceProvider): void {
    this.embeddingService = service;
  }

  /**
   * 设置文档提供者
   */
  setDocumentProvider(provider: () => Map<string, KnowledgeDocument>): void {
    this.documentProvider = provider;
  }

  // ========== 私有方法 ==========

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private ensureFTSTable(): void {
    if (!this.ftsDb) return;

    this.ftsDb.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.config.ftsTableName} USING fts5(
        id,
        docId,
        content,
        docType,
        docPath,
        tokenize='unicode61'
      )
    `);
  }
}

/**
 * 创建知识库检索器
 */
export function createKnowledgeSearcher(
  config?: Partial<KnowledgeSearcherConfig>,
  embeddingService?: EmbeddingServiceProvider,
  documentProvider?: () => Map<string, KnowledgeDocument>
): KnowledgeSearcher {
  return new KnowledgeSearcher(config, embeddingService, documentProvider);
}
