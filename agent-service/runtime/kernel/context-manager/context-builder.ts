/**
 * 上下文构建器
 *
 * 构建和压缩对话上下文。
 */

import type { LLMMessage } from '../../../types/message';
import type { TokenBudget } from './token-budget';
import { getTokenEstimator } from './token-estimator';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'context-builder']);

/** 上下文构建器配置 */
export interface ContextBuilderConfig {
  /** 最大历史消息数 */
  maxHistoryMessages: number;
}

/**
 * 上下文构建器
 */
export class ContextBuilder {
  constructor(private config: ContextBuilderConfig) {}

  /**
   * 构建上下文
   */
  build(messages: LLMMessage[], tokenBudget: TokenBudget): LLMMessage[] {
    // 确保有系统提示词
    if (messages.length > 0 && messages[0].role !== 'system') {
      messages = [{ role: 'system', content: '' }, ...messages];
    }

    // 压缩到 Token 预算范围内
    const remainingTokens = tokenBudget.getRemaining();
    return this.compress(messages, remainingTokens);
  }

  /**
   * 压缩消息
   */
  compress(messages: LLMMessage[], maxTokens: number): LLMMessage[] {
    if (messages.length <= this.config.maxHistoryMessages) {
      return messages;
    }

    // 保留系统提示词
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // 滑动窗口策略
    const preservedRecent = Math.min(10, conversationMessages.length);
    const recentMessages = conversationMessages.slice(-preservedRecent);

    // 计算可保留的旧消息数量
    const availableTokens = maxTokens - this.estimateTokensBatch(recentMessages);
    const oldMessages = this.selectOldMessages(
      conversationMessages.slice(0, -preservedRecent),
      availableTokens
    );

    const result: LLMMessage[] = [];
    if (systemMessage) {
      result.push(systemMessage);
    }
    result.push(...oldMessages, ...recentMessages);

    log.debug('[ContextBuilder] 消息压缩', {
      original: messages.length,
      compressed: result.length,
    });

    return result;
  }

  /**
   * 选择旧消息
   */
  private selectOldMessages(messages: LLMMessage[], maxTokens: number): LLMMessage[] {
    const selected: LLMMessage[] = [];
    let usedTokens = 0;

    // 从最早的开始选择
    for (const msg of messages) {
      const msgTokens = this.estimateTokens(msg);
      if (usedTokens + msgTokens <= maxTokens) {
        selected.push(msg);
        usedTokens += msgTokens;
      } else {
        break;
      }
    }

    return selected;
  }

  /**
   * 估算 Token 数量
   *
   * 使用统一的 TokenEstimator 进行估算，支持中英文智能检测。
   */
  private estimateTokens(message: LLMMessage): number {
    return getTokenEstimator().estimateMessage(message);
  }

  /**
   * 批量估算 Token 数量
   */
  private estimateTokensBatch(messages: LLMMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateTokens(msg), 0);
  }

  /**
   * 清理孤立的工具消息
   */
  fixToolMessageDependencies(messages: LLMMessage[]): LLMMessage[] {
    const result: LLMMessage[] = [];
    const validToolCallIds = new Set<string>();

    // 第一次遍历：收集有效的 toolCallId
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          validToolCallIds.add(tc.id);
        }
      }
    }

    // 第二次遍历：保留消息
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'tool') {
        // 只保留有对应 toolCallId 的 tool 消息
        if (msg.toolCallId && validToolCallIds.has(msg.toolCallId)) {
          result.push(msg);
        }
      } else {
        result.push(msg);
      }
    }

    const removedCount = messages.length - result.length;
    if (removedCount > 0) {
      log.debug('[ContextBuilder] 清理孤立工具消息', { removedCount });
    }

    return result;
  }

  /**
   * 确保有系统提示词
   */
  ensureSystemPrompt(messages: LLMMessage[], systemPrompt: string): LLMMessage[] {
    if (messages.length > 0 && messages[0].role === 'system') {
      // 更新现有系统提示词
      messages[0] = { ...messages[0], content: systemPrompt };
    } else {
      // 添加系统提示词
      messages = [{ role: 'system', content: systemPrompt }, ...messages];
    }
    return messages;
  }

  /**
   * 转换为纯文本消息（移除多模态内容）
   */
  convertToPlainText(messages: LLMMessage[]): LLMMessage[] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return msg;
      }

      // 将多模态内容转换为文本描述
      const textParts = msg.content.filter(p => p.type === 'text');
      const text = textParts.map(p => (p as { text: string }).text).join('\n');

      return {
        ...msg,
        content: text || '[包含非文本内容]',
      };
    });
  }

  /**
   * 截断消息
   */
  truncateMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages.slice(-this.config.maxHistoryMessages);
  }
}
