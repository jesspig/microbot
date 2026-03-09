/**
 * SDK Config 模块入口
 *
 * 提供配置高级封装功能：
 * - 三级配置加载和合并
 * - 工作区访问控制
 * - 模板文件处理
 * - 配置工具函数
 */

// ============================================================
// 类型定义（从 Agent Service 导出）
// ============================================================
export {
  // Schema
  ConfigSchema,
  AgentConfigSchema,
  ModelsConfigSchema,
  ModelConfigSchema,
  ProviderConfigSchema,
  ChannelConfigSchema,
  WorkspaceConfigSchema,
  MemoryConfigSchema,
  ExecutorConfigSchema,
  LoopDetectionConfigSchema,
  CitationConfigSchema,
  parseModelConfigs,
  parseWorkspaces,
} from './types';

// 类型
export type {
  Config,
  AgentConfig,
  ModelsConfig,
  ModelConfig,
  ProviderConfig,
  ProviderEntry,
  WorkspaceConfig,
  MemoryConfig as RuntimeMemoryConfig,
  ExecutorConfig,
  LoopDetectionConfig,
  CitationConfig,
  KnowledgeBaseConfig as RuntimeKnowledgeBaseConfig,
} from './types';

// ============================================================
// 配置加载器
// ============================================================
export {
  loadConfig,
  getConfigStatus,
  ConfigLevel,
} from './loader';

export type { LoadConfigOptions, ConfigStatus } from './loader';

// ============================================================
// 配置合并器
// ============================================================
export { mergeConfigs, getConfigDiff } from './merger';
export type { ConfigScope, ConfigSource, MergedConfigResult } from './merger';

// ============================================================
// 工具函数
// ============================================================
export {
  deepMerge,
  resolveEnvVars,
  findConfigFile,
  loadConfigFile,
  buildPathChain,
  CONFIG_FILE_NAME,
} from './utils';

// ============================================================
// 默认配置
// ============================================================
export {
  getBuiltinDefaults,
  // 路径常量
  USER_CONFIG_DIR_NAME,
  USER_CONFIG_DIR,
  USER_DATA_DIR,
  USER_LOGS_DIR,
  USER_KNOWLEDGE_DIR,
  USER_MEMORY_DIR,
  USER_WORKSPACE_DIR,
  USER_SESSIONS_DIR,
  USER_SKILLS_DIR,
  USER_EXTENSIONS_DIR,
  // 子路径常量
  KNOWLEDGE_VECTORS_PATH,
  KNOWLEDGE_FTS_DB_PATH,
  SESSIONS_DB_PATH,
  MEMORY_DB_PATH,
  TODO_STORAGE_PATH,
  MEMORY_LOGS_DIR,
  // 默认配置值
  DEFAULT_GENERATION_CONFIG,
  DEFAULT_EXECUTOR_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_MULTI_EMBED_CONFIG,
  DEFAULT_CONTEXT_BUDGET,
} from './defaults';

// ============================================================
// 工作区访问控制
// ============================================================
export {
  validateWorkspaceAccess,
  canAccessWorkspace,
  getUserConfigPath,
  createDefaultUserConfig,
  expandPath,
} from './workspace';

// ============================================================
// 模板文件处理
// ============================================================
export {
  TEMPLATE_FILE_NAMES,
  findTemplateFile,
  loadTemplateFile,
  loadAllTemplateFiles,
} from './template';
