/**
 * MiniMax Provider
 * 
 * 支持 thinking 和 reasoning_details
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { MiniMaxConfig } from './types';
import { supportsThinking } from './types';

export class MiniMaxProvider extends BaseProvider {
  readonly name = 'minimax';
  protected config: MiniMaxConfig;

  constructor(config: MiniMaxConfig) {
    super(config);
    this.config = config;
  }

  protected buildRequestBody(
    messages: LLMMessage[],
    tools: LLMToolDefinition[] | undefined,
    model: string,
    config: GenerationConfig | undefined
  ): Record<string, unknown> {
    const body = super.buildRequestBody(messages, tools, model, config);
    
    // MiniMax 特有：groupId 参数
    if (this.config.groupId) {
      body.group_id = this.config.groupId;
    }

    return body;
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
    
    // MiniMax M2 系列支持 thinking
    if (config?.enableThinking || supportsThinking('minimax', model)) {
      body.thinking = { type: 'enabled' };
    }

    const data = await this.sendRequest(body, model);
    return parseAPIResponse(data, 'minimax');
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    const isThinkingModel = supportsThinking('minimax', modelId);
    return {
      vision: false,
      think: isThinkingModel,
      tool: true,
    };
  }
}

/**
 * 创建 MiniMax Provider
 */
export function createMiniMaxProvider(config: Partial<MiniMaxConfig>): MiniMaxProvider {
  return new MiniMaxProvider({
    vendor: 'minimax',
    baseUrl: config.baseUrl ?? 'https://api.minimax.chat/v1',
    apiKey: config.apiKey,
    groupId: config.groupId,
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}
