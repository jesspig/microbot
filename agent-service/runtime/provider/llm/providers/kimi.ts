/**
 * Kimi (Moonshot) Provider
 * 
 * 支持 reasoning 参数启用推理，响应中包含 reasoning_details
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { KimiConfig } from './types';
import { supportsThinking } from './types';

export class KimiProvider extends BaseProvider {
  readonly name = 'kimi';
  protected config: KimiConfig;
  
  private defaultReasoning: boolean;

  constructor(config: KimiConfig) {
    super(config);
    this.config = config;
    this.defaultReasoning = config.defaultReasoning ?? false;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    model?: string,
    config?: GenerationConfig
  ): Promise<LLMResponse> {
    if (!model) {
      throw new Error('没有配置模型，请传入 model 参数');
    }
    const body = this.buildRequestBody(messages, tools, model, config);
    
    // Kimi 特有：reasoning 参数
    const useReasoning = config?.enableThinking ?? this.defaultReasoning;
    if (useReasoning || supportsThinking('kimi', model)) {
      body.reasoning = { effort: 'high' };
    }

    const data = await this.sendRequest(body, model);
    return parseAPIResponse(data, 'kimi');
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    const isThinkingModel = supportsThinking('kimi', modelId);
    return {
      vision: modelId.includes('vision') || modelId.includes('v'),
      think: isThinkingModel,
      tool: true,
    };
  }
}

/**
 * 创建 Kimi Provider
 */
export function createKimiProvider(config: Partial<KimiConfig>): KimiProvider {
  return new KimiProvider({
    vendor: 'kimi',
    baseUrl: config.baseUrl ?? 'https://api.moonshot.cn/v1',
    apiKey: config.apiKey,
    defaultReasoning: config.defaultReasoning,
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}
