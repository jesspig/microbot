/**
 * OpenAI 响应解析器
 *
 * 负责解析 OpenAI API 响应
 */

import type { ChatResponse, ToolCall } from "../../runtime/types.js";
import { providersLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";

const logger = providersLogger();
const MODULE_NAME = "OpenAIResponseParser";

/** OpenAI 标准响应格式 */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      /** 思考内容（OpenAI o1 等推理模型） */
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 非标准错误响应格式（如部分国内平台） */
export interface OpenAINonStandardError {
  status?: string | number;
  msg?: string;
}

/**
 * OpenAI 响应解析器
 * 负责解析 OpenAI API 响应
 */
export class OpenAIResponseParser {
  /** 配置名称（用于错误消息） */
  private readonly configName: string;

  constructor(configName: string) {
    this.configName = configName;
  }

  /**
   * 解析响应
   * @param response - OpenAI 响应
   * @returns ChatResponse
   */
  parseResponse(response: OpenAIResponse): ChatResponse {
    const timer = createTimer();
    logMethodCall(logger, { method: "parseResponse", module: MODULE_NAME });

    try {
      this.validateResponse(response);

      const choice = response.choices[0];
      if (!choice) {
        throw new Error(`${this.configName} API 返回空响应`);
      }

      const message = choice.message;
      const toolCalls: ToolCall[] | undefined = message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.parseToolArguments(tc.function.arguments),
      }));

      const result: ChatResponse = {
        text: message.content ?? "",
        hasToolCall: !!toolCalls?.length,
      };

      // 提取思考内容（OpenAI o1、DeepSeek 等推理模型）
      if (message.reasoning_content) {
        result.reasoning = message.reasoning_content;
      }

      if (toolCalls?.length) result.toolCalls = toolCalls;
      if (response.usage) {
        result.usage = {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        };
      }

      result.raw = response;

      logMethodReturn(logger, {
        method: "parseResponse",
        module: MODULE_NAME,
        result: { hasToolCall: result.hasToolCall, hasReasoning: !!result.reasoning },
        duration: timer(),
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logMethodError(logger, {
        method: "parseResponse",
        module: MODULE_NAME,
        error: { name: err.name, message: err.message },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 验证响应格式
   * @param json - 待验证的 JSON 对象
   * @returns 是否为有效的 OpenAI 响应
   */
  isValidOpenAIResponse(json: unknown): json is OpenAIResponse {
    if (typeof json !== "object" || json === null) {
      return false;
    }

    const obj = json as Record<string, unknown>;
    return Array.isArray(obj.choices);
  }

  /**
   * 检查是否为非标准错误响应
   * @param json - JSON 对象
   * @returns 是否为非标准错误响应
   */
  isNonStandardError(json: unknown): json is OpenAINonStandardError {
    return (
      typeof json === "object" &&
      json !== null &&
      "status" in json &&
      "msg" in json &&
      !("choices" in json)
    );
  }

  /**
   * 验证并转换 OpenAI 响应
   * @param json - JSON 对象
   * @returns OpenAI 响应
   * @throws 如果响应格式无效
   */
  validateOpenAIResponse(json: unknown): OpenAIResponse {
    if (typeof json !== "object" || json === null) {
      throw new Error(`${this.configName} API 返回无效响应格式`);
    }

    const obj = json as Record<string, unknown>;
    if (!Array.isArray(obj.choices)) {
      throw new Error(`${this.configName} API 返回非标准格式响应，请检查 baseUrl 是否正确`);
    }

    return json as OpenAIResponse;
  }

  /**
   * 验证响应
   * @param response - OpenAI 响应
   * @throws 如果响应格式无效
   */
  private validateResponse(response: OpenAIResponse): void {
    if (!response.choices || !Array.isArray(response.choices)) {
      throw new Error(`${this.configName} API 返回非标准格式响应，请检查 baseUrl 是否正确`);
    }
  }

  /**
   * 解析工具参数
   * @param args - 参数字符串
   * @returns 解析后的参数对象
   */
  private parseToolArguments(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }
}
