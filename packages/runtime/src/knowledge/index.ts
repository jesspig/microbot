/**
 * 知识库模块
 * 
 * 提供独立的文档管理和 RAG 检索能力。
 * 用户可以将文档放入 ~/.micro-agent/knowledge/ 目录，
 * 系统会自动构建向量索引并在需要时检索相关内容。
 */

export * from './types';
export { KnowledgeBaseManager, getKnowledgeBase, setKnowledgeBase } from './manager';

// 默认导出
export { getKnowledgeBase as default } from './manager';
