/**
 * Agent 执行引擎
 *
 * 协调工具执行和结果处理。
 */

import type { SubTask } from '../planner/task-decomposer';
import type { ToolRegistry } from '../../capability/tool-system';
import type { PlanResult } from '../planner';
import { ToolExecutor } from './tool-executor';
import { ResultHandler } from './result-handler';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'execution-engine']);

/** 执行引擎配置 */
export interface ExecutionEngineConfig {
  /** 工作目录 */
  workspace: string;
  /** 工具执行超时（毫秒） */
  toolTimeout?: number;
}

/** 执行结果 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 执行的任务列表 */
  executedTasks: Array<{
    taskId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  /** 最终结果 */
  finalResult?: unknown;
  /** 错误信息 */
  error?: string;
}

/**
 * Agent 执行引擎
 */
export class ExecutionEngine {
  private toolExecutor: ToolExecutor;
  private resultHandler: ResultHandler;

  constructor(
    private config: ExecutionEngineConfig,
    private tools: ToolRegistry
  ) {
    this.toolExecutor = new ToolExecutor(tools, config);
    this.resultHandler = new ResultHandler();
  }

  /**
   * 执行计划
   */
  async execute(plan: PlanResult, context?: Record<string, unknown>): Promise<ExecutionResult> {
    log.info('[ExecutionEngine] 开始执行计划', {
      mainTask: plan.mainTask,
      subTaskCount: plan.subTasks.length,
      steps: plan.executionOrder.length,
    });

    const executedTasks: ExecutionResult['executedTasks'] = [];
    let hasError = false;

    // 按执行顺序执行任务
    for (const level of plan.executionOrder) {
      // 检查是否有任务失败
      if (hasError) {
        log.warn('[ExecutionEngine] 检测到错误，停止执行');
        break;
      }

      // 检查是否有前序任务失败
      const hasFailedDependency = level.some(taskId => {
        const task = plan.subTasks.find(t => t.id === taskId);
        return task && task.dependencies.some(depId =>
          executedTasks.find(t => t.taskId === depId && !t.success)
        );
      });

      if (hasFailedDependency) {
        log.warn('[ExecutionEngine] 跳过有失败依赖的任务');
        continue;
      }

      // 并行执行同级任务
      const results = await Promise.allSettled(
        level.map(taskId => this.executeTask(taskId, plan, context))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          executedTasks.push(result.value);
          if (!result.value.success) {
            hasError = true;
          }
        } else {
          executedTasks.push({
            taskId: 'unknown',
            success: false,
            error: result.reason.message,
          });
          hasError = true;
        }
      }
    }

    const finalResult = this.resultHandler.buildFinalResult(executedTasks);

    return {
      success: !hasError,
      executedTasks,
      finalResult,
      error: hasError ? '部分任务执行失败' : undefined,
    };
  }

  /**
   * 执行单个任务
   */
  private async executeTask(
    taskId: string,
    plan: PlanResult,
    context?: Record<string, unknown>
  ): Promise<ExecutionResult['executedTasks'][0]> {
    const task = plan.subTasks.find(t => t.id === taskId);
    if (!task) {
      return {
        taskId,
        success: false,
        error: `任务不存在: ${taskId}`,
      };
    }

    log.debug('[ExecutionEngine] 执行任务', { taskId, description: task.description });

    try {
      const result = await this.toolExecutor.execute(task, context);
      return {
        taskId,
        success: true,
        result,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('[ExecutionEngine] 任务执行失败', { taskId, error: errorMsg });
      return {
        taskId,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 中止执行
   */
  abort(): void {
    log.info('[ExecutionEngine] 中止执行');
    // TODO: 实现中止逻辑
  }
}