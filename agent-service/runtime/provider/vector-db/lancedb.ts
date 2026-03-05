/**
 * LanceDB Vector Database Provider
 */

import { getLogger } from '@logtape/logtape';

const log = getLogger(['provider', 'vector-db', 'lancedb']);

/** 向量记录 */
export interface VectorRecord {
  /** 唯一标识 */
  id: string;
  /** 向量数据 */
  vector: number[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 文本内容（用于全文检索） */
  content?: string;
}

/** 搜索结果 */
export interface SearchResult {
  /** 向量记录 */
  record: VectorRecord;
  /** 相似度分数 */
  score: number;
}

/** VectorDB Provider 接口 */
export interface VectorDBProvider {
  /** Provider 名称 */
  readonly name: string;
  /** 初始化数据库 */
  initialize(): Promise<void>;
  /** 插入向量 */
  insert(record: VectorRecord): Promise<void>;
  /** 批量插入向量 */
  insertBatch(records: VectorRecord[]): Promise<void>;
  /** 搜索相似向量 */
  search(vector: number[], limit?: number): Promise<SearchResult[]>;
  /** 根据 ID 获取向量 */
  get(id: string): Promise<VectorRecord | null>;
  /** 根据 ID 删除向量 */
  delete(id: string): Promise<void>;
  /** 清空表 */
  clear(): Promise<void>;
  /** 获取向量数量 */
  count(): Promise<number>;
  /** 关闭连接 */
  close(): Promise<void>;
}

/** LanceDB 配置 */
export interface LanceDBConfig {
  /** 数据库路径 */
  dbPath: string;
  /** 表名 */
  tableName: string;
  /** 向量维度 */
  dimension: number;
}

/**
 * LanceDB Provider
 *
 * 使用 LanceDB 进行向量存储和检索
 */
export class LanceDBProvider implements VectorDBProvider {
  readonly name = 'lancedb';
  private db: Awaited<ReturnType<typeof import('@lancedb/lancedb').connect>> | null = null;
  private table: Awaited<ReturnType<typeof this.db['openTable']>> | null = null;
  private initialized = false;

  constructor(private config: LanceDBConfig) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const lancedb = await import('@lancedb/lancedb');
      this.db = await lancedb.connect(this.config.dbPath);
      
      // 尝试打开已存在的表，否则创建新表
      try {
        this.table = await this.db.openTable(this.config.tableName);
      } catch {
        // 表不存在，创建空表
        const emptyData = [{
          id: '__placeholder__',
          vector: new Array(this.config.dimension).fill(0),
          metadata: {},
          content: '',
        }];
        this.table = await this.db.createTable(this.config.tableName, emptyData);
        // 删除占位记录
        await this.table?.delete('id = "__placeholder__"');
      }
      
      this.initialized = true;
      log.info('LanceDB 初始化完成: {path}', { path: this.config.dbPath });
    } catch (error) {
      log.error('LanceDB 初始化失败: {error}', { error: String(error) });
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized || !this.table) {
      await this.initialize();
    }
  }

  async insert(record: VectorRecord): Promise<void> {
    await this.ensureInitialized();
    await this.table!.add([{
      id: record.id,
      vector: record.vector,
      metadata: record.metadata ?? {},
      content: record.content ?? '',
    }]);
  }

  async insertBatch(records: VectorRecord[]): Promise<void> {
    await this.ensureInitialized();
    const data = records.map(r => ({
      id: r.id,
      vector: r.vector,
      metadata: r.metadata ?? {},
      content: r.content ?? '',
    }));
    await this.table!.add(data);
  }

  async search(vector: number[], limit = 10): Promise<SearchResult[]> {
    await this.ensureInitialized();
    
    const results = await this.table!
      .vectorSearch(vector)
      .limit(limit)
      .toArray();

    return results.map((r: { id: string; vector: number[]; metadata?: Record<string, unknown>; content?: string; _distance?: number }) => ({
      record: {
        id: r.id,
        vector: r.vector,
        metadata: r.metadata,
        content: r.content,
      },
      score: r._distance ?? 0,
    }));
  }

  async get(id: string): Promise<VectorRecord | null> {
    await this.ensureInitialized();
    
    const results = await this.table!
      .query()
      .where(`id = "${id}"`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;

    const r = results[0] as { id: string; vector: number[]; metadata?: Record<string, unknown>; content?: string };
    return {
      id: r.id,
      vector: r.vector,
      metadata: r.metadata,
      content: r.content,
    };
  }

  async delete(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.table!.delete(`id = "${id}"`);
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    // 删除所有记录
    await this.table!.delete('id != "__never_match__"');
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.table!.countRows();
  }

  async close(): Promise<void> {
    if (this.db) {
      // LanceDB 没有显式的 close 方法，直接清空引用
      this.db = null;
      this.table = null;
      this.initialized = false;
    }
  }
}

/**
 * 创建 LanceDB Provider
 */
export function createLanceDBProvider(config: LanceDBConfig): VectorDBProvider {
  return new LanceDBProvider(config);
}
