/**
 * 会话上下文注入器 (T045)
 *
 * 实现历史消息注入、相关会话摘要注入和 Token 预算控制。
 *
 * @module sdk/session/context-injector
 */

import { z } from 'zod';
import { getLogger } from '@logtape/logtape';
import type { SessionKey, SessionContextConfig, LLMMessage } from '../runtime';

const log = getLogger(['sdk', 'session', 'context-injector']);

/** 上下文注入配置 Schema */
export const ContextInjectorConfigSchema = z.object({
  /** 是否启用 */
  enabled: z.boolean().default(true),
  /** 注入策略 */
  strategy: z.enum(['sliding_window', 'summary', 'hybrid']).default('hybrid'),
  /** 历史消息最大数量 */
  maxHistoryMessages: z.number().min(1).max(100).default(20),
  /** 历史消息 Token 预算 */
  historyTokenBudget: z.number().min(100).max(50000).default(4000),
  /** 相关会话摘要数量 */
  maxRelatedSummaries: z.number().min(0).max(5).default(2),
  /** 相关会话摘要 Token 预算 */
  summaryTokenBudget: z.number().min(0).max(10000).default(500),
  /** 是否包含系统消息 */
  includeSystemMessages: z.boolean().default(false),
  /** 最小会话相关性分数 */
  minRelevanceScore: z.number().min(0).max(1).default(0.3),
});

/** 上下文注入配置 */
export type ContextInjectorConfig = z.infer<typeof ContextInjectorConfigSchema>;

/** 上下文注入结果 */
export interface ContextInjectionResult {
  /** 注入的历史消息 */
  historyMessages: Array<{
    role: string;
    content: string;
  }>;
  /** 历史消息使用的 Token */
  historyTokensUsed: number;
  /** 注入的相关会话摘要 */
  relatedSummaries: Array<{
    sessionKey: SessionKey;
    title: string;
    summary: string;
    relevanceScore: number;
  }>;
  /** 摘要使用的 Token */
  summaryTokensUsed: number;
  /** 总 Token 使用量 */
  totalTokensUsed: number;
  /** 是否截断 */
  wasTruncated: boolean;
}

/** 消息提供者接口 */
export type MessageProvider = (sessionKey: SessionKey) => Promise<LLMMessage[]>;

/** 会话信息提供者接口 */
export interface SessionInfoProvider {
  /** 获取会话标题 */
  getTitle(sessionKey: SessionKey): Promise<string | null>;
  /** 获取会话摘要 */
  getSummary(sessionKey: SessionKey): Promise<string | null>;
}

/** 相似会话搜索结果 */
export interface SimilarSessionResult {
  /** 结果项列表 */
  items: Array<{
    sessionKey: SessionKey;
    title: string | null;
    summary: string | null;
    score: number;
  }>;
}

/** 相似会话搜索器接口 */
export interface SimilarSessionSearcher {
  /** 搜索相似会话 */
  searchSimilar(sessionKey: SessionKey, options?: { limit?: number }): Promise<SimilarSessionResult>;
}

/** 默认配置 */
const DEFAULT_CONFIG: ContextInjectorConfig = {
  enabled: true,
  strategy: 'hybrid',
  maxHistoryMessages: 20,
  historyTokenBudget: 4000,
  maxRelatedSummaries: 2,
  summaryTokenBudget: 500,
  includeSystemMessages: false,
  minRelevanceScore: 0.3,
};

/**
 * 会话上下文注入器
 *
 * 职责：
 * - 历史消息注入（滑动窗口）
 * - 相关会话摘要注入
 * - Token 预算控制
 * - 上下文压缩
 *
 * @example
 * ```ts
 * const injector = new SessionContextInjector();
 * injector.setMessageProvider(async (key) => getMessages(key));
 * injector.setSearcher(searcher);
 * const result = await injector.inject(sessionKey);
 * ```
 */
export class SessionContextInjector {
  private config: ContextInjectorConfig;
  private searcher?: SimilarSessionSearcher;
  private messageProvider?: MessageProvider;
  private sessionInfoProvider?: SessionInfoProvider;

  constructor(config?: Partial<ContextInjectorConfig>) {
    this.config = ContextInjectorConfigSchema.parse({ ...DEFAULT_CONFIG, ...config });
  }

  /**
   * 设置消息提供者
   */
  setMessageProvider(provider: MessageProvider): void {
    this.messageProvider = provider;
  }

  /**
   * 设置会话信息提供者
   */
  setSessionInfoProvider(provider: SessionInfoProvider): void {
    this.sessionInfoProvider = provider;
  }

  /**
   * 设置搜索器
   */
  setSearcher(searcher: SimilarSessionSearcher): void {
    this.searcher = searcher;
  }

  /**
   * 注入上下文
   *
   * @param sessionKey - 当前会话键
   * @param remainingTokens - 剩余 Token 预算（可选）
   * @param customConfig - 自定义配置
   * @returns 注入结果
   */
  async inject(
    sessionKey: SessionKey,
    remainingTokens?: number,
    customConfig?: Partial<SessionContextConfig>
  ): Promise<ContextInjectionResult> {
    if (!this.config.enabled) {
      return this.emptyResult('上下文注入已禁用');
    }

    const config = { ...this.config, ...customConfig };
    const budget = this.calculateBudget(remainingTokens, config);

    // 按策略注入
    switch (config.strategy) {
      case 'sliding_window':
        return this.injectWithSlidingWindow(sessionKey, budget, config);
      case 'summary':
        return this.injectWithSummary(sessionKey, budget, config);
      case 'hybrid':
      default:
        return this.injectWithHybrid(sessionKey, budget, config);
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextInjectorConfig>): void {
    this.config = ContextInjectorConfigSchema.parse({ ...this.config, ...config });
    log.debug('上下文注入器配置已更新', { config: this.config });
  }

  /**
   * 获取当前配置
   */
  getConfig(): ContextInjectorConfig {
    return { ...this.config };
  }

  // ========== 私有方法 ==========

  /**
   * 计算可用预算
   */
  private calculateBudget(
    remainingTokens: number | undefined,
    config: Partial<ContextInjectorConfig>
  ): { history: number; summary: number } {
    const remaining = remainingTokens ?? config.historyTokenBudget ?? 4000;

    return {
      history: Math.min(config.historyTokenBudget ?? remaining * 0.8, remaining * 0.8),
      summary: Math.min(config.summaryTokenBudget ?? remaining * 0.2, remaining * 0.2),
    };
  }

  /**
   * 滑动窗口策略注入
   */
  private async injectWithSlidingWindow(
    sessionKey: SessionKey,
    budget: { history: number; summary: number },
    config: Partial<ContextInjectorConfig>
  ): Promise<ContextInjectionResult> {
    const messages = await this.fetchHistory(sessionKey, config);

    // 过滤系统消息
    const filtered = config.includeSystemMessages
      ? messages
      : messages.filter(m => m.role !== 'system');

    // 按 Token 预算选择消息
    const selected = this.selectMessagesByBudget(filtered, budget.history, config.maxHistoryMessages);

    const tokensUsed = this.estimateTokens(selected);

    return {
      historyMessages: selected.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      historyTokensUsed: tokensUsed,
      relatedSummaries: [],
      summaryTokensUsed: 0,
      totalTokensUsed: tokensUsed,
      wasTruncated: selected.length < filtered.length,
    };
  }

  /**
   * 摘要策略注入
   */
  private async injectWithSummary(
    sessionKey: SessionKey,
    budget: { history: number; summary: number },
    config: Partial<ContextInjectorConfig>
  ): Promise<ContextInjectionResult> {
    // 获取相关会话摘要
    const summaries = await this.fetchRelatedSummaries(sessionKey, config);

    // 按 Token 预算选择摘要
    const selectedSummaries = this.selectSummariesByBudget(summaries, budget.summary, config.maxRelatedSummaries);

    const summaryTokensUsed = this.estimateSummaryTokens(selectedSummaries);

    return {
      historyMessages: [],
      historyTokensUsed: 0,
      relatedSummaries: selectedSummaries,
      summaryTokensUsed,
      totalTokensUsed: summaryTokensUsed,
      wasTruncated: selectedSummaries.length < summaries.length,
    };
  }

  /**
   * 混合策略注入
   */
  private async injectWithHybrid(
    sessionKey: SessionKey,
    budget: { history: number; summary: number },
    config: Partial<ContextInjectorConfig>
  ): Promise<ContextInjectionResult> {
    // 并行获取历史消息和相关摘要
    const [messages, summaries] = await Promise.all([
      this.fetchHistory(sessionKey, config),
      this.fetchRelatedSummaries(sessionKey, config),
    ]);

    // 过滤系统消息
    const filtered = config.includeSystemMessages
      ? messages
      : messages.filter(m => m.role !== 'system');

    // 选择历史消息
    const selectedMessages = this.selectMessagesByBudget(
      filtered,
      budget.history,
      config.maxHistoryMessages
    );

    // 选择相关摘要
    const selectedSummaries = this.selectSummariesByBudget(
      summaries,
      budget.summary,
      config.maxRelatedSummaries
    );

    const historyTokensUsed = this.estimateTokens(selectedMessages);
    const summaryTokensUsed = this.estimateSummaryTokens(selectedSummaries);

    return {
      historyMessages: selectedMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      historyTokensUsed,
      relatedSummaries: selectedSummaries,
      summaryTokensUsed,
      totalTokensUsed: historyTokensUsed + summaryTokensUsed,
      wasTruncated: selectedMessages.length < filtered.length || selectedSummaries.length < summaries.length,
    };
  }

  /**
   * 获取历史消息
   */
  private async fetchHistory(
    sessionKey: SessionKey,
    config: Partial<ContextInjectorConfig>
  ): Promise<LLMMessage[]> {
    if (!this.messageProvider) {
      log.warn('消息提供者未设置');
      return [];
    }

    try {
      const messages = await this.messageProvider(sessionKey);
      return messages.slice(-(config.maxHistoryMessages ?? 20) * 2);
    } catch (error) {
      log.error('获取历史消息失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 获取相关会话摘要
   */
  private async fetchRelatedSummaries(
    sessionKey: SessionKey,
    config: Partial<ContextInjectorConfig>
  ): Promise<Array<{
    sessionKey: SessionKey;
    title: string;
    summary: string;
    relevanceScore: number;
  }>> {
    if (!this.searcher) {
      log.debug('搜索器未设置，跳过相关摘要获取');
      return [];
    }

    try {
      const result = await this.searcher.searchSimilar(sessionKey, {
        limit: (config.maxRelatedSummaries ?? 2) * 2,
      });

      return result.items
        .filter(item => item.score >= (config.minRelevanceScore ?? 0.3) && item.summary)
        .map(item => ({
          sessionKey: item.sessionKey,
          title: item.title ?? '无标题',
          summary: item.summary ?? '',
          relevanceScore: item.score,
        }));
    } catch (error) {
      log.error('获取相关会话摘要失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 按 Token 预算选择消息
   */
  private selectMessagesByBudget(
    messages: LLMMessage[],
    budget: number,
    maxCount?: number
  ): LLMMessage[] {
    const selected: LLMMessage[] = [];
    let usedTokens = 0;

    // 从最新的消息开始选择
    const reversed = [...messages].reverse();

    for (const msg of reversed) {
      const msgTokens = this.estimateSingleMessageTokens(msg);

      if (usedTokens + msgTokens > budget) {
        break;
      }

      selected.unshift(msg);
      usedTokens += msgTokens;

      if (maxCount && selected.length >= maxCount) {
        break;
      }
    }

    return selected;
  }

  /**
   * 按 Token 预算选择摘要
   */
  private selectSummariesByBudget(
    summaries: Array<{
      sessionKey: SessionKey;
      title: string;
      summary: string;
      relevanceScore: number;
    }>,
    budget: number,
    maxCount?: number
  ): Array<{
    sessionKey: SessionKey;
    title: string;
    summary: string;
    relevanceScore: number;
  }> {
    const selected: typeof summaries = [];
    let usedTokens = 0;

    // 按相关性排序
    const sorted = [...summaries].sort((a, b) => b.relevanceScore - a.relevanceScore);

    for (const summary of sorted) {
      const summaryTokens = this.estimateTextTokens(summary.title + summary.summary);

      if (usedTokens + summaryTokens > budget) {
        continue; // 尝试下一个更短的摘要
      }

      selected.push(summary);
      usedTokens += summaryTokens;

      if (maxCount && selected.length >= maxCount) {
        break;
      }
    }

    return selected;
  }

  /**
   * 估算消息列表 Token 数量
   */
  private estimateTokens(messages: LLMMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateSingleMessageTokens(msg), 0);
  }

  /**
   * 估算单条消息 Token 数量
   */
  private estimateSingleMessageTokens(message: LLMMessage): number {
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

    return this.estimateTextTokens(content) + 4; // 加上角色和格式开销
  }

  /**
   * 估算文本 Token 数量
   */
  private estimateTextTokens(text: string): number {
    // 简化实现：中文约 1.5 字符/token，英文约 4 字符/token
    // 取折中值 3 字符/token
    return Math.ceil(text.length / 3);
  }

  /**
   * 估算摘要列表 Token 数量
   */
  private estimateSummaryTokens(
    summaries: Array<{ title: string; summary: string }>
  ): number {
    return summaries.reduce((sum, s) => {
      const text = `${s.title}\n${s.summary}`;
      return sum + this.estimateTextTokens(text) + 20; // 加上格式开销
    }, 0);
  }

  /**
   * 返回空结果
   */
  private emptyResult(reason: string): ContextInjectionResult {
    log.debug('返回空结果', { reason });
    return {
      historyMessages: [],
      historyTokensUsed: 0,
      relatedSummaries: [],
      summaryTokensUsed: 0,
      totalTokensUsed: 0,
      wasTruncated: false,
    };
  }
}

// ========== 便捷函数 ==========

/**
 * 构建上下文注入消息
 */
export function buildContextMessage(
  result: ContextInjectionResult,
  includeHistory = true,
  includeSummaries = true
): string {
  const parts: string[] = [];

  if (includeHistory && result.historyMessages.length > 0) {
    parts.push('## 历史对话');
    parts.push('');
    for (const msg of result.historyMessages) {
      const roleLabel = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : msg.role;
      parts.push(`**${roleLabel}**: ${msg.content}`);
    }
  }

  if (includeSummaries && result.relatedSummaries.length > 0) {
    parts.push('');
    parts.push('## 相关会话摘要');
    parts.push('');
    for (const summary of result.relatedSummaries) {
      parts.push(`### ${summary.title}`);
      parts.push(summary.summary);
      parts.push('');
    }
  }

  return parts.join('\n');
}
