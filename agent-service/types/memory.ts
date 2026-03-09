/**
 * 记忆类型定义
 */

import type { KnowledgeSourceMetadata } from './knowledge';

/** 记忆类型 */
export type MemoryType =
  | 'preference'
  | 'fact'
  | 'decision'
  | 'entity'
  | 'conversation'
  | 'summary'
  | 'document'
  | 'other';

/** 记忆类型字符串（用于序列化） */
export type MemoryTypeString = MemoryType;

/** 记忆状态 */
export type MemoryStatus = 'active' | 'archived' | 'protected' | 'deleted';

/** 记忆元数据 */
export interface MemoryMetadata extends Partial<KnowledgeSourceMetadata> {
  /** 来源通道 */
  channel?: string;
  /** 提及的实体 */
  entities?: string[];
  /** 标签 */
  tags?: string[];
  /** 重要性评分 (0-1) */
  importance?: number;
  /** 过期时间 */
  expiresAt?: Date;
  /** 分类信息 */
  classification?: {
    confidence: number;
    matchedPatterns: string[];
  };
  /** 原始消息数量（用于摘要） */
  originalMessageCount?: number;
  // ========== 偏好相关字段 ==========
  /** 偏好类型（like/dislike/want/avoid/habit/style） */
  preferenceType?: string;
  /** 偏好主题 */
  subject?: string;
  /** 来源消息 */
  sourceMessage?: string;
}

/** 记忆统计信息 */
export interface MemoryStats {
  /** 总条目数 */
  totalEntries: number;
  /** 总会话数 */
  totalSessions: number;
  /** 总存储大小（字节） */
  totalSize: number;
  /** 最早条目时间 */
  oldestEntry: Date | null;
  /** 最新条目时间 */
  newestEntry: Date | null;
}

/** 记忆条目 */
export interface MemoryEntry {
  /** 记忆 ID */
  id: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 嵌入向量 */
  embedding?: number[];
  /** 创建时间 */
  createdAt: Date;
  /** 最后访问时间 */
  accessedAt: Date;
  /** 访问次数 */
  accessCount: number;
  /** 重要性分数（0-1） */
  importance: number;
  /** 记忆稳定性/强度（0-1），基于 Ebbinghaus 遗忘曲线 */
  stability: number;
  /** 记忆状态 */
  status: MemoryStatus;
  /** 关联的会话键 */
  sessionKey?: string;
  /** 元数据 */
  metadata?: MemoryMetadata;
}

/** 记忆检索结果 */
export interface MemorySearchResult {
  /** 匹配的记忆条目 */
  entry: MemoryEntry;
  /** 相似度分数（0-1） */
  score: number;
}

/** 记忆存储接口 */
export interface MemoryStore {
  /** 存储记忆 */
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): Promise<string>;
  /** 检索记忆 */
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;
  /** 获取记忆 */
  get(id: string): Promise<MemoryEntry | undefined>;
  /** 删除记忆 */
  delete(id: string): Promise<void>;
  /** 更新记忆访问 */
  touch(id: string): Promise<void>;
}

/** 记忆检索选项 */
export interface MemorySearchOptions {
  /** 返回结果数量限制 */
  limit?: number;
  /** 最小相似度阈值 */
  minScore?: number;
  /** 过滤记忆类型 */
  types?: MemoryType[];
  /** 过滤会话键 */
  sessionKey?: string;
  /** 搜索模式 */
  mode?: 'auto' | 'vector' | 'fulltext' | 'hybrid';
  /** 过滤条件 */
  filter?: MemoryFilter;
}

/** 记忆过滤条件 */
export interface MemoryFilter {
  /** 按类型过滤 */
  types?: MemoryType[];
  /** 按会话过滤 */
  sessionKey?: string;
  /** 时间范围 */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
}

/** 记忆管理器配置 */
export interface MemoryManagerConfig {
  /** 是否启用记忆系统 */
  enabled: boolean;
  /** 存储路径 */
  storagePath: string;
  /** 是否启用自动摘要 */
  autoSummarize: boolean;
  /** 触发摘要的消息阈值 */
  summarizeThreshold: number;
  /** 检索结果数量限制 */
  searchLimit: number;
}
