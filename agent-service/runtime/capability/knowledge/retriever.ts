/**
 * 知识库检索器
 *
 * 负责从已索引的知识库中检索相关内容。
 */

import type { KnowledgeDocument, KnowledgeChunk, KnowledgeSearchResult } from './types';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['knowledge', 'retriever']);

/** 检索器配置 */
export interface RetrieverConfig {
  /** 最大检索结果数 */
  maxResults: number;
  /** 最小相似度阈值 */
  minScore: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: RetrieverConfig = {
  maxResults: 5,
  minScore: 0.6,
};

/**
 * 知识库检索器
 *
 * 通过向量相似度检索相关文档块。
 */
export class KnowledgeRetriever {
  private config: RetrieverConfig;

  constructor(
    private documents: Map<string, KnowledgeDocument>,
    private embeddingService?: { embed: (text: string) => Promise<number[]> },
    config?: Partial<RetrieverConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检索相关文档
   */
  async retrieve(query: string): Promise<KnowledgeSearchResult[]> {
    if (!this.embeddingService) {
      log.warn('嵌入服务不可用，无法进行向量检索');
      return [];
    }

    // 生成查询向量
    const queryVector = await this.embeddingService.embed(query);

    // 收集所有文档块
    const allChunks: Array<{ chunk: KnowledgeChunk; doc: KnowledgeDocument }> = [];
    for (const doc of this.documents.values()) {
      if (doc.status !== 'indexed' || !doc.chunks) continue;
      for (const chunk of doc.chunks) {
        allChunks.push({ chunk, doc });
      }
    }

    // 计算相似度并排序
    const results = allChunks
      .map(({ chunk, doc }) => {
        const score = chunk.vector
          ? this.cosineSimilarity(queryVector, chunk.vector)
          : 0;
        return { chunk, doc, score };
      })
      .filter(r => r.score >= this.config.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxResults);

    // 按文档分组
    const grouped = new Map<string, KnowledgeSearchResult>();
    for (const { chunk, doc, score } of results) {
      const existing = grouped.get(doc.id);
      if (existing) {
        existing.chunks.push(chunk);
      } else {
        grouped.set(doc.id, {
          document: doc,
          chunks: [chunk],
          score,
          preview: this.generatePreview(chunk.content),
        });
      }
    }

    log.debug('检索完成', { query: query.slice(0, 50), resultCount: grouped.size });
    return Array.from(grouped.values());
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 生成预览文本
   */
  private generatePreview(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  }
}

/**
 * 创建检索器
 */
export function createRetriever(
  documents: Map<string, KnowledgeDocument>,
  embeddingService?: { embed: (text: string) => Promise<number[]> },
  config?: Partial<RetrieverConfig>
): KnowledgeRetriever {
  return new KnowledgeRetriever(documents, embeddingService, config);
}
