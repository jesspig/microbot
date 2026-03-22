/**
 * GLM Provider 实现
 *
 * 支持智谱 GLM 系列 API（BigModel + Z.AI）
 * 文档：
 * - BigModel：https://docs.bigmodel.cn/
 * - Z.AI：https://docs.z.ai/
 *
 * 支持两类端点：
 * - 通用端点：https://open.bigmodel.cn/api/paas/v4 或 https://api.z.ai/api/paas/v4
 * - Coding Plan 端点：https://open.bigmodel.cn/api/coding/paas/v4 或 https://api.z.ai/api/coding/paas/v4
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback } from "../../runtime/types.js";
import { truncateTextForLog } from "./openai-utils.js";

const logger = providersLogger();

export interface GLMProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  thinkingEnabled?: boolean;
  doSample?: boolean;
  userId?: string;
  webSearch?: boolean;
  streamingToolCalls?: boolean;
  capabilities?: Partial<ProviderCapabilities>;
}

export class GLMProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly thinkingEnabled: boolean;
  private readonly doSample: boolean;
  private readonly userId: string | undefined;
  private readonly webSearch: boolean;
  private readonly streamingToolCalls: boolean;
  private readonly isZAI: boolean;
  private readonly retryBaseDelay = 1000;

  constructor(options: GLMProviderOptions = {}) {
    super();

    this.name = options.name ?? "glm";
    this.baseUrl = options.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4";
    this.apiKey = options.apiKey ?? process.env.BIGMODEL_API_KEY ?? process.env.ZAI_API_KEY ?? "";
    const models = options.models ?? [];

    this.isZAI = /api\.z\.ai/i.test(this.baseUrl);

    this.config = {
      id: this.name,
      name: options.displayName ?? (this.isZAI ? "Z.AI" : "智谱 AI"),
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: true,
      supportsPromptCaching: false,
      maxContextTokens: 128000,
      toolSchemaMode: this.isZAI ? "openai-functions" : "native",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.thinkingEnabled = options.thinkingEnabled ?? false;
    this.doSample = options.doSample ?? true;
    this.userId = options.userId;
    this.webSearch = options.webSearch ?? false;
    this.streamingToolCalls = options.streamingToolCalls ?? true;
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  private getEndpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "GLMProvider",
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
        reasoning: result.reasoning ? truncateTextForLog(result.reasoning) : undefined,
      });

      logMethodReturn(logger, { method: "chat", module: "GLMProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "GLMProvider",
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
      module: "GLMProvider",
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
      const response = await fetch(this.getEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as GLMErrorResponse | null;
        throw new Error(`${this.name} API 错误: ${errBody?.error?.message || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法获取响应流");

      const decoder = new TextDecoder();
      let fullText = "";
      let fullReasoning = "";
      let usageReported = false;
      let currentToolCall: { id: string; name: string; arguments: string } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as GLMStreamChunk;
            const delta = event.choices[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
              await callback({ delta: delta.content, text: fullText, done: false });
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content;
            }

            if (this.streamingToolCalls && delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!currentToolCall && tc.id && tc.function?.name) {
                  currentToolCall = {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: tc.function.arguments ?? "",
                  };
                } else if (currentToolCall && tc.function?.arguments) {
                  currentToolCall.arguments += tc.function.arguments;
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

      const result: ChatResponse = {
        text: fullText,
        hasToolCall: false,
      };
      if (fullReasoning) result.reasoning = fullReasoning;

      logger.info("LLM响应", {
        provider: this.name,
        text: truncateTextForLog(fullText),
        reasoning: fullReasoning ? truncateTextForLog(fullReasoning) : undefined,
      });

      logMethodReturn(logger, { method: "streamChat", module: "GLMProvider", result: sanitize(result), duration: timer() });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "GLMProvider",
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

    if (!this.doSample) body.do_sample = false;
    if (temperature !== undefined && temperature > 0) body.temperature = temperature;
    body.top_p = 0.9;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    if (this.userId !== undefined) body.user_id = this.userId;
    if (this.webSearch) body.web_search = { enable: true };

    if (this.thinkingEnabled && !this.isZAI) {
      body.thinking = { type: "enabled", budget_tokens: 4000 };
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

  private async requestWithRetry(url: string, body: Record<string, unknown>): Promise<GLMResponse> {
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
            const errBody = await response.json().catch(() => null) as GLMErrorResponse | null;
            throw new Error(`${this.name} API 错误: ${errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as GLMResponse;
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

  private parseResponse(response: GLMResponse): ChatResponse {
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

interface GLMResponse {
  id: string;
  request_id?: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
      audio?: {
        id: string;
        data: string;
        expires_at: string;
      };
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
  video_result?: Array<{
    url: string;
    cover_image_url: string;
  }>;
  content_filter?: Array<{
    role: string;
    level: number;
  }>;
}

interface GLMStreamChunk {
  id: string;
  request_id?: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: GLMResponse["usage"];
}

interface GLMErrorResponse {
  error?: {
    code?: string;
    message: string;
    type?: string;
  };
}

export function createGLMProvider(options: GLMProviderOptions = {}): GLMProvider {
  return new GLMProvider(options);
}
