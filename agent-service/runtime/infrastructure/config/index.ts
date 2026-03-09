/**
 * Config 模块入口
 *
 * 从 SDK 重新导出高级配置功能，保留基础类型定义
 */

// ============================================================
// Schema - 基础类型定义（保留在 Agent Service）
// ============================================================
export {
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
} from './schema';

export type {
  Config,
  AgentConfig,
  ModelsConfig,
  ModelConfig,
  ProviderConfig,
  ProviderEntry,
  WorkspaceConfig,
  MemoryConfig,
  ExecutorConfig,
  LoopDetectionConfig,
  CitationConfig,
} from './schema';

// ============================================================
// 高级功能（从 SDK 重新导出）
// ============================================================

// Loader
export {
  loadConfig,
  getConfigStatus,
  ConfigLevel,
} from '../../../../sdk/src/config/loader';
export type { LoadConfigOptions, ConfigStatus } from '../../../../sdk/src/config/loader';

// Merger
export { mergeConfigs, getConfigDiff } from '../../../../sdk/src/config/merger';
export type { ConfigScope, ConfigSource, MergedConfigResult } from '../../../../sdk/src/config/merger';

// Utils
export {
  deepMerge,
  resolveEnvVars,
  findConfigFile,
  loadConfigFile,
  buildPathChain,
  CONFIG_FILE_NAME,
} from '../../../../sdk/src/config/utils';

// Defaults
export {
  getBuiltinDefaults,
  USER_CONFIG_DIR,
} from '../../../../sdk/src/config/defaults';

// Workspace
export {
  validateWorkspaceAccess,
  canAccessWorkspace,
  getUserConfigPath,
  createDefaultUserConfig,
  expandPath,
} from '../../../../sdk/src/config/workspace';

// Template
export {
  TEMPLATE_FILE_NAMES,
  findTemplateFile,
  loadTemplateFile,
  loadAllTemplateFiles,
} from '../../../../sdk/src/config/template';
