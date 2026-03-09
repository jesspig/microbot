/**
 * 默认配置定义
 *
 * 集中管理所有默认路径和配置值，避免硬编码分散
 */

import { join } from 'path';
import { homedir } from 'os';

// ============================================================
// 路径常量
// ============================================================

/** 用户配置目录名 */
export const USER_CONFIG_DIR_NAME = '.micro-agent';

/** 用户配置目录（展开后的绝对路径） */
export const USER_CONFIG_DIR = join(homedir(), USER_CONFIG_DIR_NAME);

/** 数据目录 */
export const USER_DATA_DIR = join(USER_CONFIG_DIR, 'data');

/** 日志目录 */
export const USER_LOGS_DIR = join(USER_CONFIG_DIR, 'logs');

/** 知识库目录 */
export const USER_KNOWLEDGE_DIR = join(USER_CONFIG_DIR, 'knowledge');

/** 记忆存储目录 */
export const USER_MEMORY_DIR = join(USER_CONFIG_DIR, 'memory');

/** 工作区目录 */
export const USER_WORKSPACE_DIR = join(USER_CONFIG_DIR, 'workspace');

/** 会话数据目录 */
export const USER_SESSIONS_DIR = join(USER_CONFIG_DIR, 'data');

/** 技能目录 */
export const USER_SKILLS_DIR = join(USER_CONFIG_DIR, 'skills');

/** 扩展目录 */
export const USER_EXTENSIONS_DIR = join(USER_CONFIG_DIR, 'extensions');

// ============================================================
// 子路径常量
// ============================================================

/** 知识库向量数据库路径 */
export const KNOWLEDGE_VECTORS_PATH = join(USER_DATA_DIR, 'knowledge_vectors');

/** 知识库全文搜索数据库路径 */
export const KNOWLEDGE_FTS_DB_PATH = join(USER_DATA_DIR, 'knowledge.db');

/** 会话数据库路径 */
export const SESSIONS_DB_PATH = join(USER_DATA_DIR, 'sessions.db');

/** 记忆数据库路径 */
export const MEMORY_DB_PATH = join(USER_DATA_DIR, 'memory.db');

/** Todo 存储路径 */
export const TODO_STORAGE_PATH = join(USER_CONFIG_DIR, 'todos.json');

/** 内存日志目录 */
export const MEMORY_LOGS_DIR = join(USER_LOGS_DIR, 'memory');

// ============================================================
// 默认配置值
// ============================================================

/** 默认生成配置 */
export const DEFAULT_GENERATION_CONFIG = {
  maxTokens: 512,
  temperature: 0.7,
  topK: 50,
  topP: 0.7,
  frequencyPenalty: 0.5,
} as const;

/** 默认执行器配置 */
export const DEFAULT_EXECUTOR_CONFIG = {
  maxIterations: 20,
} as const;

/** 默认记忆配置 */
export const DEFAULT_MEMORY_CONFIG = {
  enabled: true,
  autoSummarize: true,
  summarizeThreshold: 20,
  idleTimeout: 300000,
  shortTermRetentionDays: 7,
  searchLimit: 10,
} as const;

/** 默认多嵌入模型配置 */
export const DEFAULT_MULTI_EMBED_CONFIG = {
  enabled: true,
  maxModels: 3,
  autoMigrate: true,
  batchSize: 50,
  migrateInterval: 0,
} as const;

/** 默认上下文预算配置 */
export const DEFAULT_CONTEXT_BUDGET = {
  historyTokenBudget: 4000,
  summaryTokenBudget: 500,
} as const;

// ============================================================
// 配置对象
// ============================================================

/**
 * 获取内置默认配置
 */
export function getBuiltinDefaults(): Record<string, unknown> {
  return {
    agents: {
      workspace: USER_WORKSPACE_DIR,
      ...DEFAULT_GENERATION_CONFIG,
      executor: { ...DEFAULT_EXECUTOR_CONFIG },
      memory: {
        ...DEFAULT_MEMORY_CONFIG,
        storagePath: USER_MEMORY_DIR,
        multiEmbed: { ...DEFAULT_MULTI_EMBED_CONFIG },
      },
    },
    providers: {},
    channels: {},
  };
}
