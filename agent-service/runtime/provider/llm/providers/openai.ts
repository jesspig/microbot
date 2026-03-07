/**
 * OpenAI Provider
 * 
 * 支持 o1/o3 系列推理模型
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { OpenAIConfig } from './types';
import { supportsThinking } from './types';

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai';
  protected config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    super(config);
    this.config = config;
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
    const isThinkingModel = supportsThinking('openai', model);
    
    // 构建请求体
    const body = this.buildRequestBody(messages, tools, model, config);
    
    // o1/o3 系列模型特殊处理
    if (isThinkingModel) {
      // o1 系列不支持某些参数
      delete body.temperature;
      delete body.top_p;
      delete body.frequency_penalty;
      
      // o1 系列工具调用支持有限
      if (model.includes('o1-preview') || model.includes('o1-mini')) {
        delete body.tools;
        delete body.tool_choice;
      }
      
      // 使用 reasoning_effort 参数
      if (config?.enableThinking !== false) {
        body.reasoning_effort = 'high';
      }
    }

    const data = await this.sendRequest(body, model);
    return parseAPIResponse(data, 'openai');
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    const isThinkingModel = supportsThinking('openai', modelId);
    const isVisionModel = modelId.includes('vision') || 
                          modelId.includes('gpt-4o') || 
                          modelId.includes('gpt-4-turbo');
    
    return {
      vision: isVisionModel,
      think: isThinkingModel,
      tool: !modelId.includes('o1-preview') && !modelId.includes('o1-mini'),
    };
  }

  async listModels(): Promise<string[] | null> {
    try {
      const url = `${this.config.baseUrl}/models`;
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }
      
      const response = await fetch(url, { headers });
      if (!response.ok) return null;
      
      const data = await response.json() as { data?: Array<{ id: string }> };
      return data.data?.map(m => m.id) ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * 创建 OpenAI Provider
 */
export function createOpenAIProvider(config: Partial<OpenAIConfig>): OpenAIProvider {
  return new OpenAIProvider({
    vendor: 'openai',
    baseUrl: config.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: config.apiKey,
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}
