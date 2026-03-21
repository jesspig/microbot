/**
 * Provider 创建和验证模块
 *
 * 负责根据配置创建 LLM Provider 实例
 */

import type { Settings } from "../../../config/loader.js";
import type { SingleProviderConfig } from "../../../config/schema.js";
import type { IProviderExtended } from "../../../../runtime/provider/contract.js";
import { createOpenAIProvider, createAnthropicProvider } from "../../../providers/index.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "ProviderSetup";

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

  if (!config.models || config.models.length === 0) {
    errors.push("models 未配置");
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

  // 解析模型名中的 provider 前缀
  const slashIndex = model.indexOf("/");
  let targetProviderName: string | null = null;

  if (slashIndex >= 0) {
    targetProviderName = model.substring(0, slashIndex);
  }

  let selectedProvider: [string, SingleProviderConfig] | null = null;

  if (targetProviderName) {
    // 模型名包含 provider 前缀，直接查找该 provider
    const config = providers[targetProviderName];
    if (!config) {
      logger.error("Provider 未找到", { targetProviderName, model });
      logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
      return null;
    }
    if (!config.enabled) {
      logger.error("Provider 未启用", { targetProviderName, model });
      logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
      return null;
    }
    selectedProvider = [targetProviderName, config];
  } else {
    // 模型名不含 provider 前缀，选择第一个启用的 provider
    const enabledProvider = Object.entries(providers).find(
      ([_, config]) => config?.enabled === true
    );
    if (!enabledProvider) {
      logger.warn("未找到启用的 Provider");
      logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
      return null;
    }
    selectedProvider = enabledProvider;
  }

  const [providerName, providerConfig] = selectedProvider;

  if (!providerConfig) {
    logger.warn("Provider 配置为空", { providerName });
    logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
    return null;
  }

  const validation = validateProviderConfig(providerName, providerConfig);
  if (!validation.valid) {
    logger.warn("Provider 配置验证失败", { providerName, errors: validation.errors });
    logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: null, duration: timer() });
    return null;
  }

  try {
    let provider: IProviderExtended;
    switch (providerName) {
      case "openai": {
        provider = createOpenAIProvider({
          name: providerName,
          apiKey: providerConfig.apiKey!,
          baseUrl: providerConfig.baseUrl!,
          models: providerConfig.models!,
        });
        break;
      }

      case "anthropic": {
        provider = createAnthropicProvider({
          name: providerName,
          apiKey: providerConfig.apiKey!,
          baseUrl: providerConfig.baseUrl!,
          models: providerConfig.models!,
        });
        break;
      }

      default: {
        provider = createOpenAIProvider({
          name: providerName,
          apiKey: providerConfig.apiKey!,
          baseUrl: providerConfig.baseUrl!,
          models: providerConfig.models!,
        });
        break;
      }
    }

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
