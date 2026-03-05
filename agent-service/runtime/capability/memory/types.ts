/**
 * 记忆系统类型定义
 */

/** 向量列名（动态生成格式：vector_<provider>_<model>） */
export type VectorColumnName = `vector_${string}_${string}`;

/** 嵌入模型信息 */
export interface EmbedModelInfo {
  /** 模型 ID（格式：<provider>/<model>） */
  modelId: string;
  /** 向量列名 */
  vectorColumn: VectorColumnName;
  /** 向量维度 */
  dimension: number;
  /** 使用此模型的记录数 */
  recordCount: number;
}

/** 失败记录信息 */
export interface FailedRecord {
  /** 记录 ID */
  id: string;
  /** 错误信息 */
  error: string;
  /** 失败时间戳 */
  timestamp: number;
}

/** 迁移状态 */
export interface MigrationState {
  /** 目标模型 ID */
  targetModel: string;
  /** 迁移状态 */
  status: 'running' | 'paused' | 'completed' | 'error' | 'idle';
  /** 已迁移到的最早时间戳 */
  migratedUntil?: number;
  /** 总记录数 */
  totalRecords: number;
  /** 已迁移记录数 */
  migratedCount: number;
  /** 批次大小 */
  batchSize: number;
  /** 失败记录列表 */
  failedRecords: FailedRecord[];
  /** 迁移开始时间 */
  startedAt?: number;
  /** 迁移结束时间 */
  completedAt?: number;
}

/** 迁移状态查询结果 */
export interface MigrationStatus {
  /** 迁移状态 */
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  /** 目标模型 ID */
  targetModel?: string;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 已迁移记录数 */
  migratedCount: number;
  /** 总记录数 */
  totalRecords: number;
  /** 失败记录数 */
  failedCount: number;
}

/** 迁移启动结果 */
export interface MigrationResult {
  /** 是否成功启动 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 当前状态 */
  status?: MigrationStatus;
}

/** 多嵌入模型配置 */
export interface MultiEmbedConfig {
  /** 是否启用多嵌入模型支持 */
  enabled: boolean;
  /** 最大保留模型数 */
  maxModels: number;
  /** 是否自动迁移 */
  autoMigrate: boolean;
  /** 迁移批次大小 */
  batchSize: number;
  /** 迁移间隔（毫秒） */
  migrateInterval: number;
}

/** 记忆存储配置 */
export interface MemoryStoreConfig {
  /** 存储路径 */
  storagePath: string;
  /** 嵌入服务实例 */
  embeddingService?: EmbeddingService;
  /** 当前使用的嵌入模型 ID */
  embedModel?: string;
  /** 多嵌入模型配置 */
  multiEmbed?: MultiEmbedConfig;
  /** 向量维度（可选，默认自动检测） */
  vectorDimension?: number;
  /** 默认检索数量限制 */
  defaultSearchLimit?: number;
  /** 最大检索数量限制 */
  maxSearchLimit?: number;
  /** 短期记忆保留天数 */
  shortTermRetentionDays?: number;
}

/** 搜索模式 */
export type SearchMode = 'auto' | 'vector' | 'fulltext' | 'hybrid';

/** 清理结果 */
export interface CleanupResult {
  /** 删除条目数 */
  deletedCount: number;
  /** 摘要条目数 */
  summarizedCount: number;
  /** 错误列表 */
  errors: string[];
}

/** 嵌入服务接口 */
export interface EmbeddingService {
  /** 检查服务是否可用 */
  isAvailable(): boolean;
  /** 生成单个文本的嵌入向量 */
  embed(text: string): Promise<number[]>;
  /** 批量生成嵌入向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** 记忆过滤条件 */
export interface MemoryFilter {
  /** 按类型过滤 */
  types?: import('../../../types/memory').MemoryType[];
  /** 按会话过滤 */
  sessionKey?: string;
  /** 时间范围 */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
}

/** 搜索选项 */
export interface SearchOptions {
  /** 返回结果数量限制 */
  limit?: number;
  /** 最小相似度阈值 */
  minScore?: number;
  /** 过滤条件 */
  filter?: MemoryFilter;
  /** 搜索模式 */
  mode?: SearchMode;
}
