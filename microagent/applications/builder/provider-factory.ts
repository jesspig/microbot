/**
 * Provider 工厂
 *
 * 负责根据配置创建 Provider 实例
 * 通过 URL 模式匹配自动识别 Provider 类型
 */

import type { IProviderExtended } from "../../runtime/index.js";
import type { Settings } from "../config/index.js";
import { createOpenAIProvider } from "../providers/openai.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createOllamaProvider } from "../providers/ollama.js";
import { createDeepSeekProvider } from "../providers/deepseek.js";
import { createGLMProvider } from "../providers/glm.js";
import { createMoonshotProvider } from "../providers/moonshot.js";
import { createMiniMaxProvider } from "../providers/minimax.js";
import { createOpenRouterProvider } from "../providers/openrouter.js";
import { createNvidiaProvider } from "../providers/nvidia.js";
import { createModelScopeProvider } from "../providers/modelscope.js";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { builderLogger, logMethodCall, logMethodReturn, logMethodError, createTimer } from "../shared/logger.js";

const MODULE_NAME = "ProviderFactory";

export class ProviderConfigError extends Error {
  constructor(
    public readonly providerName: string,
    message: string
  ) {
    super(`Provider "${providerName}" ${message}`);
    this.name = "ProviderConfigError";
  }
}

type ProviderCreator = (config: { name: string; baseUrl: string; apiKey: string; models: string[] }) => IProviderExtended;

interface ProviderMatcher {
  patterns: RegExp[];
  creator: ProviderCreator;
}

const PROVIDER_MATCHERS: ProviderMatcher[] = [
  {
    patterns: [/api\.anthropic\.com/i],
    creator: ({ name, baseUrl, apiKey, models }) => createAnthropicProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/api\.deepseek\.com/i],
    creator: ({ name, baseUrl, apiKey, models }) => createDeepSeekProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/api\.moonshot\.cn/i],
    creator: ({ name, baseUrl, apiKey, models }) => createMoonshotProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/api\.minimax\.chat/i],
    creator: ({ name, baseUrl, apiKey, models }) => createMiniMaxProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/openrouter\.ai/i],
    creator: ({ name, baseUrl, apiKey, models }) => createOpenRouterProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/integrate\.api\.nvidia\.com/i],
    creator: ({ name, baseUrl, apiKey, models }) => createNvidiaProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/api-inference\.modelscope\.cn/i],
    creator: ({ name, baseUrl, apiKey, models }) => createModelScopeProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/open\.bigmodel\.cn/i, /api\.z\.ai/i],
    creator: ({ name, baseUrl, apiKey, models }) => createGLMProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/localhost:11434/i, /ollama/i],
    creator: ({ name, baseUrl, apiKey, models }) => createOllamaProvider({ name, baseUrl, apiKey, models }),
  },
  {
    patterns: [/api\.openai\.com/i],
    creator: ({ name, baseUrl, apiKey, models }) => createOpenAIProvider({ name, baseUrl, apiKey, models }),
  },
];

function matchProviderByUrl(baseUrl: string): ProviderCreator | null {
  for (const matcher of PROVIDER_MATCHERS) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(baseUrl)) {
        return matcher.creator;
      }
    }
  }
  return null;
}

export class ProviderFactory {
  private customProvider: IProviderExtended | null = null;

  withCustomProvider(provider: IProviderExtended): this {
    this.customProvider = provider;
    return this;
  }

  async create(settings: Settings, model?: string): Promise<IProviderExtended> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "create", module: MODULE_NAME });

    try {
      if (this.customProvider) {
        logger.debug("使用自定义 Provider", { hasCustomProvider: true });
        logMethodReturn(logger, { method: "create", module: MODULE_NAME, result: { type: "custom" }, duration: timer() });
        return this.customProvider;
      }

      const providers = settings.providers ?? {};
      const targetModel = model ?? settings.agents?.defaults?.model ?? "";

      // 从模型名解析 provider 名称
      // 格式：<provider>/<model> 或 <provider>/<subprovider>/<model>
      let targetProviderName: string | null = null;
      const firstSlash = targetModel.indexOf("/");
      if (firstSlash > 0) {
        targetProviderName = targetModel.substring(0, firstSlash);
      }

      // 查找 provider 配置
      let selectedProvider: [string, typeof providers[string]] | null = null;

      if (targetProviderName) {
        // 优先使用模型名中指定的 provider
        const config = providers[targetProviderName];
        if (config?.baseUrl || config?.apiKey || (config?.models && config.models.length > 0)) {
          selectedProvider = [targetProviderName, config];
        }
      }

      // 如果模型中没有指定 provider 或配置不存在，选择第一个有 apiKey 的
      if (!selectedProvider) {
        selectedProvider = Object.entries(providers).find(
          ([_, config]) => config?.apiKey
        ) ?? null;
      }

      // 最后兜底：选择第一个有配置的
      if (!selectedProvider) {
        selectedProvider = Object.entries(providers).find(
          ([_, config]) => config?.baseUrl || (config?.models && config.models.length > 0)
        ) ?? null;
      }

      if (!selectedProvider) {
        throw new Error("未找到已配置的 Provider");
      }

      const [providerName, providerConfig] = selectedProvider;

      logger.debug("选择的 Provider", {
        providerName,
        model: targetModel,
      });

      if (!providerConfig) {
        throw new ProviderConfigError(providerName, "配置不存在");
      }

      const baseUrl = providerConfig.baseUrl!;
      const apiKey = providerConfig.apiKey ?? "";
      const models = providerConfig.models ?? [];

      if (!baseUrl) {
        throw new ProviderConfigError(providerName, "缺少 baseUrl 配置");
      }

      const creator = matchProviderByUrl(baseUrl);
      const provider = creator
        ? creator({ name: providerName, baseUrl, apiKey, models })
        : createOpenAICompatibleProvider({ name: providerName, baseUrl, apiKey, models });

      logger.debug("创建 Provider", {
        providerName,
        baseUrl,
        matchedBy: creator ? "url-pattern" : "fallback-openai-compatible",
      });

      logMethodReturn(logger, {
        method: "create",
        module: MODULE_NAME,
        result: { providerName, modelsCount: models.length },
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
}
