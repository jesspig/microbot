/**
 * Ollama Provider 实现
 *
 * 支持本地运行的开源大语言模型
 * 提供两种 API 模式：
 * 1. 原生 API (/api/chat) - 支持 think、format、options 等扩展参数
 * 2. OpenAI 兼容 API (/v1/chat/completions) - 与 OpenAI SDK 兼容
 * 文档：https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback, StreamChunk, ToolCall, UsageStats } from "../../runtime/types.js";

const logger = providersLogger();

export interface OllamaProviderOptions {
  name?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  useNativeApi?: boolean;
  think?: boolean | string;
  format?: string | Record<string, unknown>;
  options?: OllamaModelOptions;
  keepAlive?: string | number;
  reasoningEffort?: "high" | "medium" | "low" | "none";
  capabilities?: Partial<ProviderCapabilities>;
}

export interface OllamaModelOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  numCtx?: number;
  numPredict?: number;
  numGpu?: number;
  mainGpu?: number;
  numThread?: number;
  seed?: number;
}

export class OllamaProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;
  readonly apiKey: string;

  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly useNativeApi: boolean;
  private readonly think: boolean | string;
  private readonly format: string | Record<string, unknown> | undefined;
  private readonly options: OllamaModelOptions;
  private readonly keepAlive: string | number;
  private readonly reasoningEffort: "high" | "medium" | "low" | "none" | undefined;
  private readonly retryBaseDelay = 1000;
  private cachedModels: string[] | null = null;

  constructor(options: OllamaProviderOptions = {}) {
    super();

    this.name = options.name ?? "ollama";
    this.baseUrl = options.baseUrl ?? "http://localhost:11434";
    this.apiKey = options.apiKey ?? "";
    const models = options.models ?? [];

    this.config = {
      id: this.name,
      name: options.displayName ?? "Ollama",
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: true,
      supportsPromptCaching: false,
      maxContextTokens: 128000,
      toolSchemaMode: "native",
      ...options.capabilities,
    };

    this.timeout = options.timeout ?? 120000;
    this.maxRetries = options.maxRetries ?? 2;
    this.useNativeApi = options.useNativeApi ?? true;
    this.think = options.think ?? false;
    this.format = options.format;
    this.options = options.options ?? {};
    this.keepAlive = options.keepAlive ?? "5m";
    this.reasoningEffort = options.reasoningEffort;

    if (models.length > 0) {
      this.cachedModels = [...models];
    }
  }

  getSupportedModels(): string[] {
    if (this.config.models.length > 0) {
      return [...this.config.models];
    }
    if (this.cachedModels) {
      return [...this.cachedModels];
    }
    return [];
  }

  async refreshModels(): Promise<string[]> {
    const timer = createTimer();
    logMethodCall(logger, { method: "refreshModels", module: "OllamaProvider" });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.config.baseUrl}/api/tags`, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`获取模型列表失败: ${response.statusText}`);
        }

        const data = (await response.json()) as OllamaModelsResponse;
        this.cachedModels = data.models.map((m) => m.name);

        logger.info("模型列表刷新", { provider: this.name, modelCount: this.cachedModels.length, duration: timer() });
        logMethodReturn(logger, { method: "refreshModels", module: "OllamaProvider", result: { modelCount: this.cachedModels.length }, duration: timer() });
        return [...this.cachedModels!];
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "refreshModels",
        module: "OllamaProvider",
        error: { name: error.name, message: error.message },
        duration: timer(),
      });
      return [];
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "OllamaProvider",
      params: { model, messageCount: messages.length, hasTools: !!tools?.length },
    });

    const actualModel = model || this.config.models[0];
    if (!actualModel) {
      throw new Error(`Provider "${this.name}" 未配置模型，且请求中未指定模型`);
    }

    try {
      if (this.useNativeApi) {
        return await this.nativeChat(actualModel, messages, tools, temperature, maxTokens, timer);
      }
      return await this.openAICompatibleChat(actualModel, messages, tools, temperature, maxTokens, timer);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "OllamaProvider",
        error: { name: error.name, message: error.message },
        duration: timer(),
      });
      throw error;
    }
  }

  private async nativeChat(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    timer: () => number
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertNativeMessages(messages),
      stream: false,
    };

    if (this.think) body.think = this.think;
    if (this.format) body.format = this.format;
    if (this.keepAlive !== undefined) body.keep_alive = this.keepAlive;

    const options: Record<string, unknown> = { ...this.options };
    if (temperature !== undefined) options.temperature = temperature;
    if (maxTokens !== undefined) options.num_predict = maxTokens;
    if (Object.keys(options).length > 0) body.options = options;

    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    logger.info("LLM调用", { provider: this.name, model, endpoint: "api/chat", stream: false });

    const response = await this.nativeRequest(`${this.baseUrl}/api/chat`, body);
    this.recordUsage();
    const result = this.parseNativeResponse(response);

    logger.info("LLM响应", {
      provider: this.name,
      text: result.text.substring(0, 100),
      reasoning: result.reasoning?.substring(0, 100),
    });
    logMethodReturn(logger, { method: "chat", module: "OllamaProvider", result: sanitize(result), duration: timer() });
    return result;
  }

  private async openAICompatibleChat(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    timer: () => number
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertOpenAIMessages(messages),
      stream: false,
    };

    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (this.reasoningEffort) body.reasoning_effort = this.reasoningEffort;
    body.stream_options = { include_usage: true };

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

    logger.info("LLM调用", { provider: this.name, model, endpoint: "v1/chat/completions", stream: false });

    const response = await this.openAIRequest(`${this.baseUrl}/v1/chat/completions`, body);
    this.recordUsage();
    const result = this.parseOpenAIResponse(response);

    logMethodReturn(logger, { method: "chat", module: "OllamaProvider", result: sanitize(result), duration: timer() });
    return result;
  }

  async streamChat(request: ChatRequest, callback: StreamCallback): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "streamChat",
      module: "OllamaProvider",
      params: { model, messageCount: messages.length },
    });

    const actualModel = model || this.config.models[0];
    if (!actualModel) {
      throw new Error(`Provider "${this.name}" 未配置模型，且请求中未指定模型`);
    }

    try {
      if (this.useNativeApi) {
        return await this.nativeStreamChat(actualModel, messages, tools, temperature, maxTokens, callback, timer);
      }
      return await this.openAICompatibleStreamChat(actualModel, messages, tools, temperature, maxTokens, callback, timer);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "OllamaProvider",
        error: { name: error.name, message: error.message },
        duration: timer(),
      });
      throw error;
    }
  }

  private async nativeStreamChat(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    callback: StreamCallback,
    timer: () => number
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertNativeMessages(messages),
      stream: true,
    };

    if (this.think) body.think = this.think;
    if (this.format) body.format = this.format;
    if (this.keepAlive !== undefined) body.keep_alive = this.keepAlive;

    const options: Record<string, unknown> = { ...this.options };
    if (temperature !== undefined) options.temperature = temperature;
    if (maxTokens !== undefined) options.num_predict = maxTokens;
    if (Object.keys(options).length > 0) body.options = options;

    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    logger.info("LLM调用", { provider: this.name, model, endpoint: "api/chat", stream: true });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: response.statusText })) as OllamaError;
        throw new Error(`Ollama API 错误: ${errBody.error || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法获取响应流");

      const decoder = new TextDecoder();
      let fullText = "";
      let fullReasoning = "";
      const toolCalls: ToolCall[] = [];
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line) as OllamaStreamChunk;

            if (json.message?.content) {
              fullText += json.message.content;
              await callback({ delta: json.message.content, text: fullText, done: false });
            }
            if (json.message?.thinking) {
              fullReasoning += json.message.thinking;
            }

            if (json.message?.tool_calls) {
              for (const tc of json.message.tool_calls) {
                toolCalls.push({
                  id: tc.id ?? `tc_${Date.now()}_${toolCalls.length}`,
                  name: tc.function.name,
                  arguments: this.parseToolArguments(tc.function.arguments),
                });
              }
            }

            if (json.done) {
              usage = {
                inputTokens: json.prompt_eval_count ?? 0,
                outputTokens: json.eval_count ?? 0,
              };
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      this.recordUsage();

      const finalChunk: { delta: string; text: string; done: true; usage?: UsageStats } = {
        delta: "",
        text: fullText,
        done: true,
      };
      if (usage) finalChunk.usage = usage;
      await callback(finalChunk as StreamChunk);

      const result: ChatResponse = {
        text: fullText,
        hasToolCall: toolCalls.length > 0,
      };
      if (fullReasoning) result.reasoning = fullReasoning;
      if (toolCalls.length > 0) result.toolCalls = toolCalls;
      if (usage) result.usage = usage;

      logMethodReturn(logger, { method: "streamChat", module: "OllamaProvider", result: sanitize(result), duration: timer() });
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async openAICompatibleStreamChat(
    model: string,
    messages: Message[],
    tools: ChatRequest["tools"],
    temperature: number | undefined,
    maxTokens: number | undefined,
    callback: StreamCallback,
    timer: () => number
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertOpenAIMessages(messages),
      stream: true,
    };

    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (this.reasoningEffort) body.reasoning_effort = this.reasoningEffort;
    body.stream_options = { include_usage: true };

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

    logger.info("LLM调用", { provider: this.name, model, endpoint: "v1/chat/completions", stream: true });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } };
        throw new Error(`Ollama API 错误: ${errBody?.error?.message || response.statusText}`);
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
            const event = JSON.parse(data) as OllamaOpenAIStreamChunk;
            const delta = event.choices[0]?.delta;

            if (delta?.content) {
              fullText += delta.content;
              await callback({ delta: delta.content, text: fullText, done: false });
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content;
            }

            if (!usageReported && event.usage) {
              usageReported = true;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      this.recordUsage();

      const result: ChatResponse = {
        text: fullText,
        hasToolCall: false,
      };
      if (fullReasoning) result.reasoning = fullReasoning;

      logMethodReturn(logger, { method: "streamChat", module: "OllamaProvider", result: sanitize(result), duration: timer() });
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private convertNativeMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      const result: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        result.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }));
      }

      if (msg.role === "tool") {
        result.tool_call_id = msg.toolCallId;
      }

      return result;
    });
  }

  private convertOpenAIMessages(messages: Message[]): unknown[] {
    return this.convertNativeMessages(messages);
  }

  private async nativeRequest(url: string, body: Record<string, unknown>): Promise<OllamaNativeResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => ({ error: response.statusText })) as OllamaError;
            throw new Error(`Ollama API 错误: ${errBody.error || response.statusText}`);
          }

          return await response.json() as OllamaNativeResponse;
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

  private async openAIRequest(url: string, body: Record<string, unknown>): Promise<OllamaOpenAIResponse> {
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
              Authorization: `Bearer ${this.apiKey || "ollama"}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } };
            throw new Error(`Ollama API 错误: ${errBody?.error?.message || response.statusText}`);
          }

          return await response.json() as OllamaOpenAIResponse;
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
      return msg.includes("timeout") || msg.includes("network") || msg.includes("connection") || msg.includes("429") || msg.includes("500");
    }
    return false;
  }

  private parseNativeResponse(response: OllamaNativeResponse): ChatResponse {
    const toolCalls = response.message.tool_calls?.map((tc) => ({
      id: tc.id ?? `tc_${Date.now()}`,
      name: tc.function.name,
      arguments: this.parseToolArguments(tc.function.arguments),
    })) ?? [];

    const result: ChatResponse = {
      text: response.message.content ?? "",
      hasToolCall: toolCalls.length > 0,
    };

    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    if (response.message.thinking) result.reasoning = response.message.thinking;

    if (response.prompt_eval_count !== undefined || response.eval_count !== undefined) {
      result.usage = {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
      };
    }

    result.raw = response;
    return result;
  }

  private parseOpenAIResponse(response: OllamaOpenAIResponse): ChatResponse {
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

  private parseToolArguments(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
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

  override async testConnection(): Promise<boolean> {
    try {
      await this.refreshModels();
      return true;
    } catch {
      return false;
    }
  }
}

interface OllamaModelsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}

interface OllamaNativeResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      type?: "function";
      function: { name: string; arguments: string };
    }>;
    images?: unknown;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      type?: "function";
      function: { name: string; arguments: string };
    }>;
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaOpenAIResponse {
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
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OllamaOpenAIStreamChunk {
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
      reasoning_content?: string;
    };
  }>;
  usage?: OllamaOpenAIResponse["usage"];
}

interface OllamaError {
  error: string;
}

export function createOllamaProvider(options: OllamaProviderOptions = {}): OllamaProvider {
  return new OllamaProvider(options);
}
