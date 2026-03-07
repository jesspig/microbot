/**
 * Local Provider (Ollama/LocalAI Compatible)
 */

import { getLogger } from '@logtape/logtape';
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMToolDefinition,
  GenerationConfig,
  ProviderCapabilities,
} from '../../../types';
import { createLLMProvider, type LLMProviderConfig } from './openai';

const log = getLogger(['provider', 'local']);

/** Local Provider 配置 */
export interface LocalProviderConfig {
  /** 基础 URL (默认: http://localhost:11434/v1 for Ollama) */
  baseUrl?: string;
  /** 默认生成配置 */
  defaultGenerationConfig?: GenerationConfig;
  /** Provider 名称 */
  name?: string;
}

/** 默认 Ollama URL */
const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';

/**
 * Local Provider
 *
 * 支持 Ollama 和其他兼容 OpenAI API 的本地模型服务
 */
export class LocalProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'llm' as const;
  private delegate: LLMProvider;
  private baseUrl: string;

  constructor(config: LocalProviderConfig) {
    this.name = config.name ?? 'local';
    this.baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_URL;
    
    const providerConfig: LLMProviderConfig = {
      baseUrl: this.baseUrl,
      defaultGenerationConfig: config.defaultGenerationConfig,
      vendor: 'ollama',
    };

    this.delegate = createLLMProvider(providerConfig, this.name);
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    model?: string,
    config?: GenerationConfig
  ): Promise<LLMResponse> {
    return this.delegate.chat(messages, tools, model, config);
  }

  getDefaultModel(): string | undefined {
    return this.delegate.getDefaultModel();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace('/v1', '')}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelCapabilities(_modelId: string): ProviderCapabilities {
    // 本地模型通常不支持视觉，支持工具调用取决于模型
    return { vision: false, think: false, tool: true };
  }

  async listModels(): Promise<string[] | null> {
    try {
      // 尝试 Ollama API
      const ollamaUrl = this.baseUrl.replace('/v1', '');
      const response = await fetch(`${ollamaUrl}/api/tags`, {
        method: 'GET',
      });

      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        return data.models?.map(m => m.name) ?? null;
      }

      // 回退到 OpenAI 兼容 API
      return this.delegate.listModels();
    } catch {
      return null;
    }
  }
}

/**
 * 创建 Local Provider
 */
export function createLocalProvider(config: LocalProviderConfig): LLMProvider {
  return new LocalProvider(config);
}
