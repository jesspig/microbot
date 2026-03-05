/**
 * 上下文管理器
 *
 * 管理对话上下文、Token 预算和会话状态。
 */

import type { LLMMessage, SessionKey } from '../../../types/message';
import type { SessionStore } from '../../../infrastructure/database';
import { TokenBudget } from './token-budget';
import { ContextBuilder } from './context-builder';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'context-manager']);

/** 上下文管理器配置 */
export interface ContextManagerConfig {
  /** 最大 Token 数量 */
  maxTokens: number;
  /** 最大历史消息数 */
  maxHistoryMessages: number;
  /** System Prompt 预留 Token 数 */
  systemPromptTokens?: number;
  /** 工具定义预留 Token 数 */
  toolsTokens?: number;
}

/** 上下文状态 */
export interface ContextState {
  /** 会话 Key */
  sessionKey: SessionKey;
  /** 消息历史 */
  messages: LLMMessage[];
  /** Token 预算 */
  tokenBudget: TokenBudget;
  /** 上下文变量 */
  variables: Record<string, unknown>;
}

/**
 * 上下文管理器
 */
export class ContextManager {
  private contexts = new Map<SessionKey, ContextState>();
  private tokenBudget: TokenBudget;
  private contextBuilder: ContextBuilder;

  constructor(
    private config: ContextManagerConfig,
    private sessionStore?: SessionStore
  ) {
    this.tokenBudget = new TokenBudget({
      total: config.maxTokens,
      system: config.systemPromptTokens ?? 1000,
      tools: config.toolsTokens ?? 500,
      context: 0,
      rag: 0,
    });
    this.contextBuilder = new ContextBuilder(config.maxHistoryMessages);
  }

  /**
   * 获取或创建上下文
   */
  async getContext(sessionKey: SessionKey): Promise<ContextState> {
    let context = this.contexts.get(sessionKey);

    if (!context) {
      const messages = await this.loadMessages(sessionKey);
      context = {
        sessionKey,
        messages,
        tokenBudget: this.tokenBudget.clone(),
        variables: {},
      };
      this.contexts.set(sessionKey, context);
    }

    return context;
  }

  /**
   * 添加消息
   */
  async addMessage(sessionKey: SessionKey, message: LLMMessage): Promise<void> {
    const context = await this.getContext(sessionKey);
    context.messages.push(message);

    // 更新 Token 使用
    const tokenCount = this.estimateTokens(message);
    context.tokenBudget.useTokens('context', tokenCount);

    // 压缩历史
    await this.compressContext(sessionKey);
  }

  /**
   * 获取当前上下文消息
   */
  async getCurrentContext(sessionKey: SessionKey, includeSystem = true): Promise<LLMMessage[]> {
    const context = await this.getContext(sessionKey);

    let messages = context.messages.slice();

    // 如果需要包含系统提示词，确保存在
    if (includeSystem && messages.length > 0 && messages[0].role !== 'system') {
      messages = [{ role: 'system', content: '' }, ...messages];
    }

    return this.contextBuilder.build(messages, context.tokenBudget);
  }

  /**
   * 设置变量
   */
  setVariable(sessionKey: SessionKey, name: string, value: unknown): void {
    const context = this.contexts.get(sessionKey);
    if (context) {
      context.variables[name] = value;
    }
  }

  /**
   * 获取变量
   */
  getVariable(sessionKey: SessionKey, name: string): unknown {
    const context = this.contexts.get(sessionKey);
    return context?.variables[name];
  }

  /**
   * 清除会话
   */
  async clearSession(sessionKey: SessionKey): Promise<void> {
    this.contexts.delete(sessionKey);
    this.sessionStore?.delete(sessionKey);
    log.debug('[ContextManager] 会话已清除', { sessionKey });
  }

  /**
   * 加载消息
   */
  private async loadMessages(sessionKey: SessionKey): Promise<LLMMessage[]> {
    if (this.sessionStore) {
      const session = this.sessionStore.getOrCreate(sessionKey);
      return session.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        toolCallId: m.tool_call_id,
        toolCalls: m.tool_calls,
      }));
    }
    return [];
  }

  /**
   * 压缩上下文
   */
  private async compressContext(sessionKey: SessionKey): Promise<void> {
    const context = await this.getContext(sessionKey);
    const messages = this.contextBuilder.compress(
      context.messages,
      context.tokenBudget.getRemaining()
    );

    if (messages.length < context.messages.length) {
      log.debug('[ContextManager] 压缩上下文', {
        original: context.messages.length,
        compressed: messages.length,
      });
    }

    context.messages = messages;

    // 持久化
    if (this.sessionStore) {
      this.sessionStore.delete(sessionKey);
      for (const msg of messages) {
        this.sessionStore.appendMessage(sessionKey, {
          role: msg.role as 'user' | 'assistant' | 'system',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          timestamp: Date.now(),
          tool_call_id: msg.toolCallId,
          tool_calls: msg.toolCalls,
        });
      }
    }
  }

  /**
   * 估算 Token 数量
   */
  private estimateTokens(message: LLMMessage): number {
    // 简化实现：按字符数估算
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    return Math.ceil(content.length / 4); // 假设 1 token ≈ 4 字符
  }
}