/**
 * 消息构建器
 *
 * 负责消息列表构建、格式化和压缩
 */

import type { InboundMessage, LLMMessage, MessageContent } from '@micro-agent/types';
import type { MemoryEntry } from '../types';
import type { AgentExecutorConfig } from './types';
import { buildUserContent, convertToPlainText } from '@micro-agent/providers';
import { MessageHistoryManager } from '../message-manager';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['executor', 'message']);

/**
 * 消息构建器
 */
export class MessageBuilder {
  private messageManager: MessageHistoryManager;

  constructor(config: Pick<AgentExecutorConfig, 'maxHistoryMessages'> = {}) {
    this.messageManager = new MessageHistoryManager({
      maxMessages: config.maxHistoryMessages ?? 50,
      truncationStrategy: 'sliding',
      preserveSystemMessages: true,
      preserveRecentCount: 10,
    });
  }

  /**
   * 构建消息列表
   */
  buildMessages(history: LLMMessage[], msg: InboundMessage, memories?: MemoryEntry[]): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // 构建系统提示（包含记忆上下文）
    const systemPrompt = this.buildSystemPrompt(memories, msg);
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
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
   * 构建系统提示（包含记忆上下文）
   */
  private buildSystemPrompt(memories?: MemoryEntry[], msg?: InboundMessage): string {
    let prompt = msg?.metadata?.systemPrompt as string ?? '';

    // 注入记忆上下文
    if (memories && memories.length > 0) {
      const memoryContext = this.formatMemoryContext(memories);
      prompt = prompt 
        ? `${prompt}\n\n${memoryContext}` 
        : memoryContext;
      
      log.info('💉 记忆已注入系统提示', { 
        memoryCount: memories.length,
        contextLength: memoryContext.length 
      });
    }

    return prompt;
  }

  /**
   * 格式化记忆上下文
   */
  private formatMemoryContext(memories: MemoryEntry[]): string {
    const lines = ['<relevant-memories>', '以下是相关的历史记忆，仅供参考：'];
    
    for (const m of memories) {
      const timeLabel = m.type === 'summary' ? '[摘要]' : '[对话]';
      const preview = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
      lines.push(`- ${timeLabel} ${preview}`);
    }
    
    lines.push('</relevant-memories>');
    
    log.debug('📝 格式化记忆上下文', { 
      memoryCount: memories.length,
      types: memories.map(m => m.type),
      totalLength: lines.join('\n').length
    });
    
    return lines.join('\n');
  }

  /**
   * 截断消息列表
   */
  truncateMessages(messages: LLMMessage[]): LLMMessage[] {
    return this.messageManager.truncate(messages);
  }

  /**
   * 压缩消息历史
   */
  compressMessages(messages: LLMMessage[]): void {
    const compressed = this.messageManager.compressToolResults(messages);
    messages.length = 0;
    messages.push(...compressed);
  }

  /**
   * 确保消息列表包含系统提示词
   */
  ensureSystemPrompt(messages: LLMMessage[], systemPrompt?: string): LLMMessage[] {
    const hasSystem = messages.some(m => m.role === 'system');
    if (hasSystem || !systemPrompt) {
      return messages;
    }
    return [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
  }

  /**
   * 转换为纯文本消息（非视觉模型）
   */
  convertToPlainText(messages: LLMMessage[]): LLMMessage[] {
    return convertToPlainText(messages);
  }

  /**
   * 修复 tool 消息依赖关系
   * 
   * 确保每个 tool 消息都有对应的 assistant+tool_calls 消息
   * 移除孤立的 tool 消息，避免 API 错误
   */
  fixToolMessageDependencies(messages: LLMMessage[]): LLMMessage[] {
    const result: LLMMessage[] = [];
    
    // 收集所有有效的 tool_call_id
    const validToolCallIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.id) validToolCallIds.add(tc.id);
        }
      }
    }
    
    // 过滤消息，保留有效的 tool 消息
    for (const msg of messages) {
      if (msg.role === 'tool') {
        // tool 消息必须有对应的 tool_call_id
        if (msg.toolCallId && validToolCallIds.has(msg.toolCallId)) {
          result.push(msg);
        } else {
          log.debug('丢弃孤立的 tool 消息', { toolCallId: msg.toolCallId });
        }
      } else {
        result.push(msg);
      }
    }
    
    return result;
  }
}