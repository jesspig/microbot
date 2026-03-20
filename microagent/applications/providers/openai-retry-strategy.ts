/**
 * OpenAI 重试策略
 *
 * 负责处理请求重试逻辑
 */

import { providersLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";

const logger = providersLogger();
const MODULE_NAME = "OpenAIRetryStrategy";

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试基数延迟（毫秒） */
  baseDelayMs: number;
}

/**
 * 重试结果
 */
export interface RetryResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 结果或错误 */
  result?: T;
  /** 错误 */
  error?: Error;
  /** 尝试次数 */
  attempts: number;
}

/**
 * OpenAI 重试策略
 * 负责处理请求重试逻辑
 */
export class OpenAIRetryStrategy {
  private readonly config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelayMs: config?.baseDelayMs ?? 1000,
    };
  }

  /**
   * 执行带重试的异步操作
   * @param fn - 要执行的异步函数
   * @returns 重试结果
   */
  async execute<T>(fn: () => Promise<T>): Promise<RetryResult<T>> {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "execute",
      module: MODULE_NAME,
      params: { maxRetries: this.config.maxRetries },
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await fn();

        logMethodReturn(logger, {
          method: "execute",
          module: MODULE_NAME,
          result: { success: true, attempts: attempt + 1 },
          duration: timer(),
        });

        return {
          success: true,
          result,
          attempts: attempt + 1,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRetryableError(lastError)) {
          logMethodError(logger, {
            method: "execute",
            module: MODULE_NAME,
            error: { name: lastError.name, message: lastError.message, nonRetryable: true },
            params: { attempts: attempt + 1 },
            duration: timer(),
          });

          return {
            success: false,
            error: lastError,
            attempts: attempt + 1,
          };
        }

        if (attempt < this.config.maxRetries) {
          const delay = this.config.baseDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
          logger.debug("重试请求", { attempt: attempt + 1, delay });
        }
      }
    }

    logMethodError(logger, {
      method: "execute",
      module: MODULE_NAME,
      error: { name: lastError?.name, message: lastError?.message, exhaustedRetries: true },
      params: { attempts: this.config.maxRetries + 1 },
      duration: timer(),
    });

    return {
      success: false,
      error: lastError ?? new Error("请求失败"),
      attempts: this.config.maxRetries + 1,
    };
  }

  /**
   * 判断错误是否可重试
   * @param error - 错误对象
   * @returns 是否可重试
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("rate limit") ||
      message.includes("overloaded") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("aborted") ||
      message.includes("429") ||
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504")
    );
  }

  /**
   * 延迟指定毫秒数
   * @param ms - 毫秒数
   * @returns Promise
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
