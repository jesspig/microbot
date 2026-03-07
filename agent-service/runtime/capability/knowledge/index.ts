/**
 * 知识库模块入口
 */

// Types
export type {
  KnowledgeDocType,
  KnowledgeDocStatus,
  KnowledgeDocMetadata,
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeSearchResult,
  KnowledgeBaseConfig,
  KnowledgeBaseStats,
} from './types';

export {
  KNOWLEDGE_FILE_EXTENSIONS,
  getKnowledgeDocType,
  isKnowledgeFileSupported,
} from './types';

// Manager
export {
  KnowledgeBaseManager,
  getKnowledgeBase,
  setKnowledgeBase,
} from './manager';

// Retriever
export {
  KnowledgeRetriever,
  createRetriever,
  type RetrieverConfig,
} from './retriever';

// Scanner
export {
  createDocumentScanner,
  type DocumentScanner,
} from './scanner';

// Indexer
export {
  createDocumentIndexer,
  type IndexerConfig,
} from './indexer';

// Extractor
export {
  extractDocumentContent,
  parseCSVContent,
} from './extractor';
