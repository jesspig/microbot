/**
 * GLM (智谱) Provider
 * 
 * 支持 enable_cot 参数启用思维链
 */

import type { LLMMessage, LLMResponse } from '../../../../types/message';
import type { LLMToolDefinition } from '../../../../types/tool';
import type { GenerationConfig, ProviderCapabilities } from '../../../../types/provider';
import { BaseProvider, parseAPIResponse } from './base';
import type { GLMConfig } from './types';
import { supportsThinking } from './types';

export class GLMProvider extends BaseProvider {
  readonly name = 'glm';
  protected config: GLMConfig;
  
  private defaultEnableCot: boolean;

  constructor(config: GLMConfig) {
    super(config);
    this.config = config;
    this.defaultEnableCot = config.defaultEnableCot ?? false;
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
    
    // GLM 特有：enable_cot 参数
    const useCot = config?.enableThinking ?? this.defaultEnableCot;
    if (useCot || supportsThinking('glm', model)) {
      body.enable_cot = true;
    }

    const data = await this.sendRequest(body, model);
    return parseAPIResponse(data, 'glm');
  }

  getModelCapabilities(modelId: string): ProviderCapabilities {
    const isThinkingModel = supportsThinking('glm', modelId);
    return {
      vision: modelId.includes('vision') || modelId.includes('v'),
      think: isThinkingModel,
      tool: true,
    };
  }
}

/**
 * 创建 GLM Provider
 */
export function createGLMProvider(config: Partial<GLMConfig>): GLMProvider {
  return new GLMProvider({
    vendor: 'glm',
    baseUrl: config.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: config.apiKey,
    defaultEnableCot: config.defaultEnableCot,
    defaultGenerationConfig: config.defaultGenerationConfig,
  });
}
