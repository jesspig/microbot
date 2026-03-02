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
    // 区分文档记忆和其他记忆
    const documentMemories = memories.filter(m => m.type === 'document' || m.metadata.documentTitle);
    const otherMemories = memories.filter(m => m.type !== 'document' && !m.metadata.documentTitle);
    
    const lines: string[] = [];
    
    // 文档记忆（知识库）- 需要引用
    if (documentMemories.length > 0) {
      lines.push('<knowledge-documents>');
      lines.push('以下是知识库中检索到的相关文档内容。**回答时必须标注来源**，格式：`(来源: 文档名称, 页码X)`');
      lines.push('');
      
      for (let i = 0; i < documentMemories.length; i++) {
        const m = documentMemories[i];
        const sourceInfo = this.buildDocumentSourceInfo(m);
        const preview = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
        
        lines.push(`---`);
        lines.push(`【文档 ${i + 1}】${sourceInfo}`);
        lines.push(preview);
      }
      
      lines.push('');
      lines.push('</knowledge-documents>');
    }
    
    // 其他记忆（对话历史、偏好等）- 不需要引用
    if (otherMemories.length > 0) {
      lines.push('<relevant-memories>');
      lines.push('以下是相关的历史记忆：');
      lines.push('');
      
      for (const m of otherMemories) {
        const typeLabel = this.getMemoryTypeLabel(m.type);
        const preview = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
        lines.push(`- [${typeLabel}] ${preview}`);
      }
      
      lines.push('</relevant-memories>');
    }
    
    log.debug('📝 格式化记忆上下文', { 
      documentCount: documentMemories.length,
      memoryCount: otherMemories.length,
      totalLength: lines.join('\n').length
    });
    
    return lines.join('\n');
  }

  /**
   * 构建文档来源信息
   */
  private buildDocumentSourceInfo(memory: MemoryEntry): string {
    const { metadata } = memory;
    const parts: string[] = [];
    
    if (metadata.documentTitle) {
      parts.push(`文档: ${metadata.documentTitle}`);
    }
    if (metadata.pageNumber) {
      parts.push(`页码: ${metadata.pageNumber}`);
    }
    if (metadata.section) {
      parts.push(`章节: ${metadata.section}`);
    }
    if (metadata.score) {
      parts.push(`相似度: ${(metadata.score * 100).toFixed(1)}%`);
    }
    
    return parts.length > 0 ? `(${parts.join(' | ')})` : '';
  }

  /**
   * 获取记忆类型标签
   */
  private getMemoryTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      fact: '事实',
      preference: '偏好',
      decision: '决策',
      entity: '实体',
      conversation: '对话',
      summary: '摘要',
      other: '其他',
    };
    return labels[type] || type;
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