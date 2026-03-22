/**
 * OpenAI 兼容 Provider 实现
 *
 * 作为 fallback 适配器，兼容所有 OpenAI Chat Completions 兼容接口
 * 文档：https://platform.openai.com/docs/api-reference/chat
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback } from "../../runtime/types.js";
import { truncateTextForLog } from "./openai-utils.js";

const logger = providersLogger();

export interface OpenAICompatibleProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
}

export class OpenAICompatibleProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly extraBody: Record<string, unknown>;
  private readonly extraHeaders: Record<string, string>;
  private readonly retryBaseDelay = 1000;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    super();

    this.name = options.name ?? "openai-compatible";
    this.baseUrl = options.baseUrl ?? "";
    this.apiKey = options.apiKey ?? "";
    const models = options.models ?? [];

    this.config = {
      id: this.name,
      name: options.displayName ?? "OpenAI 兼容",
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: false,
      supportsPromptCaching: false,
      maxContextTokens: 128000,
      toolSchemaMode: "openai-functions",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.extraBody = options.extraBody ?? {};
    this.extraHeaders = options.extraHeaders ?? {};
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  private getEndpoint(): string {
    const base = this.baseUrl.replace(/\/$/, "");
    return `${base}/chat/completions`;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "OpenAICompatibleProvider",
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
        endpoint: this.getEndpoint(),
        stream: false,
      });

      const response = await this.requestWithRetry(this.getEndpoint(), body);
      this.recordUsage();
      const result = this.parseResponse(response);

      logger.info("LLM响应", {
        provider: this.name,
        text: truncateTextForLog(result.text),
      });

      logMethodReturn(logger, { method: "chat", module: "OpenAICompatibleProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "OpenAICompatibleProvider",
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
      module: "OpenAICompatibleProvider",
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
      endpoint: this.getEndpoint(),
      stream: true,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      };

      const response = await fetch(this.getEndpoint(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as OpenAICompatibleErrorResponse | null;
        throw new Error(`${this.name} API 错误: ${errBody?.error?.message || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法获取响应流");

      const decoder = new TextDecoder();
      let fullText = "";
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
            const event = JSON.parse(data) as OpenAICompatibleStreamChunk;
            const delta = event.choices[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
              await callback({ delta: delta.content, text: fullText, done: false });
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

      logger.info("LLM响应", {
        provider: this.name,
        text: truncateTextForLog(fullText),
      });

      logMethodReturn(logger, { method: "streamChat", module: "OpenAICompatibleProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "OpenAICompatibleProvider",
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
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

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

    if (Object.keys(this.extraBody).length > 0) {
      Object.assign(body, this.extraBody);
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

  private async requestWithRetry(url: string, body: Record<string, unknown>): Promise<OpenAICompatibleResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...this.extraHeaders,
          };

          const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => null) as OpenAICompatibleErrorResponse | null;
            throw new Error(`${this.name} API 错误: ${errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as OpenAICompatibleResponse;
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

  private parseResponse(response: OpenAICompatibleResponse): ChatResponse {
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

    if (response.usage) {
      result.usage = {
        inputTokens: response.usage.prompt_tokens ?? 0,
        outputTokens: response.usage.completion_tokens ?? 0,
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

interface OpenAICompatibleResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}

interface OpenAICompatibleStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    logprobs?: unknown;
  }>;
  usage?: OpenAICompatibleResponse["usage"];
}

interface OpenAICompatibleErrorResponse {
  error?: {
    message: string;
    type?: string;
    code?: string;
    param?: string;
  };
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions = {}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(options);
}
