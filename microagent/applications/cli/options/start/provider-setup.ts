/**
 * Provider 创建和验证模块
 *
 * 负责根据配置创建 LLM Provider 实例
 * 通过 URL 模式匹配自动识别 Provider 类型
 */

import type { Settings } from "../../../config/loader.js";
import type { SingleProviderConfig } from "../../../config/schema.js";
import type { IProviderExtended } from "../../../../runtime/provider/contract.js";
import {
  createOpenAIProvider,
  createAnthropicProvider,
  createOllamaProvider,
  createDeepSeekProvider,
  createGLMProvider,
  createMoonshotProvider,
  createMiniMaxProvider,
  createOpenRouterProvider,
  createNvidiaProvider,
  createModelScopeProvider,
  createOpenAICompatibleProvider,
} from "../../../providers/index.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "ProviderSetup";

type ProviderCreator = (config: { name: string; baseUrl: string; apiKey: string; models: string[] }) => IProviderExtended;

interface ProviderMatcher {
  patterns: RegExp[];
  creator: ProviderCreator;
}

const PROVIDER_MATCHERS: ProviderMatcher[] = [
  { patterns: [/api\.anthropic\.com/i], creator: createAnthropicProvider },
  { patterns: [/api\.deepseek\.com/i], creator: createDeepSeekProvider },
  { patterns: [/api\.moonshot\.cn/i], creator: createMoonshotProvider },
  { patterns: [/api\.minimax\.chat/i], creator: createMiniMaxProvider },
  { patterns: [/openrouter\.ai/i], creator: createOpenRouterProvider },
  { patterns: [/integrate\.api\.nvidia\.com/i], creator: createNvidiaProvider },
  { patterns: [/api-inference\.modelscope\.cn/i], creator: createModelScopeProvider },
  { patterns: [/open\.bigmodel\.cn/i, /api\.z\.ai/i], creator: createGLMProvider },
  { patterns: [/localhost:11434/i, /ollama/i], creator: createOllamaProvider },
  { patterns: [/api\.openai\.com/i], creator: createOpenAIProvider },
];

function matchProviderByUrl(baseUrl: string): ProviderCreator {
  for (const matcher of PROVIDER_MATCHERS) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(baseUrl)) {
        return matcher.creator;
      }
    }
  }
  return createOpenAICompatibleProvider;
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 验证 Provider 配置完整性
 */
export function validateProviderConfig(
  _name: string,
  config: SingleProviderConfig
): { valid: boolean; errors: string[] } {
  const timer = createTimer();
  logMethodCall(logger, { method: "validateProviderConfig", module: MODULE_NAME, params: {} });

  const errors: string[] = [];

  if (!config.baseUrl) {
    errors.push("baseUrl 未配置");
  }

  const result = { valid: errors.length === 0, errors };
  logMethodReturn(logger, { method: "validateProviderConfig", module: MODULE_NAME, result: { valid: result.valid, errorCount: errors.length }, duration: timer() });
  return result;
}

/**
 * 创建 Provider 实例
 */
export function createProvider(settings: Settings): IProviderExtended | null {
  const timer = createTimer();
  logMethodCall(logger, { method: "createProvider", module: MODULE_NAME, params: {} });

  const providers = settings.providers ?? {};
  const model = settings.agents?.defaults?.model ?? "";

  const slashIndex = model.indexOf("/");
  let targetProviderName: string | null = null;

  if (slashIndex >= 0) {
    targetProviderName = model.substring(0, slashIndex);
  }

  let selectedProvider: [string, SingleProviderConfig] | null = null;

  if (targetProviderName) {
    const config = providers[targetProviderName];
    if (config) {
      selectedProvider = [targetProviderName, config];
    }
  }

  if (!selectedProvider) {
    selectedProvider = Object.entries(providers).find(
      ([_, config]) => config?.apiKey || config?.baseUrl
    ) ?? null;
  }

  if (!selectedProvider) {
    logger.warn("未找到已配置的 Provider");
    logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
    return null;
  }

  const [providerName, providerConfig] = selectedProvider;

  if (!providerConfig) {
    logger.warn("Provider 配置为空", { providerName });
    logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
    return null;
  }

  if (!providerConfig.baseUrl) {
    logger.warn("Provider baseUrl 未配置", { providerName });
    logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
    return null;
  }

  try {
    const apiKey = providerConfig.apiKey ?? "";
    const models = providerConfig.models ?? [];

    const creator = matchProviderByUrl(providerConfig.baseUrl);
    const provider = creator({
      name: providerName,
      baseUrl: providerConfig.baseUrl,
      apiKey,
      models,
    });

    logger.info("Provider 创建成功", { providerName, baseUrl: providerConfig.baseUrl });
    logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: { providerName }, duration: timer() });
    return provider;
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "createProvider",
      module: MODULE_NAME,
      error: { name: error.name, message: error.message },
      params: { providerName },
      duration: timer(),
    });
    return null;
  }
}
