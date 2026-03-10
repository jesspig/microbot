/**
 * Agent 执行引擎
 *
 * 协调工具执行和结果处理。
 */

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
  /** 知识库目录 */
  knowledgeBase: string;
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
  /** 是否被中止 */
  aborted?: boolean;
}

/** 中止执行错误 */
class _AbortError extends Error {
  constructor() {
    super('执行已中止');
    this.name = 'AbortError';
  }
}

/**
 * Agent 执行引擎
 */
export class ExecutionEngine {
  private toolExecutor: ToolExecutor;
  private resultHandler: ResultHandler;
  private isAborted = false;

  constructor(
    private _config: ExecutionEngineConfig,
    private _tools: ToolRegistry
  ) {
    this.toolExecutor = new ToolExecutor(_tools, _config);
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

    // 重置中止状态
    this.isAborted = false;
    const executedTasks: ExecutionResult['executedTasks'] = [];
    let hasError = false;

    // 按执行顺序执行任务
    for (const level of plan.executionOrder) {
      // 检查是否被中止
      if (this.isAborted) {
        log.info('[ExecutionEngine] 执行已被中止');
        return {
          success: false,
          executedTasks,
          error: '执行已中止',
          aborted: true,
        };
      }

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

      // 检查是否在执行过程中被中止
      if (this.isAborted) {
        log.info('[ExecutionEngine] 执行已被中止');
        return {
          success: false,
          executedTasks,
          error: '执行已中止',
          aborted: true,
        };
      }

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
    // 检查是否被中止
    if (this.isAborted) {
      return {
        taskId,
        success: false,
        error: '执行已中止',
      };
    }

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

      // 执行完成后再次检查中止状态
      if (this.isAborted) {
        return {
          taskId,
          success: false,
          error: '执行已中止',
        };
      }

      return {
        taskId,
        success: true,
        result,
      };
    } catch (error) {
      // 如果是中止错误
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          taskId,
          success: false,
          error: '执行已中止',
        };
      }

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
   *
   * 调用此方法会：
   * 1. 设置中止标志，停止后续任务执行
   * 2. 中止当前正在执行的工具
   */
  abort(): void {
    log.info('[ExecutionEngine] 中止执行');
    this.isAborted = true;

    // 中止工具执行器中正在执行的任务
    this.toolExecutor.abort();
  }

  /**
   * 检查是否已中止
   */
  get isExecutionAborted(): boolean {
    return this.isAborted;
  }
}