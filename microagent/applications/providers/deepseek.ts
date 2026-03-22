/**
 * DeepSeek Provider 实现
 *
 * 支持 DeepSeek API 格式
 * 文档：https://api-docs.deepseek.com/
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback } from "../../runtime/types.js";
import { truncateTextForLog } from "./openai-utils.js";

const logger = providersLogger();

export interface DeepSeekProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  thinkingEnabled?: boolean;
  capabilities?: Partial<ProviderCapabilities>;
}

export class DeepSeekProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly thinkingEnabled: boolean;
  private readonly retryBaseDelay = 1000;

  constructor(options: DeepSeekProviderOptions = {}) {
    super();

    this.name = options.name ?? "deepseek";
    this.baseUrl = options.baseUrl ?? "https://api.deepseek.com/v1";
    this.apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
    const models = options.models ?? [];

    this.config = {
      id: this.name,
      name: options.displayName ?? "DeepSeek",
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: false,
      supportsPromptCaching: true,
      maxContextTokens: 64000,
      toolSchemaMode: "openai-functions",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.thinkingEnabled = options.thinkingEnabled ?? false;
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "DeepSeekProvider",
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
        endpoint: "chat/completions",
        stream: false,
      });

      const response = await this.requestWithRetry(`${this.baseUrl}/chat/completions`, body);
      this.recordUsage();
      const result = this.parseResponse(response);

      const llmResponseLog: Record<string, unknown> = {
        provider: this.name,
        model: actualModel,
        text: truncateTextForLog(result.text),
      };
      if (result.reasoning) {
        llmResponseLog.reasoning = truncateTextForLog(result.reasoning);
      }
      if (result.toolCalls?.length) {
        llmResponseLog.toolCalls = result.toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments }));
      }
      if (result.usage) {
        llmResponseLog.usage = result.usage;
      }
      logger.info("LLM响应", llmResponseLog);

      logMethodReturn(logger, { method: "chat", module: "DeepSeekProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "DeepSeekProvider",
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
      module: "DeepSeekProvider",
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
      endpoint: "chat/completions",
      stream: true,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as DeepSeekErrorResponse | null;
        throw new Error(`DeepSeek API 错误: ${errBody?.error?.message || response.statusText}`);
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
            const event = JSON.parse(data) as DeepSeekStreamChunk;
            const delta = event.choices[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
              await callback({ delta: delta.content, text: fullText, done: false });
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content;
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

      const result: ChatResponse = {
        text: fullText,
        hasToolCall: false,
      };
      if (fullReasoning) result.reasoning = fullReasoning;

      logger.info("LLM响应", { provider: this.name, text: truncateTextForLog(fullText), reasoning: truncateTextForLog(fullReasoning) });
      logMethodReturn(logger, { method: "streamChat", module: "DeepSeekProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "DeepSeekProvider",
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
    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(messages),
      stream,
    };

    if (temperature !== undefined) body.temperature = temperature;
    body.top_p = 1.0;
    body.frequency_penalty = 0.0;
    body.presence_penalty = 0.0;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    if (this.thinkingEnabled) {
      body.thinking = { type: "enabled" };
    }

    if (stream) {
      body.stream_options = { include_usage: true };
    }

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

  private convertMessages(messages: Message[]): unknown[] {
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

  private async requestWithRetry(url: string, body: Record<string, unknown>): Promise<DeepSeekResponse> {
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
            const errBody = await response.json().catch(() => null) as DeepSeekErrorResponse | null;
            throw new Error(`DeepSeek API 错误: ${errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as DeepSeekResponse;
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

  private parseResponse(response: DeepSeekResponse): ChatResponse {
    const message = response.choices[0]?.message;
    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    })) ?? [];

    const result: ChatResponse = {
      text: message?.content ?? "",
      hasToolCall: toolCalls.length > 0,
    };

    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    if (message?.reasoning_content) result.reasoning = message.reasoning_content;

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

interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    finish_reason: DeepSeekFinishReason;
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    logprobs?: {
      content?: Array<{
        token: string;
        logprob: number;
        bytes: number[];
        top_logprobs: Array<{
          token: string;
          logprob: number;
          bytes: number[];
        }>;
      }>;
      reasoning_content?: Array<{
        token: string;
        logprob: number;
        bytes: number[];
        top_logprobs: Array<{
          token: string;
          logprob: number;
          bytes: number[];
        }>;
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

type DeepSeekFinishReason = "stop" | "length" | "content_filter" | "tool_calls" | "insufficient_system_resource";

interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    finish_reason: DeepSeekFinishReason | null;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
    };
    logprobs?: DeepSeekResponse["choices"][0]["logprobs"];
  }>;
  usage?: DeepSeekResponse["usage"];
}

interface DeepSeekErrorResponse {
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

export function createDeepSeekProvider(options: DeepSeekProviderOptions = {}): DeepSeekProvider {
  return new DeepSeekProvider(options);
}
