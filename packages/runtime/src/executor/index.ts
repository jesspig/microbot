/**
 * Agent 执行器
 *
 * 实现 ReAct 循环处理消息并协调工具调用。
 */

import type { InboundMessage, OutboundMessage, ToolContext, ToolCall, ToolResult } from '@microbot/types';
import type { LLMGateway, LLMMessage, LLMToolDefinition, GenerationConfig, MessageContent } from '@microbot/providers';
import type { MessageBus } from '../bus/queue';
import type { ModelConfig, RoutingConfig } from '@microbot/config';
import { ModelRouter, convertToPlainText, buildUserContent, type RouteResult } from '@microbot/providers';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['executor']);

/** 最大会话数量（防止内存泄漏） */
const MAX_SESSIONS = 1000;

/** 每个会话最大历史消息数 */
const MAX_HISTORY_PER_SESSION = 50;

/** 最大媒体数量 */
const MAX_MEDIA_COUNT = 10;

/**
 * 工具注册表接口（避免循环依赖）
 */
export interface ToolRegistryLike {
  getDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }>;
  execute(name: string, input: unknown, ctx: ToolContext): Promise<string>;
}

/**
 * 将工具定义转换为 LLM 格式
 */
function toLLMToolDefinitions(tools: Array<{ name: string; description: string; inputSchema: unknown }>): LLMToolDefinition[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Agent 配置
 */
export interface AgentExecutorConfig {
  /** 工作目录 */
  workspace: string;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 最大 tokens */
  maxTokens: number;
  /** 温度 */
  temperature: number;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 自动路由 */
  auto?: boolean;
  /** 性能优先模式 */
  max?: boolean;
  /** 对话模型 */
  chatModel?: string;
  /** 意图识别模型 */
  checkModel?: string;
  /** 可用模型列表 */
  availableModels?: Map<string, ModelConfig[]>;
  /** 路由配置 */
  routing?: RoutingConfig;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  workspace: './workspace',
  maxIterations: 20,
  maxTokens: 8192,
  temperature: 0.7,
  auto: true,
  max: false,
};

/**
 * Agent 执行器
 */
export class AgentExecutor {
  private running = false;
  private conversationHistory = new Map<string, LLMMessage[]>();
  private router: ModelRouter;
  private cachedToolDefinitions: LLMToolDefinition[] | null = null;

  constructor(
    private bus: MessageBus,
    private gateway: LLMGateway,
    private tools: ToolRegistryLike,
    private config: AgentExecutorConfig = DEFAULT_CONFIG
  ) {
    this.router = new ModelRouter({
      chatModel: config.chatModel || '',
      checkModel: config.checkModel,
      auto: config.auto ?? true,
      max: config.max ?? false,
      models: config.availableModels ?? new Map(),
      routing: config.routing,
    });
    this.router.setProvider(gateway);
  }

  /**
   * 启动执行器
   */
  async run(): Promise<void> {
    this.running = true;
    log.info('Agent 执行器已启动');

    log.debug('配置详情', {
      maxIterations: this.config.maxIterations,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      auto: this.config.auto,
      max: this.config.max,
    });

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();

        // CLI: 用户输入
        log.info('📥 用户输入', { content: msg.content });

        log.debug('消息详情', {
          channel: msg.channel,
          chatId: msg.chatId,
          senderId: msg.senderId,
          mediaCount: msg.media?.length ?? 0,
        });

        const startTime = Date.now();
        const response = await this.processMessage(msg);
        const elapsed = Date.now() - startTime;

        if (response) {
          await this.bus.publishOutbound(response);
          log.info('📤 回复已发送', { elapsed: `${elapsed}ms` });
        }
      } catch (error) {
        log.error('❌ 处理消息失败', { error: this.safeErrorMsg(error) });
      }
    }
  }

  /**
   * 停止执行器
   */
  stop(): void {
    this.running = false;
    log.info('Agent 执行器已停止');
  }

  /**
   * 处理单条消息
   */
  async processMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    const sessionKey = `${msg.channel}:${msg.chatId}`;
    const sessionHistory = this.conversationHistory.get(sessionKey) ?? [];

    const messages = this.buildMessages(sessionHistory, msg);

    try {
      const result = await this.runReActLoop(messages, msg);
      this.updateHistory(sessionKey, messages.slice(1));

      return {
        channel: msg.channel,
        chatId: msg.chatId,
        content: result.content || '处理完成',
        media: [],
        metadata: msg.metadata,
      };
    } catch (error) {
      log.error('❌ 处理消息异常', { error: this.safeErrorMsg(error) });
      return this.createErrorResponse(msg);
    }
  }

  /**
   * 构建消息列表
   */
  private buildMessages(history: LLMMessage[], msg: InboundMessage): LLMMessage[] {
    const messages: LLMMessage[] = [];

    if (this.config.systemPrompt) {
      messages.push({ role: 'system', content: this.config.systemPrompt });
    }

    messages.push(...history);

    const userContent: MessageContent = buildUserContent(msg.content, msg.media);
    messages.push({ role: 'user', content: userContent });

    if (msg.media && msg.media.length > 0) {
      log.info('📎 媒体', { count: msg.media.length });
    }

    return messages;
  }

  /**
   * 运行 ReAct 循环
   */
  private async runReActLoop(messages: LLMMessage[], msg: InboundMessage): Promise<{ content: string }> {
    let iteration = 0;
    let lastContent = '';
    const toolDefinitions = this.getToolDefinitions();

    while (iteration < this.config.maxIterations) {
      iteration++;

      const routeResult = await this.selectModel(messages, msg.media, iteration);
      const generationConfig = this.mergeGenerationConfig(routeResult.config);

      const processedMessages = routeResult.config.vision
        ? messages
        : convertToPlainText(messages);

      // CLI: 模型选择
      log.info('🤖 调用模型', { model: routeResult.model, reason: routeResult.reason });

      log.debug('路由详情', {
        provider: routeResult.config.id,
        vision: routeResult.config.vision,
        iteration,
      });

      const llmStartTime = Date.now();
      const response = await this.gateway.chat(processedMessages, toolDefinitions, routeResult.model, generationConfig);
      const llmElapsed = Date.now() - llmStartTime;

      // CLI: LLM 响应统计
      log.info('💬 LLM 响应', {
        model: `${response.usedProvider}/${response.usedModel}`,
        tokens: response.usage ? `${response.usage.inputTokens}→${response.usage.outputTokens}` : 'N/A',
        elapsed: `${llmElapsed}ms`,
      });

      // 文件日志: 详细响应
      log.debug('LLM 详细响应', {
        content: response.content,
        hasToolCalls: response.hasToolCalls,
        toolCallCount: response.toolCalls?.length ?? 0,
        usage: response.usage,
      });

      messages.push(this.buildAssistantMessage(response));

      if (!response.hasToolCalls || !response.toolCalls || response.toolCalls.length === 0) {
        // CLI: 最终回复
        log.info('📝 回复', { content: response.content });
        return { content: response.content };
      }

      lastContent = await this.executeToolCalls(response.toolCalls, msg, messages);
    }

    log.warn('⚠️ 达到最大迭代次数', { maxIterations: this.config.maxIterations });
    return { content: lastContent };
  }

  /**
   * 获取工具定义
   */
  private getToolDefinitions(): LLMToolDefinition[] {
    if (!this.cachedToolDefinitions) {
      this.cachedToolDefinitions = toLLMToolDefinitions(this.tools.getDefinitions());
    }
    return this.cachedToolDefinitions;
  }

  /**
   * 构建助手消息
   */
  private buildAssistantMessage(response: { content: string; toolCalls?: ToolCall[] }): LLMMessage {
    const msg: LLMMessage = { role: 'assistant', content: response.content };
    if (response.toolCalls && response.toolCalls.length > 0) {
      msg.toolCalls = response.toolCalls;
    }
    return msg;
  }

  /**
   * 执行工具调用
   */
  private async executeToolCalls(toolCalls: ToolCall[], msg: InboundMessage, messages: LLMMessage[]): Promise<string> {
    let lastResult = '';

    for (const toolCall of toolCalls) {
      const startTime = Date.now();

      // CLI: 工具调用
      log.info('🔧 工具调用', { tool: toolCall.name });

      log.debug('工具参数', { args: toolCall.arguments });

      const result = await this.runTool(toolCall, msg);
      const elapsed = Date.now() - startTime;

      // CLI: 工具结果
      log.info('✅ 工具结果', { tool: toolCall.name, elapsed: `${elapsed}ms`, result });

      messages.push({ role: 'tool', content: result, toolCallId: toolCall.id });
      lastResult = result;
    }

    return lastResult;
  }

  /**
   * 执行单个工具
   */
  private async runTool(toolCall: ToolCall, msg: InboundMessage): Promise<string> {
    try {
      return await this.tools.execute(toolCall.name, toolCall.arguments, this.createContext(msg));
    } catch (error) {
      log.error('❌ 工具执行失败', { tool: toolCall.name, error: this.safeErrorMsg(error) });
      return JSON.stringify({ error: '工具执行失败', tool: toolCall.name });
    }
  }

  /**
   * 更新会话历史
   */
  private updateHistory(sessionKey: string, history: LLMMessage[]): void {
    const trimmed = history.length > MAX_HISTORY_PER_SESSION
      ? history.slice(-MAX_HISTORY_PER_SESSION)
      : history;

    this.conversationHistory.set(sessionKey, trimmed);
    this.trimSessions();
  }

  /**
   * 清理过期会话
   */
  private trimSessions(): void {
    if (this.conversationHistory.size <= MAX_SESSIONS) return;

    const keysToDelete = Array.from(this.conversationHistory.keys())
      .slice(0, this.conversationHistory.size - MAX_SESSIONS);

    for (const key of keysToDelete) {
      this.conversationHistory.delete(key);
    }

    log.debug('清理过期会话', { count: keysToDelete.length });
  }

  /**
   * 创建错误响应
   */
  private createErrorResponse(msg: InboundMessage): OutboundMessage {
    return {
      channel: msg.channel,
      chatId: msg.chatId,
      content: '处理消息时发生内部错误，请稍后重试',
      media: [],
      metadata: msg.metadata,
    };
  }

  /**
   * 创建工具上下文
   */
  createContext(msg: InboundMessage): ToolContext {
    return {
      channel: msg.channel,
      chatId: msg.chatId,
      workspace: this.config.workspace,
      currentDir: msg.currentDir || this.config.workspace,
      sendToBus: async (m) => this.bus.publishOutbound(m as OutboundMessage),
    };
  }

  /**
   * 清除会话历史
   */
  clearSession(channel: string, chatId: string): void {
    const sessionKey = `${channel}:${chatId}`;
    this.conversationHistory.delete(sessionKey);
    log.debug('会话已清除', { sessionKey });
  }

  /**
   * 选择模型
   */
  private async selectModel(
    messages: LLMMessage[],
    media: string[] | undefined,
    iteration: number
  ): Promise<RouteResult> {
    if (iteration === 1 && this.config.auto) {
      const intent = await this.router.analyzeIntent(messages, media);

      // CLI: 意图识别
      log.info('🎯 意图识别', { model: intent.model, reason: intent.reason });

      return this.router.selectModelByIntent(intent);
    }

    return this.router.route(messages, iteration === 1 ? media : undefined);
  }

  /**
   * 合并生成配置
   */
  private mergeGenerationConfig(modelConfig: ModelConfig): GenerationConfig {
    const merged: GenerationConfig = {
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    if (modelConfig.maxTokens !== undefined) merged.maxTokens = modelConfig.maxTokens;
    if (modelConfig.temperature !== undefined) merged.temperature = modelConfig.temperature;
    if (modelConfig.topK !== undefined) merged.topK = modelConfig.topK;
    if (modelConfig.topP !== undefined) merged.topP = modelConfig.topP;
    if (modelConfig.frequencyPenalty !== undefined) merged.frequencyPenalty = modelConfig.frequencyPenalty;

    return merged;
  }

  /**
   * 安全的错误消息（脱敏）
   */
  private safeErrorMsg(error: unknown): string {
    if (!(error instanceof Error)) return '未知错误';

    let msg = error.message;
    msg = msg.replace(/[A-Z]:\\[^\s]+/gi, '[路径]');
    msg = msg.replace(/[a-zA-Z0-9_-]{20,}/g, '[密钥]');

    return msg;
  }
}