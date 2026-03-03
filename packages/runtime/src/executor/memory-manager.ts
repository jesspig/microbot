/**
 * 记忆管理器
 *
 * 负责记忆检索、存储和摘要管理
 */

import type { InboundMessage, LLMMessage } from '@micro-agent/types';
import type { MemoryEntry, MemoryEntryType, AgentLoopResult } from '../types';
import type { MemoryStore, ConversationSummarizer } from '../memory';
import type { SessionKey } from '@micro-agent/types';
import { getLogger } from '@logtape/logtape';
import { classifyMemory } from '../memory';

const log = getLogger(['executor', 'memory']);

/**
 * 记忆管理器
 */
export class MemoryManager {
  private storeMemoryResult: { success: boolean; error?: string } = { success: true };

  constructor(
    private memoryStore?: MemoryStore,
    private summarizer?: ConversationSummarizer,
    private config: {
      memoryEnabled?: boolean;
      summarizeThreshold?: number;
    } = {}
  ) {}

  /**
   * 检索相关记忆（包含知识库）
   * 
   * 使用双层检索架构统一检索对话记忆和知识库内容
   */
  async retrieveMemories(query: string, memoryTypes?: MemoryEntryType[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];

    // 使用 MemoryStore 的双层检索（统一检索记忆和知识库）
    if (this.memoryStore) {
      try {
        // 构建过滤条件
        const filter = memoryTypes && memoryTypes.length > 0
          ? { type: memoryTypes }
          : undefined;

        // 使用 dualLayerSearch 统一检索
        const memories = await this.memoryStore.dualLayerSearch(query, 8, 200, filter);
        results.push(...memories);
        log.debug('记忆检索完成', { count: memories.length, filter });
      } catch (error) {
        log.warn('记忆检索失败', { error: error instanceof Error ? error.message : String(error) });
      }
    } else {
      log.debug('MemoryStore 为空，跳过检索');
    }

    return results;
  }

  /**
   * 存储记忆
   *
   * 包含最多 2 次重试机制，存储失败时会向上传递错误状态。
   * 使用分类器自动识别记忆类型。
   */
  async storeMemory(
    msg: InboundMessage,
    result: AgentLoopResult,
    sessionKey: SessionKey
  ): Promise<void> {
    if (!this.memoryStore) {
      log.debug('记忆系统未启用，跳过存储');
      return;
    }

    // 使用分类器自动分类用户输入
    const classification = await classifyMemory(msg.content);
    const memoryType = classification.type;

    // 构建记忆内容
    const content = `用户: ${msg.content}\n助手: ${result.content}`;

    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      sessionId: sessionKey,
      type: memoryType,
      content: content,
      metadata: {
        channel: msg.channel,
        classification: {
          confidence: classification.confidence,
          matchedPatterns: classification.matchedPatterns,
        },
        tags: [memoryType, 'conversation'],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 带重试的存储操作
    const maxRetries = 2;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        await this.memoryStore.store(entry);
        
        log.info('💾 记忆已存储', {
          id: entry.id,
          sessionKey,
          type: entry.type,
          confidence: classification.confidence.toFixed(2),
          matched: classification.matchedPatterns.length > 0 ? classification.matchedPatterns.slice(0, 2) : undefined,
          attempt: attempt > 1 ? attempt : undefined,
          userMsg: msg.content.slice(0, 50) + '...',
          assistantMsg: result.content?.slice(0, 50) + '...'
        });
        
        this.storeMemoryResult = { success: true };
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log.warn('记忆存储失败', { 
          attempt, 
          maxRetries: maxRetries + 1, 
          error: lastError.message 
        });
        
        // 非最后一次尝试，等待后重试
        if (attempt <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        }
      }
    }

    // 所有重试都失败，记录错误状态并向上传递
    const errorMsg = lastError?.message ?? '未知错误';
    this.storeMemoryResult = { success: false, error: errorMsg };
    
    log.error('❌ 记忆存储最终失败', { 
      sessionKey, 
      error: errorMsg,
      retries: maxRetries 
    });
    
    // 向上抛出错误，让调用方感知
    throw new Error(`记忆存储失败（已重试 ${maxRetries} 次）: ${errorMsg}`);
  }

  /**
   * 检查并触发摘要
   */
  async checkAndSummarize(sessionKey: SessionKey, messages: LLMMessage[]): Promise<void> {
    if (!this.memoryStore || !this.summarizer) return;

    // 检查是否启用记忆
    if (this.config.memoryEnabled === false) return;

    const threshold = this.config.summarizeThreshold ?? 20;
    
    if (messages.length >= threshold && this.summarizer.shouldSummarize(messages)) {
      try {
        log.info('📝 触发自动摘要', { messageCount: messages.length, threshold });
        
        const summary = await this.summarizer.summarize(messages);
        
        const entry: MemoryEntry = {
          id: summary.id,
          sessionId: sessionKey,
          type: 'summary',
          content: JSON.stringify(summary),
          metadata: {
            tags: ['summary', 'auto'],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await this.memoryStore.store(entry);
        log.info('✅ 摘要已存储', { id: summary.id, topic: summary.topic });
      } catch (error) {
        log.warn('摘要生成失败', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * 记录活动时间并启动空闲检查
   */
  recordActivity(sessionKey: SessionKey, getHistory: () => LLMMessage[]): void {
    if (this.summarizer) {
      this.summarizer.recordActivity();
      this.summarizer.startIdleCheck(sessionKey, getHistory);
    }
  }

  /**
   * 获取记忆存储结果
   */
  getStoreMemoryResult(): { success: boolean; error?: string } {
    return this.storeMemoryResult;
  }
}
