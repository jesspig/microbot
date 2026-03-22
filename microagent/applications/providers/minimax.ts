/**
 * MiniMax Provider 实现
 *
 * 支持 MiniMax API 格式（原生 chatcompletion_v2 + OpenAI 兼容模式）
 * 文档：https://platform.minimax.io/
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback } from "../../runtime/types.js";
import { truncateTextForLog } from "./openai-utils.js";

const logger = providersLogger();

export interface MiniMaxProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  reasoningSplit?: boolean;
  useNativeApi?: boolean;
  capabilities?: Partial<ProviderCapabilities>;
}

export class MiniMaxProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly reasoningSplit: boolean;
  private readonly useNativeApi: boolean;
  private readonly retryBaseDelay = 1000;

  constructor(options: MiniMaxProviderOptions = {}) {
    super();

    this.name = options.name ?? "minimax";
    this.baseUrl = options.baseUrl ?? "https://api.minimaxi.com/v1";
    this.apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY ?? "";
    const models = options.models ?? [];

    this.config = {
      id: this.name,
      name: options.displayName ?? "MiniMax",
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: false,
      supportsPromptCaching: false,
      maxContextTokens: 100000,
      toolSchemaMode: "native",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.reasoningSplit = options.reasoningSplit ?? false;
    this.useNativeApi = options.useNativeApi ?? false;
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "MiniMaxProvider",
      params: { model, messageCount: messages.length },
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
        endpoint: this.useNativeApi ? "text/chatcompletion_v2" : "chat/completions",
      });

      const endpoint = this.useNativeApi ? "/text/chatcompletion_v2" : "/chat/completions";
      const response = await this.requestWithRetry(`${this.baseUrl}${endpoint}`, body);
      this.recordUsage();
      const result = this.parseResponse(response);

      logger.info("LLM响应", {
        provider: this.name,
        text: truncateTextForLog(result.text),
        reasoning: result.reasoning ? truncateTextForLog(result.reasoning) : undefined,
      });

      logMethodReturn(logger, { method: "chat", module: "MiniMaxProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "MiniMaxProvider",
        error: { name: error.name, message: error.message },
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
      module: "MiniMaxProvider",
      params: { model, messageCount: messages.length },
    });

    if (!model && this.config.models.length === 0) {
      throw new Error(`Provider "${this.name}" 未配置模型，且请求中未指定模型`);
    }

    const actualModel = model || this.config.models[0]!;
    const body = this.buildRequestBody(actualModel, messages, tools, temperature, maxTokens, true);

    logger.info("LLM调用", {
      provider: this.name,
      model: actualModel,
      stream: true,
    });

    const endpoint = this.useNativeApi ? "/text/chatcompletion_v2" : "/chat/completions";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as MiniMaxErrorResponse | null;
        throw new Error(`MiniMax API 错误: ${errBody?.base_resp?.status_msg || errBody?.error?.message || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法获取响应流");

      const decoder = new TextDecoder();
      let fullText = "";
      let fullReasoning = "";
      let usageReported = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as MiniMaxStreamChunk;
            const delta = event.choices[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
              await callback({ delta: delta.content, text: fullText, done: false });
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content;
            }
            if (delta?.reasoning_details) {
              for (const detail of delta.reasoning_details) {
                if (detail.type === "thinking" && detail.thinking) {
                  fullReasoning += detail.thinking;
                }
              }
            }

            if (!usageReported && event.usage) {
              this.recordUsage();
              usageReported = true;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      if (!usageReported) {
        this.recordUsage();
      }

      const result: ChatResponse = { text: fullText, hasToolCall: false };
      if (fullReasoning) result.reasoning = fullReasoning;

      logMethodReturn(logger, { method: "streamChat", module: "MiniMaxProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "MiniMaxProvider",
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
  ): Record<string, unknown> {
    if (this.useNativeApi) {
      return this.buildNativeRequestBody(model, messages, tools, temperature, maxTokens, stream);
    }
    return this.buildOpenAICompatibleRequestBody(model, messages, tools, temperature, maxTokens, stream);
  }

  private buildNativeRequestBody(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    stream = false
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertNativeMessages(messages),
      stream,
    };

    if (maxTokens !== undefined) body.max_completion_tokens = maxTokens;
    if (temperature !== undefined && temperature > 0) body.temperature = temperature;
    body.top_p = 0.95;

    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = "auto";
    }

    return body;
  }

  private buildOpenAICompatibleRequestBody(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    stream = false
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertOpenAIMessages(messages),
      stream,
    };

    if (temperature !== undefined && temperature > 0) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (this.reasoningSplit) body.reasoning_split = true;

    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = "auto";
    }

    return body;
  }

  private convertNativeMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        return {
          role: msg.role,
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      if (msg.role === "tool") {
        return { role: msg.role, content: msg.content, tool_call_id: msg.toolCallId };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  private convertOpenAIMessages(messages: Message[]): unknown[] {
    return this.convertNativeMessages(messages);
  }

  private async requestWithRetry(url: string, body: Record<string, unknown>): Promise<MiniMaxResponse> {
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
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => null) as MiniMaxErrorResponse | null;
            throw new Error(`MiniMax API 错误: ${errBody?.base_resp?.status_msg || errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as MiniMaxResponse;
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

  private parseResponse(response: MiniMaxResponse): ChatResponse {
    const message = response.choices[0]?.message;
    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    })) ?? [];

    let reasoning = message?.reasoning_content ?? "";
    if (message?.reasoning_details) {
      for (const detail of message.reasoning_details) {
        if (detail.type === "thinking" && detail.thinking) {
          reasoning += detail.thinking;
        }
      }
    }

    const result: ChatResponse = {
      text: message?.content ?? "",
      hasToolCall: toolCalls.length > 0,
    };

    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    if (reasoning) result.reasoning = reasoning;

    if (response.usage) {
      result.usage = {
        inputTokens: response.usage.prompt_tokens ?? 0,
        outputTokens: response.usage.completion_tokens ?? 0,
      };
      if (response.usage.completion_tokens_details?.reasoning_tokens) {
        result.usage.reasoningTokens = response.usage.completion_tokens_details.reasoning_tokens;
      }
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

interface MiniMaxResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      name?: string;
      content: string | null;
      reasoning_content?: string;
      reasoning_details?: Array<{
        type: string;
        thinking?: string;
      }>;
      audio_content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    total_characters?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  input_sensitive?: boolean;
  output_sensitive?: boolean;
  input_sensitive_type?: number;
  output_sensitive_type?: number;
  output_sensitive_int?: number;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  web_search?: Array<{
    icon?: string;
    title?: string;
    link?: string;
    media?: string;
    publish_date?: string;
    content?: string;
    refer?: string;
  }>;
}

interface MiniMaxStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      reasoning_details?: Array<{
        type: string;
        thinking?: string;
      }>;
    };
  }>;
  usage?: MiniMaxResponse["usage"];
}

interface MiniMaxErrorResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  error?: {
    message: string;
    code?: string;
  };
}

export function createMiniMaxProvider(options: MiniMaxProviderOptions = {}): MiniMaxProvider {
  return new MiniMaxProvider(options);
}
