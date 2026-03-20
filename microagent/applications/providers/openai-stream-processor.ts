/**
 * OpenAI 流式响应处理器
 *
 * 负责处理 SSE (Server-Sent Events) 流式数据
 */

import type { ChatResponse, StreamCallback, ToolCall } from "../../runtime/types.js";
import { providersLogger } from "../shared/logger.js";

const logger = providersLogger();
const MODULE_NAME = "OpenAIStreamProcessor";

/** 流式工具调用（带原始参数字符串） */
interface StreamingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** 原始参数字符串（流式累加） */
  _rawArgs?: string;
}

/** 流式处理结果 */
export interface StreamProcessResult {
  /** 完整文本 */
  fullText: string;
  /** 完整思考内容 */
  fullReasoning: string;
  /** 工具调用列表 */
  toolCalls: StreamingToolCall[];
  /** 使用情况 */
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * OpenAI 流式响应处理器
 * 负责处理 SSE 流式数据
 */
export class OpenAIStreamProcessor {
  /** 流式工具调用列表 */
  private toolCalls: StreamingToolCall[] = [];

  /**
   * 处理流式响应
   * @param response - fetch 响应对象
   * @param callback - 流式回调
   * @returns 流式处理结果
   */
  async processStream(
    response: Response,
    callback: StreamCallback
  ): Promise<StreamProcessResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("无法获取响应流");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let fullReasoning = "";
    this.toolCalls = [];
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  reasoning_content?: string;
                  tool_calls?: Array<{
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };
            const delta = json.choices?.[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                this.mergeToolCall(tc);
              }
            }
            if (json.usage) {
              usage = {
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens,
              };
            }

            // 构建回调参数
            const callbackChunk: {
              delta: string;
              text: string;
              done: boolean;
              reasoningDelta?: string;
              reasoning?: string;
            } = {
              delta: delta?.content || "",
              text: fullText,
              done: false,
            };
            if (delta?.reasoning_content !== undefined) {
              callbackChunk.reasoningDelta = delta.reasoning_content;
            }
            if (fullReasoning) {
              callbackChunk.reasoning = fullReasoning;
            }
            await callback(callbackChunk);
          } catch {
            // 忽略 JSON 解析错误（可能是不完整的 chunk）
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      fullText,
      fullReasoning,
      toolCalls: this.toolCalls,
      usage,
    };
  }

  /**
   * 构建最终响应
   * @param result - 流式处理结果
   * @param callback - 流式回调
   * @returns ChatResponse
   */
  async buildFinalResponse(
    result: StreamProcessResult,
    callback: StreamCallback
  ): Promise<ChatResponse> {
    const { fullText, fullReasoning, toolCalls, usage } = result;

    // 发送最终回调
    const finalChunk: {
      delta: string;
      text: string;
      done: boolean;
      reasoning?: string;
      toolCalls?: ToolCall[];
      usage?: { inputTokens: number; outputTokens: number };
    } = {
      delta: "",
      text: fullText,
      done: true,
    };

    if (fullReasoning) {
      finalChunk.reasoning = fullReasoning;
    }

    if (toolCalls.length > 0) {
      finalChunk.toolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc._rawArgs ? this.parseToolArguments(tc._rawArgs) : tc.arguments,
      }));
    }

    if (usage) {
      finalChunk.usage = usage;
    }

    await callback(finalChunk);

    // 构建返回值
    const chatResponse: ChatResponse = {
      text: fullText,
      hasToolCall: toolCalls.length > 0,
    };

    if (fullReasoning) {
      chatResponse.reasoning = fullReasoning;
    }

    if (toolCalls.length > 0) {
      chatResponse.toolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc._rawArgs ? this.parseToolArguments(tc._rawArgs) : tc.arguments,
      }));
    }

    if (usage) {
      chatResponse.usage = usage;
    }

    return chatResponse;
  }

  /**
   * 合并流式工具调用
   * OpenAI 流式返回工具调用时，id 和 arguments 可能分多次返回
   * @param tc - 工具调用片段
   */
  private mergeToolCall(
    tc: { id?: string; function?: { name?: string; arguments?: string } }
  ): void {
    if (tc.id) {
      // 新的工具调用开始
      this.toolCalls.push({
        id: tc.id,
        name: tc.function?.name || "",
        arguments: {},
        _rawArgs: "",
      });
    } else if (this.toolCalls.length > 0 && tc.function?.arguments) {
      // 追加参数到最后一个工具调用
      const last = this.toolCalls[this.toolCalls.length - 1]!;
      last._rawArgs = (last._rawArgs || "") + tc.function.arguments;
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
