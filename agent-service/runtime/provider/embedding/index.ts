/**
 * Embedding Provider 模块入口
 */

// OpenAI
export { OpenAIEmbeddingProvider, createOpenAIEmbeddingProvider } from './openai-embedding';
export type { OpenAIEmbeddingConfig } from './openai-embedding';

// Local
export { LocalEmbeddingProvider, createLocalEmbeddingProvider } from './local-embedding';
export type { LocalEmbeddingConfig } from './local-embedding';

// 重新导出接口类型
export type { EmbeddingProvider, EmbeddingResult } from './openai-embedding';
