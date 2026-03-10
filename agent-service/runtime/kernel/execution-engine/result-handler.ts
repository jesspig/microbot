/**
 * 结果处理器
 *
 * 处理执行结果并生成最终输出。
 */

import type { ExecutionResult } from './index';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'result-handler']);

/** 结果处理器配置 */
export interface ResultHandlerConfig {
  /** 是否包含详细日志 */
  includeDetails?: boolean;
}

/**
 * 结果处理器
 */
export class ResultHandler {
  constructor(private _config: ResultHandlerConfig = {}) {}

  /**
   * 构建最终结果
   */
  buildFinalResult(executedTasks: ExecutionResult['executedTasks']): unknown {
    const successfulTasks = executedTasks.filter(t => t.success);
    const failedTasks = executedTasks.filter(t => !t.success);

    if (failedTasks.length > 0) {
      log.warn('[ResultHandler] 部分任务失败', {
        failedCount: failedTasks.length,
        successCount: successfulTasks.length,
      });
    }

    // 如果只有一个成功的任务，直接返回其结果
    if (successfulTasks.length === 1) {
      return successfulTasks[0].result;
    }

    // 多个任务，构建汇总结果
    const summary: Record<string, unknown> = {
      totalTasks: executedTasks.length,
      successfulTasks: successfulTasks.length,
      failedTasks: failedTasks.length,
      results: successfulTasks.map(t => ({
        taskId: t.taskId,
        result: t.result,
      })),
    };

    if (failedTasks.length > 0) {
      summary.errors = failedTasks.map(t => ({
        taskId: t.taskId,
        error: t.error,
      }));
    }

    return summary;
  }

  /**
   * 格式化结果
   */
  formatResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }

    if (result === null || result === undefined) {
      return '执行完成，无返回结果';
    }

    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  /**
   * 验证结果
   */
  validateResult(result: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (result === undefined) {
      errors.push('结果为 undefined');
    }

    if (result === null) {
      errors.push('结果为 null');
    }

    // 检查是否为有效的 JSON
    if (typeof result === 'object') {
      try {
        JSON.stringify(result);
      } catch {
        errors.push('结果无法序列化为 JSON');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}