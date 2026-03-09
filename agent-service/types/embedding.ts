/**
 * 嵌入模型类型定义
 *
 * 支持多嵌入模型并存、动态切换和向量迁移
 */

/** 嵌入模型状态 */
export type EmbeddingModelStatus = 'ready' | 'migrating' | 'error';

/** 迁移任务状态 */
export type MigrationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

/** 嵌入模型配置 */
export interface EmbeddingModel {
  /** 模型唯一标识 */
  id: string;
  /** 提供商 (openai, ollama, etc.) */
  provider: string;
  /** 模型名称 */
  name: string;
  /** 向量维度 */
  dimension: number;
  /** 是否为当前活跃模型 */
  isActive: boolean;
  /** 模型状态 */
  status: EmbeddingModelStatus;
  /** 已存储的向量数量 */
  vectorCount: number;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/** 嵌入向量 */
export interface EmbeddingVector {
  /** 向量唯一标识 */
  id: string;
  /** 关联的记忆 ID */
  memoryId: string;
  /** 关联的模型 ID */
  modelId: string;
  /** 向量数据 */
  vector: number[];
  /** 向量维度 */
  dimension: number;
  /** 是否为活跃向量（用于模型切换时的回退） */
  isActive: boolean;
  /** 创建时间 */
  createdAt: Date;
}

/** 迁移任务配置 */
export interface MigrationConfig {
  /** 每批次处理的数量 */
  batchSize: number;
  /** 批次间隔（毫秒） */
  batchInterval: number;
  /** 是否在错误时停止 */
  stopOnError: boolean;
  /** 最大重试次数 */
  maxRetries: number;
}

/** 向量迁移任务 */
export interface EmbeddingMigration {
  /** 任务唯一标识 */
  id: string;
  /** 源模型 ID */
  sourceModelId: string;
  /** 目标模型 ID */
  targetModelId: string;
  /** 任务状态 */
  status: MigrationStatus;
  /** 总数量 */
  totalCount: number;
  /** 已处理数量 */
  processedCount: number;
  /** 批次大小 */
  batchSize: number;
  /** 配置 */
  config: MigrationConfig;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 创建时间 */
  createdAt: Date;
  /** 错误信息 */
  error?: string;
}

/** 迁移进度 */
export interface MigrationProgress {
  /** 任务 ID */
  migrationId: string;
  /** 状态 */
  status: MigrationStatus;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 总数量 */
  totalCount: number;
  /** 已处理数量 */
  processedCount: number;
  /** 预计剩余时间（秒） */
  estimatedTimeRemaining?: number;
  /** 错误信息 */
  error?: string;
}

/** 嵌入模型切换结果 */
export interface ModelSwitchResult {
  /** 是否成功 */
  success: boolean;
  /** 新模型 ID */
  newModelId: string;
  /** 旧模型 ID */
  oldModelId?: string;
  /** 是否需要迁移 */
  needsMigration: boolean;
  /** 迁移任务 ID（如果需要迁移） */
  migrationId?: string;
  /** 错误信息 */
  error?: string;
}

/** 嵌入模型注册选项 */
export interface EmbeddingModelRegisterOptions {
  /** 提供商 */
  provider: string;
  /** 模型名称 */
  name: string;
  /** 是否设为活跃 */
  setActive?: boolean;
  /** 自定义 ID */
  id?: string;
}

/** 向量检索选项 */
export interface VectorSearchOptions {
  /** 查询向量 */
  vector: number[];
  /** 模型 ID（默认使用活跃模型） */
  modelId?: string;
  /** 返回数量限制 */
  limit?: number;
  /** 最小相似度阈值 */
  minScore?: number;
  /** 是否包含非活跃向量 */
  includeInactive?: boolean;
}
