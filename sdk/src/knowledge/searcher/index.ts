/**
 * 检索器模块入口
 */

export {
  KnowledgeSearcher,
  createKnowledgeSearcher,
  KnowledgeSearcherConfigSchema,
  type KnowledgeSearcherConfig,
  type SearchOptions,
  type KnowledgeSearchResult,
  type ChunkVectorRecord,
} from './knowledge-searcher';

export {
  SourceAnnotator,
  createSourceAnnotator,
  type AnnotatedResult,
  type SourceAnnotatorConfig,
} from './source-annotator';
