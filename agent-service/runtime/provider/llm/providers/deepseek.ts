/**
 * DeepSeek Provider
 * 
 * 支持 reasoning_content 思考内容和 thinking 参数
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { DeepSeekConfig } from './types';
import { supportsThinking } from './types';

export class DeepSeekProvider extends BaseProvider {
  readonly name = 'deepseek';
  protected config: DeepSeekConfig;
  
  private defaultThinking: boolean;

  constructor(config: DeepSeekConfig) {
    super(config);
    this.config = config;
    this.defaultThinking = config.defaultThinking ?? false;
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
    
    // DeepSeek 特有：检查是否启用思考模式
    const useThinking = config?.enableThinking ?? this.defaultThinking;
    const isThinkingModel = supportsThinking('deepseek', model);
    
    if (useThinking || isThinkingModel) {
      // deepseek-chat 模型需要显式启用 thinking
      if (model.includes('deepseek-chat')) {
        body.thinking = { type: 'enabled' };
      }
      // deepseek-reasoner 默认启用思考，不需要额外参数
    }

    const data = await this.sendRequest(body, model);
    return parseAPIResponse(data, 'deepseek');
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    const isThinkingModel = supportsThinking('deepseek', modelId);
    return {
      vision: false,
      think: isThinkingModel,
      tool: true,
    };
  }
}

/**
 * 创建 DeepSeek Provider
 */
export function createDeepSeekProvider(config: Partial<DeepSeekConfig>): DeepSeekProvider {
  return new DeepSeekProvider({
    vendor: 'deepseek',
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com/v1',
    apiKey: config.apiKey,
    defaultThinking: config.defaultThinking,
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}
