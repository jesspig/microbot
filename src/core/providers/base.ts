/**
 * LLM Provider 基础类型和接口
 * 
 * 定义所有 Provider 必须实现的统一接口。
 */

/** LLM 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 工具调用 */
export interface ToolCall {
  /** 调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/** LLM 消息 */
export interface LLMMessage {
  /** 角色 */
  role: MessageRole;
  /** 内容 */
  content: string;
  /** 工具调用 ID（role=tool 时） */
  toolCallId?: string;
  /** 工具调用列表（role=assistant 时） */
  toolCalls?: ToolCall[];
}

/** LLM 响应 */
export interface LLMResponse {
  /** 文本内容 */
  content: string;
  /** 工具调用列表 */
  toolCalls?: ToolCall[];
  /** 是否包含工具调用 */
  hasToolCalls: boolean;
}

/** 工具定义（LLM 格式） */
export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** OpenAI API 响应格式 */
export interface OpenAIResponse {
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
export interface OpenAIMessage {
  role: string;
  content: string;
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

/**
 * 将 LLMMessage 转换为 OpenAI API 格式
 * 
 * OpenAI API 要求 snake_case 字段名（tool_call_id, tool_calls）
 */
export function toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  return messages.map(msg => {
    const openaiMsg: OpenAIMessage = {
      role: msg.role,
      content: msg.content,
    };

    // 工具调用 ID（role=tool 时必须）
    if (msg.toolCallId) {
      openaiMsg.tool_call_id = msg.toolCallId;
    }

    // 工具调用列表（role=assistant 时）
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

/** Provider 接口 */
export interface LLMProvider {
  /** Provider 名称 */
  readonly name: string;
  
  /**
   * 聊天完成
   * @param messages - 消息历史
   * @param tools - 可用工具列表
   * @param model - 模型名称（可选）
   * @returns LLM 响应
   */
  chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse>;
  
  /**
   * 获取默认模型
   * @returns 默认模型名称
   */
  getDefaultModel(): string;
  
  /**
   * 检查 Provider 是否可用
   * @returns 是否可用
   */
  isAvailable(): Promise<boolean>;
}

/** 解析 OpenAI 格式响应 */
export function parseOpenAIResponse(data: OpenAIResponse): LLMResponse {
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
