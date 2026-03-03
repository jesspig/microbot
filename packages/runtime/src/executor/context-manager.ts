/**
 * 上下文管理器
 *
 * 负责会话历史管理、上下文创建和会话清理
 */

import type { SessionKey, LLMMessage } from '@micro-agent/types';
import type { SessionStore } from '@micro-agent/storage';
import type { OutboundMessage, InboundMessage } from '@micro-agent/types';
import { MessageHistoryManager } from '../message-manager';
import { getLogger } from '@logtape/logtape';
import { MAX_SESSIONS } from './types';

const log = getLogger(['executor', 'context']);

/**
 * 上下文管理器
 */
export class ContextManager {
  private conversationHistory = new Map<SessionKey, LLMMessage[]>();
  private messageManager: MessageHistoryManager;

  constructor(
    private sessionStore?: SessionStore,
    config: { maxHistoryMessages?: number } = {}
  ) {
    this.messageManager = new MessageHistoryManager({
      maxMessages: config.maxHistoryMessages ?? 50,
      truncationStrategy: 'sliding',
      preserveSystemMessages: true,
      preserveRecentCount: 10,
    });
  }

  /**
   * 获取会话历史
   */
  async getSessionHistory(sessionKey: SessionKey): Promise<LLMMessage[]> {
    // 优先使用 SessionStore，否则使用内存
    if (this.sessionStore) {
      const session = this.sessionStore.getOrCreate(sessionKey);
      return session.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        // 保留工具调用相关字段（映射字段名）
        toolCallId: m.tool_call_id,
        toolCalls: m.tool_calls as LLMMessage['toolCalls'],
      }));
    } else {
      return this.conversationHistory.get(sessionKey) ?? [];
    }
  }

  /**
   * 更新会话历史（增量追加）
   */
  updateHistory(sessionKey: SessionKey, history: LLMMessage[]): void {
    // 优先使用 SessionStore 持久化
    if (this.sessionStore) {
      // 获取当前会话的消息数量
      const session = this.sessionStore.getOrCreate(sessionKey);
      const existingCount = session.messages.length;

      // 计算需要追加的新消息（基于现有数量计算新增数量）
      const newMessages = history.slice(existingCount);

      // 只追加新消息（保留 toolCallId 和 toolCalls 字段）
      for (const msg of newMessages) {
        this.sessionStore.appendMessage(sessionKey, {
          role: msg.role as 'user' | 'assistant' | 'system',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          timestamp: Date.now(),
          // 保留工具调用相关字段
          tool_call_id: msg.toolCallId,
          tool_calls: msg.toolCalls,
        });
      }

      // 如果超过最大消息数，裁剪旧消息（保留最近的）
      const maxMessages = 500;
      const totalMessages = existingCount + newMessages.length;
      if (totalMessages > maxMessages) {
        const deleteCount = totalMessages - maxMessages;
        this.sessionStore.trimOldMessages(sessionKey, deleteCount);
      }
    } else {
      // 回退到内存存储
      const trimmed = this.messageManager.truncate(history);
      this.conversationHistory.set(sessionKey, trimmed);
      this.trimSessions();
    }
  }

  /**
   * 清除会话历史
   */
  clearSession(channel: string, chatId: string): void {
    const sessionKey = `${channel}:${chatId}` as SessionKey;
    
    if (this.sessionStore) {
      this.sessionStore.delete(sessionKey);
    } else {
      this.conversationHistory.delete(sessionKey);
    }
    
    log.debug('会话已清除', { sessionKey });
  }

  /**
   * 清理过期会话（仅内存模式）
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
  createErrorResponse(msg: InboundMessage): OutboundMessage {
    return {
      channel: msg.channel,
      chatId: msg.chatId,
      content: '处理消息时发生内部错误，请稍后重试',
      media: [],
      metadata: msg.metadata,
    };
  }
}