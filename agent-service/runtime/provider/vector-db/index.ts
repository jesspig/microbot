/**
 * VectorDB Provider 模块入口
 */

// LanceDB
export { LanceDBProvider, createLanceDBProvider } from './lancedb';
export type { LanceDBConfig } from './lancedb';

// Local Vector
export { LocalVectorProvider, createLocalVectorProvider } from './local-vector';
export type { LocalVectorConfig } from './local-vector';

// 重新导出接口类型
export type { VectorDBProvider, VectorRecord, SearchResult } from './lancedb';
