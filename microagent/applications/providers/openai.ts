/**
 * OpenAI Provider 实现
 *
 * 支持 OpenAI GPT API 格式
 * 重构后使用专职组件处理不同职责
 */

import { BaseProvider } from "../../runtime/provider/base.js";
import { providersLogger, createTimer, sanitize, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";
import type { IProviderExtended } from "../../runtime/provider/contract.js";
import type { ProviderCapabilities, ProviderConfig, ProviderStatus } from "../../runtime/provider/types.js";
import type { ChatRequest, ChatResponse, Message, StreamCallback } from "../../runtime/types.js";
import { truncateTextForLog } from "./openai-utils.js";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_TEMPERATURE,
} from "./openai-constants.js";
import { OpenAIRequestHandler, type RequestConfig } from "./openai-request-handler.js";
import { OpenAIResponseParser, type OpenAIResponse } from "./openai-response-parser.js";
import { OpenAIStreamProcessor } from "./openai-stream-processor.js";
import { OpenAIRetryStrategy } from "./openai-retry-strategy.js";

const logger = providersLogger();

// ============================================================================
// 类型定义
// ============================================================================

export interface OpenAIProviderOptions {
  name: string;
  displayName?: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  timeout?: number;
  maxRetries?: number;
  capabilities?: Partial<ProviderCapabilities>;
}

// ============================================================================
// Provider 实现
// ============================================================================

export class OpenAIProvider extends BaseProvider implements IProviderExtended {
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  private readonly defaultModel: string;
  private readonly timeout: number;

  /** 缓存的请求头（避免每次请求重新创建对象） */
  private readonly cachedHeaders: Record<string, string>;

  /** 请求处理器 */
  private readonly requestHandler: OpenAIRequestHandler;

  /** 响应解析器 */
  private readonly responseParser: OpenAIResponseParser;

  /** 流式处理器 */
  private readonly streamProcessor: OpenAIStreamProcessor;

  /** 重试策略 */
  private readonly retryStrategy: OpenAIRetryStrategy;

  constructor(options: OpenAIProviderOptions) {
    super();

    if (!options.name) throw new Error("Provider name 未配置");
    if (!options.baseUrl) throw new Error(`${options.name} baseUrl 未配置`);
    if (!options.models?.length) throw new Error(`${options.name} models 未配置`);

    this.name = options.name;
    const apiKey = options.apiKey ?? process.env[`${options.name.toUpperCase()}_API_KEY`] ?? "";

    this.config = {
      id: options.name,
      name: options.displayName ?? options.name,
      baseUrl: options.baseUrl,
      apiKey,
      models: options.models,
    };

    this.capabilities = {
      supportsStreaming: true,
      supportsVision: true,
      supportsPromptCaching: false,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      toolSchemaMode: "native",
      ...options.capabilities,
    };

    this.defaultModel = options.models[0]!;
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    // 初始化缓存请求头
    this.cachedHeaders = { "Content-Type": "application/json" };
    if (this.config.apiKey) {
      this.cachedHeaders.Authorization = `Bearer ${this.config.apiKey}`;
    }

    // 初始化专职组件
    this.requestHandler = new OpenAIRequestHandler();
    this.responseParser = new OpenAIResponseParser(this.config.name);
    this.streamProcessor = new OpenAIStreamProcessor();
    this.retryStrategy = new OpenAIRetryStrategy({
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    });
  }

  getSupportedModels(): string[] {
    return [...this.config.models];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const timer = createTimer();
    const { model, messages, tools, temperature, maxTokens } = request;

    logMethodCall(logger, {
      method: "chat",
      module: "OpenAIProvider",
      params: { model, messageCount: messages.length, hasTools: !!tools?.length },
    });

    try {
      const actualModel = this.parseModelName(model || this.defaultModel);
      const body = this.buildRequestBody(actualModel, messages, tools, temperature, maxTokens);

      logger.info("LLM调用", {
        provider: this.name,
        model: actualModel,
        endpoint: "chat/completions",
        stream: false,
      });

      // 使用重试策略执行请求
      const retryResult = await this.retryStrategy.execute(async () => {
        const response = await this.requestHandler.sendRequest({
          url: `${this.config.baseUrl}/chat/completions`,
          body,
          headers: this.cachedHeaders,
          timeout: this.timeout,
        });

        if (this.requestHandler.isError(response)) {
          throw new Error(
            `${this.config.name} API 错误: ${this.requestHandler.extractErrorMessage(response)}`
          );
        }

        return response.json;
      });

      if (!retryResult.success || !retryResult.result) {
        throw retryResult.error ?? new Error("请求失败");
      }

      this.recordUsage();

      // 解析响应
      const openAIResponse = this.responseParser.validateOpenAIResponse(retryResult.result);
      const result = this.responseParser.parseResponse(openAIResponse);

      // 记录 LLM 完整响应详情
      const llmResponseLog: Record<string, unknown> = {
        provider: this.name,
        model: actualModel,
        text: truncateTextForLog(result.text),
      };
      if (result.reasoning) {
        llmResponseLog.reasoning = truncateTextForLog(result.reasoning);
      }
      if (result.toolCalls?.length) {
        llmResponseLog.toolCalls = result.toolCalls.map((tc) => ({
          name: tc.name,
          arguments: tc.arguments,
        }));
      }
      if (result.usage) {
        llmResponseLog.usage = result.usage;
      }
      logger.info("LLM响应", llmResponseLog);

      logMethodReturn(logger, {
        method: "chat",
        module: "OpenAIProvider",
        result: sanitize(result),
        duration: timer(),
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "chat",
        module: "OpenAIProvider",
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        params: { model, messageCount: messages.length },
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
      module: "OpenAIProvider",
      params: { model, messageCount: messages.length, hasTools: !!tools?.length },
    });

    const actualModel = this.parseModelName(model || this.defaultModel);
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
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.cachedHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${this.config.name} API 错误: ${response.statusText} - ${errorText}`);
      }

      // 使用流式处理器处理响应
      const streamResult = await this.streamProcessor.processStream(response, callback);
      const result = await this.streamProcessor.buildFinalResponse(streamResult, callback);

      this.recordUsage();

      // 记录 LLM 完整响应详情
      const llmResponseLog: Record<string, unknown> = {
        provider: this.name,
        model: actualModel,
        fullText: truncateTextForLog(result.text),
      };
      if (result.reasoning) {
        llmResponseLog.fullReasoning = truncateTextForLog(result.reasoning);
      }
      if (result.toolCalls?.length) {
        llmResponseLog.toolCalls = result.toolCalls.map((tc) => ({
          name: tc.name,
          arguments: tc.arguments,
        }));
      }
      if (result.usage) {
        llmResponseLog.usage = result.usage;
      }
      logger.info("LLM响应", llmResponseLog);

      logMethodReturn(logger, {
        method: "streamChat",
        module: "OpenAIProvider",
        result: sanitize(result),
        duration: timer(),
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logMethodError(logger, {
        method: "streamChat",
        module: "OpenAIProvider",
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        params: { model, messageCount: messages.length },
        duration: timer(),
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 构建请求体
   */
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
      temperature: temperature ?? DEFAULT_TEMPERATURE,
      stream,
    };

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
    }

    return body;
  }

  /**
   * 解析并验证模型名称
   * 支持格式：
   * - "model-name" -> 直接使用
   * - "provider/model-name" -> 验证 provider 匹配后提取 model
   *
   * @throws 如果 provider 不匹配当前 Provider 实例
   */
  private parseModelName(model: string): string {
    const slashIndex = model.indexOf("/");
    if (slashIndex >= 0) {
      const providerName = model.substring(0, slashIndex);
      const modelName = model.substring(slashIndex + 1);

      // 验证 provider 是否匹配当前实例
      if (providerName !== this.name) {
        throw new Error(
          `模型 "${model}" 的 provider "${providerName}" 与当前 Provider "${this.name}" 不匹配`
        );
      }

      return modelName;
    }
    return model;
  }

  /**
   * 转换消息格式
   */
  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      // assistant 消息有 tool_calls 时，content 应为 null（而非空字符串）
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const result: Record<string, unknown> = {
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
        return result;
      }

      // tool 消息：只包含 role、content、tool_call_id
      if (msg.role === "tool") {
        return {
          role: msg.role,
          content: msg.content,
          tool_call_id: msg.toolCallId,
        };
      }

      // 其他消息类型
      return { role: msg.role, content: msg.content };
    });
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

export function createOpenAIProvider(options: OpenAIProviderOptions): OpenAIProvider {
  return new OpenAIProvider(options);
}
