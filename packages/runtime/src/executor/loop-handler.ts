/**
 * 循环处理器
 *
 * 负责循环检测、工具调用循环检查和终止逻辑
 */

import type { LLMMessage, LLMResponse } from '@micro-agent/types';
import type { AgentLoopResult } from '../types';
import { LoopDetector } from '../loop-detection';
import type { LoopDetectionConfig } from '@micro-agent/config';
import { getLogger } from '@logtape/logtape';
import { MessageHistoryManager } from '../message-manager';

const log = getLogger(['executor', 'loop']);

/**
 * 循环处理器
 */
export class LoopHandler {
  private loopDetector: LoopDetector;

  constructor(config: Partial<LoopDetectionConfig> = {}) {
    this.loopDetector = new LoopDetector({
      enabled: config.enabled ?? true,
      warningThreshold: config.warningThreshold ?? 3,
      criticalThreshold: config.criticalThreshold ?? 5,
      globalCircuitBreaker: 25, // 默认最大迭代次数 + 10
    });
  }

  /**
   * 重置循环检测器
   */
  reset(): void {
    this.loopDetector.reset();
  }

  /**
   * 记录工具调用
   */
  recordCall(toolName: string, toolArguments: unknown): void {
    this.loopDetector.recordCall(toolName, toolArguments as Record<string, unknown>);
  }

  /**
   * 检测循环
   */
  detectLoop() {
    return this.loopDetector.detectLoop();
  }

  /**
   * 检查循环并返回终止结果（如果检测到临界循环）
   */
  checkLoopDetection(toolCall: NonNullable<LLMResponse['toolCalls']>[0]): AgentLoopResult | null {
    this.loopDetector.recordCall(toolCall.name, toolCall.arguments as Record<string, unknown>);
    
    const loopCheck = this.loopDetector.detectLoop();
    if (!loopCheck) {
      return null;
    }

    log.warn('⚠️ 循环检测', { reason: loopCheck.reason, severity: loopCheck.severity });

    if (loopCheck.severity === 'critical') {
      return {
        content: `检测到循环行为，终止执行: ${loopCheck.reason}`,
        iterations: 0,
        loopDetected: true,
        loopReason: loopCheck.reason,
      };
    }

    log.info('⚠️ 循环警告，继续执行', { reason: loopCheck.reason });
    return null;
  }

  /**
   * 记录工具调用详情
   */
  logToolCallDetails(toolCalls: NonNullable<LLMResponse['toolCalls']>): void {
    for (const tc of toolCalls) {
      const args = tc.arguments as Record<string, unknown>;
      const argEntries = Object.entries(args || {});
      const argStr = argEntries.length > 0
        ? argEntries.map(([k, v]) => {
            const valStr = typeof v === 'string' && v.length > 50
              ? `"${v.slice(0, 50)}..."`
              : JSON.stringify(v);
            return `${k}=${valStr}`;
          }).join(', ')
        : '无参数';
      
      log.info(`📞 调用工具: ${tc.name}`, { args: argStr });
    }
  }

  /**
   * 构建最大迭代结果
   */
  buildMaxIterationsResult(maxIterations: number): AgentLoopResult {
    log.warn('⚠️ 达到最大迭代次数', { maxIterations });
    return {
      content: '达到最大迭代次数，任务未完成',
      iterations: maxIterations,
      loopDetected: false,
    };
  }

  /**
   * 构建成功结果
   */
  buildSuccessResult(content: string, iterations: number): AgentLoopResult {
    log.info('✅ 任务完成', {
      content: content.slice(0, 500),
      fullLength: content.length,
    });
    return { content, iterations, loopDetected: false };
  }
}