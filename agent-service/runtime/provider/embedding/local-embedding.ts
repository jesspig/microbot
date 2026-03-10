/**
 * Local Embedding Provider (Ollama Compatible)
 */

import { getLogger } from '@logtape/logtape';
import type { EmbeddingProvider, EmbeddingResult } from './openai-embedding';

const log = getLogger(['provider', 'embedding', 'local']);

/** Local Embedding 配置 */
export interface LocalEmbeddingConfig {
  /** 基础 URL (默认: http://localhost:11434) */
  baseUrl?: string;
  /** 模型名称 (默认: nomic-embed-text) */
  model?: string;
  /** Provider 名称 */
  name?: string;
}

/** 默认配置 */
const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Ollama 模型维度映射 */
const OLLAMA_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
};

/**
 * Local Embedding Provider (Ollama)
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private model: string;
  private baseUrl: string;
  private dimension: number;

  constructor(config: LocalEmbeddingConfig = {}) {
    this.name = config.name ?? 'local-embedding';
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.dimension = OLLAMA_DIMENSIONS[this.model] ?? 768;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    for (const text of texts) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            prompt: text,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama Embedding API 错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json() as { embedding: number[] };
        
        // 更新实际维度
        if (data.embedding?.length) {
          this.dimension = data.embedding.length;
        }

        results.push({ embedding: data.embedding });
      } catch (error) {
        log.error('Embedding 失败: {error}', { error: String(error) });
        throw error;
      }
    }

    return results;
  }

  getDimension(): number {
    return this.dimension;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * 创建 Local Embedding Provider
 */
export function createLocalEmbeddingProvider(config: LocalEmbeddingConfig): EmbeddingProvider {
  return new LocalEmbeddingProvider(config);
}

// 重新导出类型
export type { EmbeddingProvider, EmbeddingResult } from './openai-embedding';
