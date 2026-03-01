/**
 * 知识库类型定义
 * 
 * 知识库是独立于记忆系统的文档存储，用于存放用户上传的文档和参考资料。
 * 通过 RAG (Retrieval-Augmented Generation) 技术实现智能检索。
 */

/** 知识库文档类型 */
export type KnowledgeDocType =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'code'
  | 'json'
  | 'yaml'
  | 'word'        // Word 文档
  | 'excel'       // Excel 表格
  | 'powerpoint'  // PowerPoint 演示文稿
  | 'csv'         // CSV 表格数据
  | 'xml'         // XML 文档
  | 'rtf';        // 富文本格式

/** 知识库文档状态 */
export type KnowledgeDocStatus = 
  | 'pending'      // 等待处理
  | 'processing'   // 正在构建向量
  | 'indexed'      // 已完成索引
  | 'error';       // 处理失败

/** 知识库文档元数据 */
export interface KnowledgeDocMetadata {
  /** 原始文件名 */
  originalName: string;
  /** 文件类型 */
  fileType: KnowledgeDocType;
  /** 文件大小（字节） */
  fileSize: number;
  /** 文件哈希（用于检测变更） */
  fileHash: string;
  /** 最后修改时间 */
  modifiedAt: number;
  /** 文档标题（从内容提取或文件名） */
  title?: string;
  /** 文档摘要 */
  summary?: string;
  /** 文档标签 */
  tags?: string[];
  /** 文档来源/作者 */
  source?: string;
}

/** 知识库文档 */
export interface KnowledgeDocument {
  /** 唯一标识（格式：doc_<timestamp>_<random>） */
  id: string;
  /** 存储路径（相对于 knowledge 目录） */
  path: string;
  /** 文档内容（原始文本） */
  content: string;
  /** 分块后的内容（用于向量索引） */
  chunks?: KnowledgeChunk[];
  /** 元数据 */
  metadata: KnowledgeDocMetadata;
  /** 处理状态 */
  status: KnowledgeDocStatus;
  /** 错误信息（如果处理失败） */
  error?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 索引完成时间 */
  indexedAt?: number;
}

/** 知识库文档块 */
export interface KnowledgeChunk {
  /** 块ID */
  id: string;
  /** 所属文档ID */
  docId: string;
  /** 块内容 */
  content: string;
  /** 在原文中的起始位置 */
  startPos: number;
  /** 在原文中的结束位置 */
  endPos: number;
  /** 向量嵌入 */
  vector?: number[];
  /** 块元数据 */
  metadata?: {
    /** 所在行号 */
    lineStart?: number;
    lineEnd?: number;
    /** 章节标题（如果是结构化文档） */
    section?: string;
  };
}

/** 知识库检索结果 */
export interface KnowledgeSearchResult {
  /** 文档 */
  document: KnowledgeDocument;
  /** 匹配的块 */
  chunks: KnowledgeChunk[];
  /** 相似度分数 */
  score: number;
  /** 匹配内容预览 */
  preview: string;
}

/** 知识库配置 */
export interface KnowledgeBaseConfig {
  /** 知识库根目录 */
  basePath: string;
  /** 嵌入模型 */
  embedModel?: string;
  /** 分块大小（字符数） */
  chunkSize: number;
  /** 分块重叠（字符数） */
  chunkOverlap: number;
  /** 最大检索结果数 */
  maxSearchResults: number;
  /** 相似度阈值 */
  minSimilarityScore: number;
  /** 后台构建配置 */
  backgroundBuild: {
    /** 是否启用 */
    enabled: boolean;
    /** 构建间隔（毫秒） */
    interval: number;
    /** 每次处理的最大文档数 */
    batchSize: number;
    /** 空闲等待时间（毫秒） */
    idleDelay: number;
  };
}

/** 知识库统计信息 */
export interface KnowledgeBaseStats {
  /** 总文档数 */
  totalDocuments: number;
  /** 已索引文档数 */
  indexedDocuments: number;
  /** 待处理文档数 */
  pendingDocuments: number;
  /** 处理失败文档数 */
  errorDocuments: number;
  /** 总块数 */
  totalChunks: number;
  /** 总存储大小（字节） */
  totalSize: number;
  /** 最后更新时间 */
  lastUpdated: number;
}

/** 后台构建任务状态 */
export interface BackgroundBuildStatus {
  /** 是否正在运行 */
  isRunning: boolean;
  /** 当前处理的文档ID */
  currentDocId?: string;
  /** 已处理文档数 */
  processedCount: number;
  /** 队列中待处理文档数 */
  queueLength: number;
  /** 构建开始时间 */
  startTime?: number;
  /** 上次活动时间 */
  lastActivityTime: number;
  /** 错误信息 */
  error?: string;
}

/** 支持的文件扩展名映射 */
export const KNOWLEDGE_FILE_EXTENSIONS: Record<string, KnowledgeDocType> = {
  // 文档类
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.pdf': 'pdf',
  '.rtf': 'rtf',
  '.xml': 'xml',
  // 数据类
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.csv': 'csv',
  '.tsv': 'csv',
  // Office 文档
  '.doc': 'word',
  '.docx': 'word',
  '.xls': 'excel',
  '.xlsx': 'excel',
  '.ppt': 'powerpoint',
  '.pptx': 'powerpoint',
  // 代码类
  '.js': 'code',
  '.jsx': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.mjs': 'code',
  '.cjs': 'code',
  '.py': 'code',
  '.rs': 'code',
  '.go': 'code',
  '.java': 'code',
  '.kt': 'code',
  '.scala': 'code',
  '.cpp': 'code',
  '.c': 'code',
  '.h': 'code',
  '.hpp': 'code',
  '.cs': 'code',
  '.rb': 'code',
  '.php': 'code',
  '.swift': 'code',
  '.r': 'code',
  '.m': 'code',
  '.mm': 'code',
  '.pl': 'code',
  '.lua': 'code',
  '.vim': 'code',
  '.vimrc': 'code',
  '.html': 'code',
  '.htm': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.sass': 'code',
  '.less': 'code',
  '.styl': 'code',
  '.sql': 'code',
  '.sh': 'code',
  '.bash': 'code',
  '.zsh': 'code',
  '.fish': 'code',
  '.ps1': 'code',
  '.bat': 'code',
  '.cmd': 'code',
};

/** 获取文件类型 */
export function getKnowledgeDocType(filename: string): KnowledgeDocType {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return KNOWLEDGE_FILE_EXTENSIONS[ext] || 'text';
}

/** 检查文件是否受支持 */
export function isKnowledgeFileSupported(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return ext in KNOWLEDGE_FILE_EXTENSIONS;
}
