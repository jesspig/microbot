/**
 * LLM Provider 模块入口
 */

// Router
export { ModelRouter, createModelRouter } from './router';
export type { ModelRouterConfig, RouteResult, ModelConfig } from './router';

// OpenAI Compatible
export { OpenAICompatibleProvider, createOpenAICompatibleProvider } from './openai';
export type { OpenAICompatibleConfig } from './openai';

// Anthropic
export { AnthropicProvider, createAnthropicProvider } from './anthropic';
export type { AnthropicConfig } from './anthropic';

// Local
export { LocalProvider, createLocalProvider } from './local';
export type { LocalProviderConfig } from './local';

// 重新导出类型
export type { LLMProvider, GenerationConfig, ProviderCapabilities } from '../../../types';
