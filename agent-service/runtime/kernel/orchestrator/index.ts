/**
 * Agent 编排器
 *
 * 协调 Planner、ExecutionEngine、ContextManager 等核心组件。
 */

import type { LLMMessage, LLMProvider, GenerationConfig } from '../../../types/provider';
import type { InboundMessage, OutboundMessage } from '../../../types/message';
import type { ToolRegistry } from '../../capability/tool-system';
import type { MemoryManager } from '../../capability/memory';
import type { SessionStore } from '../../../infrastructure/database';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'orchestrator']);

/** 编排器配置 */
export interface OrchestratorConfig {
  /** LLM Provider */
  llmProvider: LLMProvider;
  /** 默认模型 */
  defaultModel: string;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 系统提示词 */
  systemPrompt: string;
  /** 生成配置 */
  generationConfig?: GenerationConfig;
  /** 工作目录 */
  workspace: string;
}

/**
 * Agent 编排器
 */
export class AgentOrchestrator {
  private sessionHistory = new Map<string, LLMMessage[]>();

  constructor(
    private config: OrchestratorConfig,
    private tools: ToolRegistry,
    private memoryManager?: MemoryManager,
    private sessionStore?: SessionStore
  ) {}

  /**
   * 处理用户消息
   */
  async processMessage(msg: InboundMessage): Promise<OutboundMessage> {
    const sessionKey = `${msg.channel}:${msg.chatId}`;

    // 获取会话历史
    const history = await this.getSessionHistory(sessionKey);

    // 检索相关记忆
    const relevantMemories = this.memoryManager
      ? await this.memoryManager.search(msg.content, { limit: 5 })
      : [];

    // 构建上下文
    const messages = this.buildContext(history, msg, relevantMemories);

    // 执行 ReAct 循环
    const result = await this.executeLoop(messages, msg);

    // 更新历史
    messages.push({ role: 'assistant', content: result.answer });
    await this.updateSessionHistory(sessionKey, messages);

    // 存储记忆
    if (this.memoryManager) {
      await this.memoryManager.store({
        type: 'conversation',
        content: msg.content,
        sessionKey,
        importance: 0.5,
      });
    }

    return {
      channel: msg.channel,
      chatId: msg.chatId,
      content: result.answer,
      media: [],
      metadata: msg.metadata,
    };
  }

  /**
   * 获取会话历史
   */
  private async getSessionHistory(sessionKey: string): Promise<LLMMessage[]> {
    if (this.sessionStore) {
      const session = this.sessionStore.getOrCreate(sessionKey);
      return session.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
    }
    return this.sessionHistory.get(sessionKey) ?? [];
  }

  /**
   * 更新会话历史
   */
  private async updateSessionHistory(sessionKey: string, messages: LLMMessage[]): Promise<void> {
    if (this.sessionStore) {
      const newMessages = messages.slice((this.sessionStore.get(sessionKey)?.messages.length ?? 0));
      for (const msg of newMessages) {
        this.sessionStore.appendMessage(sessionKey, {
          role: msg.role as 'user' | 'assistant',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          timestamp: Date.now(),
        });
      }
    } else {
      this.sessionHistory.set(sessionKey, messages);
    }
  }

  /**
   * 构建上下文
   */
  private buildContext(
    history: LLMMessage[],
    msg: InboundMessage,
    memories: Array<{ entry: unknown; score: number }>
  ): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // 系统提示词
    if (this.config.systemPrompt) {
      messages.push({ role: 'system', content: this.config.systemPrompt });
    }

    // 历史消息
    messages.push(...history);

    // 用户消息
    messages.push({ role: 'user', content: msg.content });

    return messages;
  }

  /**
   * 执行 ReAct 循环
   */
  private async executeLoop(messages: LLMMessage[], msg: InboundMessage): Promise<{
    answer: string;
    iterations: number;
  }> {
    const toolDefinitions = this.tools.getToolDefinitions();

    let iterations = 0;
    while (iterations < this.config.maxIterations) {
      iterations++;

      const response = await this.config.llmProvider.chat(
        messages,
        toolDefinitions,
        this.config.defaultModel,
        this.config.generationConfig
      );

      // 检查是否有工具调用
      if (!response.hasToolCalls || !response.toolCalls?.length) {
        return { answer: response.content || '', iterations };
      }

      // 执行工具
      for (const tc of response.toolCalls) {
        const result = await this.tools.executeTool(tc.name, tc.arguments, {
          channel: msg.channel,
          chatId: msg.chatId,
          workspace: this.config.workspace,
          currentDir: this.config.workspace,
          sendToBus: async () => {},
        });

        messages.push({ role: 'assistant', content: '', toolCalls: [tc] });
        messages.push({
          role: 'tool',
          content: result.content ? JSON.stringify(result.content) : result,
          toolCallId: tc.id,
        });
      }
    }

    return { answer: '抱歉，我无法完成您的请求。', iterations };
  }

  /**
   * 清除会话
   */
  clearSession(channel: string, chatId: string): void {
    const sessionKey = `${channel}:${chatId}`;
    this.sessionStore?.delete(sessionKey);
    this.sessionHistory.delete(sessionKey);
    log.debug('会话已清除', { sessionKey });
  }
}