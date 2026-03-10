/**
 * Token 预算管理
 *
 * 管理不同类型内容的 Token 分配。
 */

import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'token-budget']);

/** Token 预算配置 */
export interface TokenBudgetConfig {
  /** 总 Token 数量 */
  total: number;
  /** System Prompt 预留 */
  system: number;
  /** 工具定义预留 */
  tools: number;
  /** 对话上下文 */
  context: number;
  /** RAG 检索内容 */
  rag: number;
}

/** Token 预算 */
export class TokenBudget {
  private total: number;
  private used: number;
  private breakdown: TokenBudgetConfig;

  constructor(config: TokenBudgetConfig) {
    this.total = config.total;
    this.used = 0;
    this.breakdown = { ...config };
  }

  /**
   * 克隆预算
   */
  clone(): TokenBudget {
    const clone = new TokenBudget(this.breakdown);
    clone.total = this.total;
    clone.used = this.used;
    return clone;
  }

  /**
   * 使用 Token
   */
  useTokens(category: keyof TokenBudgetConfig, count: number): void {
    if (category === 'total') {
      this.used += count;
      return;
    }

    this.breakdown[category] += count;
    this.used += count;

    log.debug('[TokenBudget] Token 使用', { category, count, used: this.used });
  }

  /**
   * 释放 Token
   */
  releaseTokens(category: keyof TokenBudgetConfig, count: number): void {
    if (category === 'total') {
      this.used = Math.max(0, this.used - count);
      return;
    }

    this.breakdown[category] = Math.max(0, this.breakdown[category] - count);
    this.used = Math.max(0, this.used - count);

    log.debug('[TokenBudget] Token 释放', { category, count, used: this.used });
  }

  /**
   * 获取剩余 Token
   */
  getRemaining(): number {
    return Math.max(0, this.total - this.used);
  }

  /**
   * 获取已使用 Token
   */
  getUsed(): number {
    return this.used;
  }

  /**
   * 获取使用详情
   */
  getBreakdown(): TokenBudgetConfig {
    return { ...this.breakdown };
  }

  /**
   * 检查是否有足够 Token
   */
  hasEnough(count: number): boolean {
    return this.getRemaining() >= count;
  }

  /**
   * 重置预算
   */
  reset(): void {
    this.used = 0;
    this.breakdown = {
      total: this.total,
      system: 0,
      tools: 0,
      context: 0,
      rag: 0,
    };
    log.debug('[TokenBudget] 预算已重置');
  }

  /**
   * 调整总预算
   */
  setTotal(total: number): void {
    this.total = total;
    log.debug('[TokenBudget] 总预算已调整', { total });
  }
}