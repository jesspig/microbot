/**
 * OpenAI Compatible Provider
 */

import { getLogger } from '@logtape/logtape';
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMToolDefinition,
  GenerationConfig,
  ProviderCapabilities,
  ContentPart,
} from '../../types';

const log = getLogger(['provider', 'openai']);

/** OpenAI 文本内容部分 */
interface OpenAITextContentPart {
  type: 'text';
  text: string;
}

/** OpenAI 消息内容部分 */
type OpenAIContentPart = OpenAITextContentPart | { type: 'image_url'; image_url: { url: string } };

/** OpenAI API 响应格式 */
interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

/** OpenAI API 消息格式 */
interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[];
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/** OpenAI Compatible 配置 */
export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  /** 默认生成配置 */
  defaultGenerationConfig?: GenerationConfig;
}

/** 默认生成配置 */
const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  maxTokens: 8192,
  temperature: 0.7,
  topK: 50,
  topP: 0.7,
  frequencyPenalty: 0.5,
};

/**
 * 将 ContentPart 转换为 OpenAI 格式
 */
function toOpenAIContentPart(part: ContentPart): OpenAIContentPart {
  // OpenAI URL 格式直接返回
  if (part.type === 'image_url') {
    return part;
  }
  // 文本格式
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  // base64 图片格式
  if (part.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${part.mimeType};base64,${part.data}` },
    };
  }
  // resource 类型转换为文本描述
  return { type: 'text', text: `Resource: ${(part as { uri: string }).uri}` };
}

/**
 * 将 LLMMessage 转换为 OpenAI API 格式
 */
function toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  return messages.map(msg => {
    // 转换内容格式
    let openaiContent: string | OpenAIContentPart[];
    if (typeof msg.content === 'string') {
      openaiContent = msg.content;
    } else {
      openaiContent = msg.content.map(toOpenAIContentPart);
    }

    const openaiMsg: OpenAIMessage = {
      role: msg.role,
      content: openaiContent,
    };

    if (msg.toolCallId) {
      openaiMsg.tool_call_id = msg.toolCallId;
    }

    if (msg.toolCalls?.length) {
      openaiMsg.tool_calls = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    return openaiMsg;
  });
}

/** 解析 OpenAI 格式响应 */
function parseOpenAIResponse(data: OpenAIResponse): LLMResponse {
  const choice = data.choices[0];
  if (!choice) {
    return { content: '', hasToolCalls: false };
  }

  const toolCalls = choice.message.tool_calls?.map(tc => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }));

  return {
    content: choice.message.content || '',
    toolCalls,
    hasToolCalls: !!toolCalls?.length,
  };
}

/**
 * OpenAI Compatible Provider
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'llm' as const;
  private generationConfig: GenerationConfig;

  constructor(
    private config: OpenAICompatibleConfig,
    name?: string
  ) {
    this.name = name ?? 'openai-compatible';
    this.generationConfig = { ...DEFAULT_GENERATION_CONFIG, ...config.defaultGenerationConfig };
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    model?: string,
    config?: GenerationConfig
  ): Promise<LLMResponse> {
    const modelName = model ?? this.config.defaultModel;
    const genConfig = { ...this.generationConfig, ...config };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: modelName,
      messages: toOpenAIMessages(messages),
    };

    if (genConfig.maxTokens !== undefined) {
      body.max_tokens = genConfig.maxTokens;
    }
    if (genConfig.temperature !== undefined) {
      body.temperature = genConfig.temperature;
    }
    if (genConfig.topP !== undefined) {
      body.top_p = genConfig.topP;
    }
    if (genConfig.frequencyPenalty !== undefined) {
      body.frequency_penalty = genConfig.frequencyPenalty;
    }
    if (genConfig.topK !== undefined) {
      body.top_k = genConfig.topK;
    }

    // 始终传递 tools 参数（如果有的话）
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json() as OpenAIResponse;
    return parseOpenAIResponse(data);
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getModelCapabilities(_modelId: string): ProviderCapabilities {
    // 默认支持工具调用，不支持视觉和思考
    return { vision: false, think: false, tool: true };
  }

  async listModels(): Promise<string[] | null> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) return null;

      const data = await response.json() as { data?: Array<{ id: string }> };
      if (!data.data || !Array.isArray(data.data)) return null;

      return data.data.map(m => m.id);
    } catch {
      return null;
    }
  }
}

/**
 * 创建 OpenAI Compatible Provider
 */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig, name?: string): LLMProvider {
  return new OpenAICompatibleProvider(config, name);
}
