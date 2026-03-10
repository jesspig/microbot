/**
 * Ollama Provider
 * 
 * 本地 LLM 服务，OpenAI 兼容格式
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { OllamaConfig } from './types';
import { supportsThinking } from './types';

export class OllamaProvider extends BaseProvider {
  readonly name = 'ollama';
  protected config: OllamaConfig;

  constructor(config: OllamaConfig) {
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
    
    // Ollama 思考模型支持（DeepSeek-R1 等）
    // Ollama 会自动处理思考内容，通常在 <think></think> 标签中
    const data = await this.sendRequest(body, model);
    const response = parseAPIResponse(data, 'ollama');
    
    // Ollama 思考模型可能在 content 中包含 <think> 标签
    // 需要提取出来作为 reasoning
    if (!response.reasoning && response.content) {
      const thinkMatch = response.content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        response.reasoning = thinkMatch[1].trim();
        response.content = response.content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
      }
    }

    return response;
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    const isThinkingModel = supportsThinking('ollama', modelId);
    return {
      vision: modelId.includes('vision') || modelId.includes('llava'),
      think: isThinkingModel,
      tool: true,
    };
  }

  async listModels(): Promise<string[] | null> {
    try {
      // Ollama 有 /api/tags 端点列出模型
      const tagsUrl = this.config.baseUrl.replace('/v1', '/api/tags');
      const response = await fetch(tagsUrl);
      if (!response.ok) return null;
      
      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map(m => m.name) ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * 创建 Ollama Provider
 */
export function createOllamaProvider(config: Partial<OllamaConfig>): OllamaProvider {
  return new OllamaProvider({
    vendor: 'ollama',
    baseUrl: config.baseUrl ?? 'http://localhost:11434/v1',
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}