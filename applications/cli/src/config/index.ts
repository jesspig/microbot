/**
 * 配置模块入口
 *
 * 导出配置管理和提示词模板相关的公共 API。
 */

export {
  AppConfig,
  ConfigManager,
  getConfig,
  setConfig,
} from './settings';

export {
  PromptTemplate,
  PromptManager,
  getPromptManager,
  setPromptManager,
} from './prompts';
