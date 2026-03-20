/**
 * Provider 工厂
 *
 * 负责创建 Provider 实例
 */

import type { IProviderExtended } from "../../runtime/index.js";
import type { Settings } from "../config/index.js";
import { createOpenAIProvider } from "../providers/openai.js";
import { createOpenAIResponseProvider } from "../providers/openai-response.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createOllamaProvider } from "../providers/ollama.js";
import { builderLogger, logMethodCall, logMethodReturn, logMethodError, createTimer } from "../shared/logger.js";

const MODULE_NAME = "ProviderFactory";

/**
 * Provider 配置验证错误
 */
export class ProviderConfigError extends Error {
  constructor(
    public readonly providerName: string,
    message: string
  ) {
    super(`Provider "${providerName}" ${message}`);
    this.name = "ProviderConfigError";
  }
}

/**
 * Provider 工厂
 * 负责创建 Provider 实例
 */
export class ProviderFactory {
  /** 自定义 Provider */
  private customProvider: IProviderExtended | null = null;

  /**
   * 设置自定义 Provider
   * @param provider - Provider 实例
   */
  withCustomProvider(provider: IProviderExtended): this {
    this.customProvider = provider;
    return this;
  }

  /**
   * 创建 Provider 实例
   * @param settings - 配置对象
   * @param model - 模型名称（可选）
   * @returns Provider 实例
   */
  async create(settings: Settings, model?: string): Promise<IProviderExtended> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "create", module: MODULE_NAME });

    try {
      // 使用自定义 Provider
      if (this.customProvider) {
        logger.debug("使用自定义 Provider", { hasCustomProvider: true });
        logMethodReturn(logger, { method: "create", module: MODULE_NAME, result: { type: "custom" }, duration: timer() });
        return this.customProvider;
      }

      const providers = settings.providers ?? {};
      const targetModel = model ?? settings.agents?.defaults?.model ?? "";

      // 解析模型名中的 provider 前缀
      const slashIndex = targetModel.indexOf("/");
      let targetProviderName: string | null = null;

      if (slashIndex >= 0) {
        targetProviderName = targetModel.substring(0, slashIndex);
      }

      // 根据 provider 前缀或默认选择 Provider
      let selectedProvider: [string, typeof providers[string]] | null = null;

      if (targetProviderName) {
        // 模型名包含 provider 前缀，直接查找该 provider
        const config = providers[targetProviderName];
        if (!config) {
          throw new ProviderConfigError(targetProviderName, `不存在于 providers 配置中（模型: ${targetModel}）`);
        }
        if (!config.enabled) {
          throw new ProviderConfigError(targetProviderName, `未启用，请设置 providers.${targetProviderName}.enabled: true`);
        }
        selectedProvider = [targetProviderName, config];
      } else {
        // 模型名不含 provider 前缀，选择第一个启用的 provider
        const enabledProvider = Object.entries(providers).find(
          ([_, config]) => config?.enabled === true
        );
        if (!enabledProvider) {
          throw new Error("未找到已启用的 Provider 配置");
        }
        selectedProvider = enabledProvider;
      }

      const [providerName, providerConfig] = selectedProvider;

      if (!providerConfig) {
        throw new ProviderConfigError(providerName, "配置不存在");
      }

      // 验证必填字段
      this.validateProviderConfig(providerName, providerConfig);

      logger.debug("创建 Provider", { providerName, type: providerConfig.type });

      // 根据 type 字段创建对应的 Provider
      const provider = this.createProviderByName(providerName, providerConfig);

      logMethodReturn(logger, {
        method: "create",
        module: MODULE_NAME,
        result: { providerName, type: providerConfig.type, modelsCount: providerConfig.models.length },
        duration: timer(),
      });

      return provider;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "create",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 验证 Provider 配置
   * @param providerName - Provider 名称
   * @param config - Provider 配置
   * @throws ProviderConfigError 配置无效时
   */
  private validateProviderConfig(providerName: string, config: {
    baseUrl?: string;
    models?: string[];
  }): void {
    if (!config.baseUrl) {
      throw new ProviderConfigError(providerName, "缺少 baseUrl 配置");
    }
    if (!config.models || config.models.length === 0) {
      throw new ProviderConfigError(providerName, "缺少 models 配置");
    }
  }

  /**
   * 根据 Provider 类型创建实例
   * @param providerName - Provider 名称
   * @param providerConfig - Provider 配置
   * @returns Provider 实例
   */
  private createProviderByName(
    providerName: string,
    providerConfig: { type: string; baseUrl: string; apiKey?: string; models: string[] }
  ): IProviderExtended {
    switch (providerConfig.type) {
      case "openai":
        return createOpenAIProvider({
          name: providerName,
          displayName: providerName,
          baseUrl: providerConfig.baseUrl,
          ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
          models: providerConfig.models,
        });

      case "openai-response":
        return createOpenAIResponseProvider({
          name: providerName,
          displayName: providerName,
          baseUrl: providerConfig.baseUrl,
          ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
          models: providerConfig.models,
        });

      case "anthropic":
        return createAnthropicProvider({
          name: providerName,
          displayName: providerName,
          baseUrl: providerConfig.baseUrl,
          ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
          models: providerConfig.models,
        });

      case "ollama":
        return createOllamaProvider({
          baseUrl: providerConfig.baseUrl,
          models: providerConfig.models,
        });

      default:
        throw new ProviderConfigError(providerName, `未知的 Provider 类型: ${providerConfig.type}`);
    }
  }
}
