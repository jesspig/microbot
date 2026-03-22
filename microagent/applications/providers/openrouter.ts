/**
 * OpenRouter Provider 实现
 *
 * 支持 OpenRouter 多模型聚合 API 格式（OpenAI 兼容 + OpenRouter 扩展）
 * 文档：https://openrouter.ai/docs/api-reference
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback } from "../../runtime/types.js";
import { truncateTextForLog } from "./openai-utils.js";

const logger = providersLogger();

export interface OpenRouterProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  referer?: string;
  appTitle?: string;
  categories?: string[];
  reasoningEffort?: "high" | "medium" | "low";
  reasoningSummary?: "auto" | "instant" | "never";
  providerOnly?: string[];
  providerOrder?: string[];
  allowFallbacks?: boolean;
  plugins?: Array<{ id: string }>;
  route?: string;
  modalities?: string[];
  cacheControl?: Record<string, unknown>;
  capabilities?: Partial<ProviderCapabilities>;
}

export class OpenRouterProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly extraBody: Record<string, unknown>;
  private readonly extraHeaders: Record<string, string>;
  private readonly referer: string | undefined;
  private readonly appTitle: string | undefined;
  private readonly categories: string[] | undefined;
  private readonly reasoning: { effort: string; summary?: string } | undefined;
  private readonly provider: { only?: string[]; order?: string[]; allow_fallbacks?: boolean } | undefined;
  private readonly plugins: Array<{ id: string }> | undefined;
  private readonly route: string | undefined;
  private readonly modalities: string[] | undefined;
  private readonly cacheControl: Record<string, unknown> | undefined;
  private readonly retryBaseDelay = 1000;

  constructor(options: OpenRouterProviderOptions = {}) {
    super();

    this.name = options.name ?? "openrouter";
    this.baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    const models = options.models ?? [];

    this.config = {
      id: this.name,
      name: options.displayName ?? "OpenRouter",
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: true,
      supportsPromptCaching: true,
      maxContextTokens: 128000,
      toolSchemaMode: "openai-functions",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.extraBody = options.extraBody ?? {};
    this.extraHeaders = options.extraHeaders ?? {};
    this.referer = options.referer;
    this.appTitle = options.appTitle;
    this.categories = options.categories;

    if (options.reasoningEffort) {
      this.reasoning = { effort: options.reasoningEffort };
      if (options.reasoningSummary) {
        this.reasoning.summary = options.reasoningSummary;
      }
    }

    if (options.providerOnly || options.providerOrder) {
      this.provider = {};
      if (options.providerOnly) this.provider.only = options.providerOnly;
      if (options.providerOrder) this.provider.order = options.providerOrder;
      if (options.allowFallbacks !== undefined) this.provider.allow_fallbacks = options.allowFallbacks;
    }

    this.plugins = options.plugins;
    this.route = options.route;
    this.modalities = options.modalities;
    this.cacheControl = options.cacheControl;
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "OpenRouterProvider",
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
        endpoint: "chat/completions",
      });

      const response = await this.requestWithRetry(`${this.baseUrl}/chat/completions`, body);
      this.recordUsage();
      const result = this.parseResponse(response);

      logger.info("LLM响应", {
        provider: this.name,
        text: truncateTextForLog(result.text),
        reasoning: result.reasoning ? truncateTextForLog(result.reasoning) : undefined,
      });

      logMethodReturn(logger, { method: "chat", module: "OpenRouterProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "OpenRouterProvider",
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
      module: "OpenRouterProvider",
      params: { model, messageCount: messages.length },
    });

    if (!model && this.config.models.length === 0) {
      throw new Error(`Provider "${this.name}" 未配置模型，且请求中未指定模型`);
    }

    const actualModel = model || this.config.models[0]!;
    const body = this.buildRequestBody(actualModel, messages, tools, temperature, maxTokens, true);

    logger.info("LLM调用", { provider: this.name, model: actualModel, stream: true });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      };

      if (this.referer) headers["HTTP-Referer"] = this.referer;
      if (this.appTitle) headers["X-OpenRouter-Title"] = this.appTitle;
      if (this.categories) headers["X-OpenRouter-Categories"] = this.categories.join(",");

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as OpenRouterError | null;
        throw new Error(`OpenRouter API 错误: ${errBody?.error?.message || response.statusText}`);
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
            const event = JSON.parse(data) as OpenRouterStreamChunk;

            if (event.error) {
              throw new Error(`OpenRouter 流式错误: ${event.error.message}`);
            }

            const delta = event.choices[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
              await callback({ delta: delta.content, text: fullText, done: false });
            }
            if (delta?.reasoning) {
              fullReasoning += delta.reasoning;
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

      logMethodReturn(logger, { method: "streamChat", module: "OpenRouterProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "OpenRouterProvider",
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
    body.top_p = 0.9;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    Object.assign(body, this.extraBody);

    if (this.reasoning) body.reasoning = this.reasoning;
    if (this.provider && Object.keys(this.provider).length > 0) body.provider = this.provider;
    if (this.plugins?.length) body.plugins = this.plugins;
    if (this.route) body.route = this.route;
    if (this.modalities?.length) body.modalities = this.modalities;
    if (this.cacheControl && Object.keys(this.cacheControl).length > 0) body.cache_control = this.cacheControl;

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

  private async requestWithRetry(url: string, body: Record<string, unknown>): Promise<OpenRouterResponse> {
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

          if (this.referer) headers["HTTP-Referer"] = this.referer;
          if (this.appTitle) headers["X-OpenRouter-Title"] = this.appTitle;
          if (this.categories) headers["X-OpenRouter-Categories"] = this.categories.join(",");

          const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => null) as OpenRouterError | null;
            throw new Error(`OpenRouter API 错误: ${errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as OpenRouterResponse;
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

  private parseResponse(response: OpenRouterResponse): ChatResponse {
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
    if (message?.reasoning) result.reasoning = message.reasoning;

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

interface OpenRouterResponse {
  id: string;
  provider?: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    native_finish_reason?: string;
    logprobs?: unknown;
    message: {
      role: string;
      content: string | null;
      refusal?: string | null;
      reasoning?: string;
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
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

interface OpenRouterStreamChunk {
  id: string;
  provider?: string;
  object: string;
  created: number;
  model: string;
  error?: {
    code: string;
    message: string;
  };
  choices: Array<{
    index: number;
    finish_reason: string | null;
    native_finish_reason?: string;
    delta: {
      role?: string;
      content?: string | null;
      refusal?: string | null;
      reasoning?: string;
    };
  }>;
  usage?: OpenRouterResponse["usage"];
}

interface OpenRouterError {
  error: {
    code: number;
    message: string;
    metadata?: Record<string, unknown>;
  };
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): OpenRouterProvider {
  return new OpenRouterProvider(options);
}
