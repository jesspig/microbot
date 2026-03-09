/**
 * 知识库相关类型定义
 *
 * 此文件定义知识库特定的元数据类型，
 * 与 types/memory.ts 中的通用记忆元数据分离。
 */

/** 知识库来源元数据 */
export interface KnowledgeSourceMetadata {
  /** 文档 ID（知识库来源） */
  documentId?: string;
  /** 文档路径（知识库来源） */
  documentPath?: string;
  /** 文件类型（知识库来源） */
  fileType?: string;
  /** 文档标题 */
  documentTitle?: string;
  /** 分块索引 */
  chunkIndex?: number;
  /** 分块起始位置 */
  chunkStart?: number;
  /** 分块结束位置 */
  chunkEnd?: number;
  /** 相似度分数 */
  score?: number;
  /** 页码 */
  pageNumber?: number;
  /** 章节名称 */
  section?: string;
  /** 置信度 (0-1) */
  confidence?: number;
  /** 字符范围 [start, end] */
  charRange?: [number, number];
}
