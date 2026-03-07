/**
 * OpenAI Compatible Provider
 * 
 * 通用 OpenAI 兼容 API 提供商
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { OpenAICompatibleConfig } from './types';

export class OpenAICompatibleProvider extends BaseProvider {
  readonly name = 'openai-compatible';
  protected config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
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
    const body = this.buildRequestBody(messages, tools, model, config);
    
    // 通用 OpenAI 兼容格式
    // 如果需要支持思考内容，尝试提取常见的思考标签
    const data = await this.sendRequest(body, model);
    const response = parseAPIResponse(data, 'openai-compatible');
    
    // 尝试提取思考内容
    if (!response.reasoning && response.content) {
      // 支持多种思考标签格式
      const patterns = [
        /<think>([\s\S]*?)<\/think>/,
        /<thinking>([\s\S]*?)<\/thinking>/,
        /<reasoning>([\s\S]*?)<\/reasoning>/,
      ];
      
      for (const pattern of patterns) {
        const match = response.content.match(pattern);
        if (match) {
          response.reasoning = match[1].trim();
          response.content = response.content.replace(pattern, '').trim();
          break;
        }
      }
    }

    return response;
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    // 通用提供商，假设支持所有功能
    return {
      vision: modelId.includes('vision') || modelId.includes('v'),
      think: modelId.includes('think') || modelId.includes('reason') || modelId.includes('r1'),
      tool: true,
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
 * 创建 OpenAI Compatible Provider
 */
export function createOpenAICompatibleProvider(config: Partial<OpenAICompatibleConfig>): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    vendor: 'openai-compatible',
    baseUrl: config.baseUrl ?? 'http://localhost:8000/v1',
    apiKey: config.apiKey,
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}