/**
 * 记忆存储 - LanceDB 集成
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdir, writeFile, readFile, readdir, unlink, stat } from 'fs/promises';
import { join } from 'path';
import type { MemoryEntry, Summary, MemoryStats, SearchOptions, MemoryFilter } from '../types';
import type { MemoryStoreConfig, CleanupResult, EmbeddingService } from './types';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'store']);

/** 默认配置 */
const DEFAULT_CONFIG: Partial<MemoryStoreConfig> = {
  defaultSearchLimit: 10,
  maxSearchLimit: 50,
  shortTermRetentionDays: 7,
};

/**
 * LanceDB 记录结构
 */
type LanceDBRecord = Record<string, unknown>;

/**
 * 记忆存储
 * 
 * 功能：
 * - 使用 LanceDB 存储向量
 * - 使用 Markdown 存储会话记录
 * - 支持向量检索和全文检索
 */
export class MemoryStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private config: MemoryStoreConfig;
  private initialized = false;

  constructor(config: MemoryStoreConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const storagePath = this.expandPath(this.config.storagePath);

    // 创建目录结构
    await mkdir(join(storagePath, 'sessions'), { recursive: true });
    await mkdir(join(storagePath, 'summaries'), { recursive: true });
    await mkdir(join(storagePath, 'lancedb'), { recursive: true });

    // 连接 LanceDB
    this.db = await lancedb.connect(join(storagePath, 'lancedb'));

    // 创建或打开表
    const tableName = 'memories';
    const tables = await this.db.tableNames();

    if (tables.includes(tableName)) {
      this.table = await this.db.openTable(tableName);
    } else {
      // 创建表，使用示例数据定义 schema
      const sampleRecord: Record<string, unknown> = {
        id: 'placeholder',
        sessionId: 'placeholder',
        type: 'placeholder',
        content: 'placeholder',
        vector: new Array(1536).fill(0), // 默认 OpenAI 嵌入维度
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.table = await this.db.createTable(tableName, [sampleRecord]);
      // 删除占位符
      await this.table.delete('id = "placeholder"');
    }

    this.initialized = true;
    log.info('记忆存储已初始化', { path: storagePath });
  }

  /**
   * 存储记忆条目
   */
  async store(entry: MemoryEntry): Promise<void> {
    await this.ensureInitialized();

    // 存储 Markdown
    await this.storeMarkdown(entry);

    // 存储到 LanceDB
    const vector = entry.vector ?? (await this.getEmbedding(entry.content));
    const record: Record<string, unknown> = {
      id: entry.id,
      sessionId: entry.sessionId,
      type: entry.type,
      content: entry.content,
      vector: vector ?? [],
      metadata: JSON.stringify(entry.metadata),
      createdAt: entry.createdAt.getTime(),
      updatedAt: entry.updatedAt.getTime(),
    };

    await this.table?.add([record]);
    log.debug('记忆已存储', { id: entry.id, type: entry.type });
  }

  /**
   * 搜索记忆
   */
  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    const limit = Math.min(
      options?.limit ?? this.config.defaultSearchLimit!,
      this.config.maxSearchLimit!
    );

    // 有嵌入服务且非全文模式 -> 向量检索
    if (this.config.embeddingService?.isAvailable() && options?.mode !== 'fulltext') {
      return this.vectorSearch(query, limit);
    }

    // 降级为全文检索
    return this.fulltextSearch(query, limit, options?.filter);
  }

  /**
   * 向量检索
   */
  private async vectorSearch(query: string, limit: number): Promise<MemoryEntry[]> {
    if (!this.config.embeddingService?.isAvailable()) {
      return this.fulltextSearch(query, limit);
    }

    const vector = await this.config.embeddingService.embed(query);
    const results = await this.table?.vectorSearch(vector).limit(limit).toArray();

    return (results ?? []).map(r => this.recordToEntry(r));
  }

  /**
   * 全文检索
   */
  private async fulltextSearch(query: string, limit: number, filter?: MemoryFilter): Promise<MemoryEntry[]> {
    // LanceDB FTS 搜索
    let queryBuilder = this.table?.query().limit(limit);

    // 应用过滤条件
    if (filter) {
      const conditions: string[] = [];
      if (filter.sessionId) {
        conditions.push(`sessionId = "${filter.sessionId}"`);
      }
      if (filter.type) {
        conditions.push(`type = "${filter.type}"`);
      }
      if (conditions.length > 0) {
        queryBuilder = queryBuilder?.where(conditions.join(' AND '));
      }
    }

    // 执行搜索
    const results = await queryBuilder?.toArray();
    return (results ?? []).map(r => this.recordToEntry(r));
  }

  /**
   * 获取最近记忆
   */
  async getRecent(sessionId: string, limit: number = 20): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    if (!this.table) return [];

    const results = await this.table
      .query()
      .where(`sessionId = "${sessionId}"`)
      .limit(limit)
      .toArray();

    return results.map(r => this.recordToEntry(r));
  }

  /**
   * 根据 ID 获取记忆
   */
  async getById(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();

    if (!this.table) return null;

    const results = await this.table
      .query()
      .where(`id = "${id}"`)
      .limit(1)
      .toArray();

    const first = results[0];
    return first ? this.recordToEntry(first) : null;
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.table?.delete(`id = "${id}"`);
    log.debug('记忆已删除', { id });
  }

  /**
   * 清除会话记忆
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    await this.table?.delete(`sessionId = "${sessionId}"`);
    log.info('会话记忆已清除', { sessionId });
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<MemoryStats> {
    await this.ensureInitialized();

    const results = await this.table?.query().toArray();
    const entries = results ?? [];

    const sessions = new Set(entries.map(e => e.sessionId as string));
    const timestamps = entries.map(e => e.createdAt as number);

    return {
      totalEntries: entries.length,
      totalSessions: sessions.size,
      totalSize: 0, // 需要单独计算文件大小
      oldestEntry: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
      newestEntry: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
    };
  }

  /**
   * 清理过期记忆
   */
  async cleanupExpired(): Promise<CleanupResult> {
    await this.ensureInitialized();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.shortTermRetentionDays!);
    const cutoffTimestamp = cutoffDate.getTime();

    const results = await this.table?.query().toArray();
    const expired = (results ?? [])
      .filter(r => (r.createdAt as number) < cutoffTimestamp)
      .map(r => r.id as string);

    for (const id of expired) {
      await this.table?.delete(`id = "${id}"`);
    }

    log.info('过期记忆已清理', { count: expired.length });
    return {
      deletedCount: expired.length,
      summarizedCount: 0,
      errors: [],
    };
  }

  // ========== 私有方法 ==========

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private expandPath(path: string): string {
    if (path.startsWith('~')) {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
      return join(home, path.slice(1));
    }
    return path;
  }

  private async storeMarkdown(entry: MemoryEntry): Promise<void> {
    const storagePath = this.expandPath(this.config.storagePath);
    const mdPath = join(storagePath, 'sessions', `${entry.sessionId}.md`);
    const content = this.formatMarkdown(entry);

    try {
      await writeFile(mdPath, content, { flag: 'a' });
    } catch (error) {
      log.warn('Markdown 存储失败', { error: String(error) });
    }
  }

  private formatMarkdown(entry: MemoryEntry): string {
    const frontmatter = `---
id: ${entry.id}
type: ${entry.type}
created: ${entry.createdAt.toISOString()}
tags: ${(entry.metadata.tags ?? []).join(', ')}
---

`;
    return frontmatter + entry.content + '\n\n---\n\n';
  }

  private async getEmbedding(text: string): Promise<number[] | undefined> {
    if (this.config.embeddingService?.isAvailable()) {
      try {
        return await this.config.embeddingService.embed(text);
      } catch (error) {
        log.warn('嵌入生成失败', { error: String(error) });
      }
    }
    return undefined;
  }

  private recordToEntry(record: Record<string, unknown>): MemoryEntry {
    return {
      id: record.id as string,
      sessionId: record.sessionId as string,
      type: record.type as MemoryEntry['type'],
      content: record.content as string,
      vector: Array.isArray(record.vector) && (record.vector as number[]).length > 0 
        ? record.vector as number[] 
        : undefined,
      metadata: typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata as MemoryEntry['metadata'],
      createdAt: new Date(record.createdAt as number),
      updatedAt: new Date(record.updatedAt as number),
    };
  }
}
