/**
 * Agent 规划器
 *
 * 将复杂任务分解为可执行的子任务。
 */

import type { LLMProvider } from '../../../types/provider';
import { TaskDecomposer } from './task-decomposer';
import { PlanGenerator } from './plan-generator';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'planner']);

/** 规划器配置 */
export interface PlannerConfig {
  /** LLM Provider */
  llmProvider: LLMProvider;
  /** 默认模型 */
  defaultModel: string;
  /** 是否启用任务分解 */
  enableDecomposition?: boolean;
}

/** 规划结果 */
export interface PlanResult {
  /** 主任务 */
  mainTask: string;
  /** 子任务列表 */
  subTasks: Array<{
    id: string;
    description: string;
    dependencies: string[];
  }>;
  /** 执行顺序 */
  executionOrder: string[][];
}

/**
 * Agent 规划器
 */
export class AgentPlanner {
  private taskDecomposer: TaskDecomposer;
  private planGenerator: PlanGenerator;

  constructor(private _config: PlannerConfig) {
    this.taskDecomposer = new TaskDecomposer(_config.llmProvider, _config.defaultModel);
    this.planGenerator = new PlanGenerator(_config.llmProvider, _config.defaultModel);
  }

  /**
   * 规划任务
   */
  async plan(task: string, context?: string): Promise<PlanResult> {
    log.info('[Planner] 开始规划任务', { task });

    // 分解任务
    const subTasks = await this.taskDecomposer.decompose(task, context);

    log.debug('[Planner] 任务分解完成', { subTaskCount: subTasks.length });

    // 生成执行计划
    const executionOrder = await this.planGenerator.generate(subTasks);

    log.info('[Planner] 规划完成', {
      mainTask: task,
      subTaskCount: subTasks.length,
      steps: executionOrder.length,
    });

    return {
      mainTask: task,
      subTasks,
      executionOrder,
    };
  }

  /**
   * 检查是否需要规划
   */
  needsPlanning(task: string): boolean {
    // 简单启发式：长任务或包含多个步骤的任务需要规划
    return task.length > 100 ||
      task.includes('然后') ||
      task.includes('接着') ||
      task.includes('最后') ||
      task.includes('首先') ||
      task.split(/[，。；,.;]/).length > 2;
  }
}