/**
 * Anthropic Provider 实现
 *
 * 支持 Anthropic Claude 原生 Messages API
 * 文档：https://docs.anthropic.com/
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback, StreamChunk, ToolCall } from "../../runtime/types.js";

const logger = providersLogger();

export interface ThinkingConfig {
  type: "enabled";
  budget_tokens: number;
}

export interface ToolChoiceConfig {
  type: "tool";
  name: string;
}

export interface AnthropicProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  thinking?: ThinkingConfig;
  stopSequences?: string[];
  forceTool?: string;
  capabilities?: Partial<ProviderCapabilities>;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | unknown };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export class AnthropicProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly thinking: ThinkingConfig | undefined;
  private readonly stopSequences: string[] | undefined;
  private readonly forceTool: string | undefined;
  private readonly retryBaseDelay = 1000;

  constructor(options: AnthropicProviderOptions = {}) {
    super();

    this.name = options.name ?? "anthropic";
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    const models = options.models ?? [];

    this.config = {
      id: this.name,
      name: options.displayName ?? "Anthropic Claude",
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: true,
      supportsPromptCaching: true,
      maxContextTokens: 200000,
      toolSchemaMode: "anthropic",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 120000;
    this.maxRetries = options.maxRetries ?? 3;
    this.thinking = options.thinking;
    this.stopSequences = options.stopSequences;
    this.forceTool = options.forceTool;
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "AnthropicProvider",
      params: { model, messageCount: messages.length, hasTools: !!tools?.length },
    });

    if (!model && this.config.models.length === 0) {
      throw new Error(`Provider "${this.name}" 未配置模型，且请求中未指定模型`);
    }

    try {
      const actualModel = model || this.config.models[0]!;
      const body = this.buildRequestBody(actualModel, messages, tools, temperature, maxTokens);

      logger.info("LLM调用", {
        provider: this.name,
        model: actualModel,
        endpoint: "messages",
        stream: false,
      });

      const response = await this.requestWithRetry(`${this.baseUrl}/messages`, body);
      this.recordUsage();
      const result = this.parseResponse(response);

      logger.info("LLM响应", {
        provider: this.name,
        text: result.text.substring(0, 200),
      });

      logMethodReturn(logger, { method: "chat", module: "AnthropicProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "AnthropicProvider",
        error: { name: error.name, message: error.message },
        params: { model },
        duration: timer(),
      });
      throw error;
    }
  }

  async streamChat(request: ChatRequest, callback: StreamCallback): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "streamChat",
      module: "AnthropicProvider",
      params: { model, messageCount: messages.length, hasTools: !!tools?.length },
    });

    if (!model && this.config.models.length === 0) {
      throw new Error(`Provider "${this.name}" 未配置模型，且请求中未指定模型`);
    }

    const actualModel = model || this.config.models[0]!;
    const body = this.buildRequestBody(actualModel, messages, tools, temperature, maxTokens, true);

    logger.info("LLM调用", {
      provider: this.name,
      model: actualModel,
      endpoint: "messages",
      stream: true,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as AnthropicErrorResponse | null;
        throw new Error(`Anthropic API 错误: ${errBody?.error?.message || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法获取响应流");

      const decoder = new TextDecoder();
      let fullText = "";
      let fullThinking = "";
      let usageReported = false;
      const toolCalls: ToolCall[] = [];
      let currentToolCall: { id: string; name: string; input: string } | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;

            if (event.type === "message_start" && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens ?? 0;
            }

            if (event.type === "content_block_delta") {
              const delta = event.delta;
              if (!delta) continue;

              if (delta.type === "text_delta" && delta.text) {
                fullText += delta.text;
                await callback({
                  delta: delta.text,
                  text: fullText,
                  done: false,
                });
              } else if (delta.type === "thinking_delta" && delta.thinking) {
                fullThinking += delta.thinking;
              } else if (delta.type === "input_json_delta" && currentToolCall) {
                currentToolCall.input += delta.partial_json ?? "";
              }
            } else if (event.type === "content_block_start") {
              const block = event.content_block;
              if (!block) continue;

              if (block.type === "thinking") {
                // 开始思考块
              } else if (block.type === "tool_use" && block.id && block.name) {
                currentToolCall = {
                  id: block.id,
                  name: block.name,
                  input: "",
                };
              } else if (block.type === "text") {
                // 开始文本块
              }
            } else if (event.type === "content_block_stop") {
              if (currentToolCall) {
                try {
                  toolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: JSON.parse(currentToolCall.input),
                  });
                } catch {
                  toolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: { raw: currentToolCall.input },
                  });
                }
                currentToolCall = null;
              }
            } else if (event.type === "message_delta" && event.usage) {
              outputTokens = event.usage.output_tokens ?? 0;
              if (event.usage) {
                usageReported = true;
                this.recordUsage();
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      if (!usageReported) {
        this.recordUsage();
      }

      const result: ChatResponse = {
        text: fullText,
        hasToolCall: toolCalls.length > 0,
        usage: {
          inputTokens,
          outputTokens,
        },
      };

      if (toolCalls.length > 0) result.toolCalls = toolCalls;
      if (fullThinking) result.reasoning = fullThinking;

      const finalChunk: StreamChunk = {
        delta: "",
        text: fullText,
        done: true,
      };
      if (toolCalls.length > 0) finalChunk.toolCalls = toolCalls;
      if (fullThinking) finalChunk.reasoning = fullThinking;
      if (result.usage) finalChunk.usage = result.usage;
      await callback(finalChunk);

      logger.info("LLM响应", {
        provider: this.name,
        text: fullText.substring(0, 200),
        thinking: fullThinking ? "(有思考过程)" : undefined,
      });

      logMethodReturn(logger, { method: "streamChat", module: "AnthropicProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "AnthropicProvider",
        error: { name: error.name, message: error.message },
        duration: timer(),
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildRequestBody(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    stream = false
  ): AnthropicRequest {
    const body: AnthropicRequest = {
      model,
      messages: this.convertMessages(messages),
      max_tokens: maxTokens ?? 4096,
      stream,
    };

    if (temperature !== undefined) body.temperature = temperature;
    if (this.thinking) body.thinking = this.thinking;
    if (this.stopSequences?.length) body.stop_sequences = this.stopSequences;

    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));

      if (this.forceTool) {
        body.tool_choice = { type: "tool", name: this.forceTool };
      } else {
        body.tool_choice = { type: "auto" };
      }
    }

    return body;
  }

  private convertMessages(messages: Message[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];
    let systemPrompt = "";

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt += (systemPrompt ? "\n" : "") + msg.content;
        continue;
      }

      if (msg.role === "user") {
        result.push({
          role: "user",
          content: [{ type: "text", text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        const content: AnthropicContentBlock[] = [];

        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments,
            });
          }
        }

        result.push({ role: "assistant", content });
      } else if (msg.role === "tool") {
        const lastAssistant = result[result.length - 1];
        if (lastAssistant && lastAssistant.role === "assistant") {
          lastAssistant.content.push({
            type: "tool_result",
            tool_use_id: msg.toolCallId!,
            content: msg.content,
          });
        }
      }
    }

    if (systemPrompt) {
      return [{ role: "user" as const, content: [{ type: "text", text: systemPrompt }] }, ...result];
    }

    return result;
  }

  private async requestWithRetry(url: string, body: AnthropicRequest): Promise<AnthropicResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => null) as AnthropicErrorResponse | null;
            throw new Error(`Anthropic API 错误: ${errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as AnthropicResponse;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.isRetryableError(error) || attempt >= this.maxRetries) throw error;
        await this.sleep(this.retryBaseDelay * Math.pow(2, attempt));
      }
    }

    throw lastError ?? new Error("请求失败");
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes("rate limit") || msg.includes("overloaded") || msg.includes("timeout") || msg.includes("429") || msg.includes("500");
    }
    return false;
  }

  private parseResponse(response: AnthropicResponse): ChatResponse {
    const toolCalls: ToolCall[] = [];
    let text = "";

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text ?? "";
      } else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    const result: ChatResponse = {
      text,
      hasToolCall: toolCalls.length > 0,
    };

    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    if (response.usage) {
      result.usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    }

    result.raw = response;
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  override getStatus(): ProviderStatus {
    const status: ProviderStatus = {
      name: this.name,
      available: true,
      models: this.getSupportedModels(),
      errorCount: this.errorCount,
    };
    if (this.lastUsed !== undefined) status.lastUsed = this.lastUsed;
    return status;
  }
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
  tool_choice?: { type: "auto" } | { type: "any" } | { type: "tool"; name: string };
  stop_sequences?: string[];
  thinking?: ThinkingConfig;
  stream: boolean;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{
    type: "text" | "tool_use";
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: {
    type: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  message?: {
    id?: string;
    role?: string;
    content?: unknown[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  usage?: {
    output_tokens: number;
    stop_sequence?: string;
  };
}

interface AnthropicErrorResponse {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AnthropicProvider {
  return new AnthropicProvider(options);
}
