/**
 * 记忆系统模块入口
 */

// 从类型定义导出
export type {
  MemoryType,
  MemoryTypeString,
  MemoryEntry,
  MemorySearchResult,
  MemorySearchOptions,
  MemoryMetadata,
  MemoryStats,
  MemoryFilter,
} from '../../../types/memory';

// Types
export type {
  VectorColumnName,
  EmbedModelInfo,
  FailedRecord,
  MigrationState,
  MigrationStatus,
  MigrationResult,
  MultiEmbedConfig,
  MemoryStoreConfig,
  SearchMode,
  CleanupResult,
  EmbeddingService,
  SearchOptions,
} from './types';

// Manager
export { MemoryManager, type MemoryManagerConfig } from './manager';

// Store
export { MemoryStore } from './store';

// Embedding
export { OpenAIEmbedding, NoEmbedding, createEmbeddingService } from './embedding';

// Search
export { MemorySearcher } from './search';

// Summarizer
export { ConversationSummarizer, type Summary, type SummarizerConfig } from './summarizer';

// Classifier
export {
  classifyMemory,
  classifyMemoriesBatch,
  getMemoryTypeDescription,
  getMemoryTypeIcon,
  type ClassificationResult,
  type ClassifyOptions,
} from './classifier';
