/**
 * Local Vector Database Provider (内存存储)
 */

import { getLogger } from '@logtape/logtape';
import type { VectorRecord, SearchResult, VectorDBProvider } from './lancedb';

const log = getLogger(['provider', 'vector-db', 'local']);

/** Local Vector 配置 */
export interface LocalVectorConfig {
  /** 向量维度 */
  dimension: number;
  /** Provider 名称 */
  name?: string;
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('向量维度不匹配');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Local Vector Provider (内存存储)
 *
 * 用于开发测试或小规模部署
 */
export class LocalVectorProvider implements VectorDBProvider {
  readonly name: string;
  private records: Map<string, VectorRecord> = new Map();
  private initialized = false;

  constructor(private config: LocalVectorConfig) {
    this.name = config.name ?? 'local-vector';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.records.clear();
    this.initialized = true;
    log.info('Local Vector 初始化完成');
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Local Vector 未初始化');
    }
  }

  async insert(record: VectorRecord): Promise<void> {
    this.ensureInitialized();
    
    if (record.vector.length !== this.config.dimension) {
      throw new Error(`向量维度不匹配: 期望 ${this.config.dimension}, 实际 ${record.vector.length}`);
    }

    this.records.set(record.id, record);
  }

  async insertBatch(records: VectorRecord[]): Promise<void> {
    this.ensureInitialized();
    
    for (const record of records) {
      await this.insert(record);
    }
  }

  async search(vector: number[], limit = 10): Promise<SearchResult[]> {
    this.ensureInitialized();
    
    if (vector.length !== this.config.dimension) {
      throw new Error(`向量维度不匹配: 期望 ${this.config.dimension}, 实际 ${vector.length}`);
    }

    // 计算所有向量的相似度
    const results: SearchResult[] = [];
    
    for (const record of this.records.values()) {
      const score = cosineSimilarity(vector, record.vector);
      results.push({ record, score });
    }

    // 按相似度降序排序
    results.sort((a, b) => b.score - a.score);

    // 返回前 limit 个结果
    return results.slice(0, limit);
  }

  async get(id: string): Promise<VectorRecord | null> {
    this.ensureInitialized();
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.ensureInitialized();
    this.records.delete(id);
  }

  async clear(): Promise<void> {
    this.ensureInitialized();
    this.records.clear();
  }

  async count(): Promise<number> {
    this.ensureInitialized();
    return this.records.size;
  }

  async close(): Promise<void> {
    this.records.clear();
    this.initialized = false;
  }
}

/**
 * 创建 Local Vector Provider
 */
export function createLocalVectorProvider(config: LocalVectorConfig): VectorDBProvider {
  return new LocalVectorProvider(config);
}

// 重新导出类型
export type { VectorRecord, SearchResult, VectorDBProvider } from './lancedb';
