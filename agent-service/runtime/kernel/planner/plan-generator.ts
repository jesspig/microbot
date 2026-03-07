/**
 * 计划生成器
 *
 * 根据子任务生成执行顺序。
 */

import type { LLMProvider, LLMMessage } from '../../../types/provider';
import type { SubTask } from './task-decomposer';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'plan-generator']);

/**
 * 计划生成器
 */
export class PlanGenerator {
  constructor(
    private llmProvider: LLMProvider,
    private model: string
  ) {}

  /**
   * 生成执行计划
   */
  async generate(subTasks: SubTask[]): Promise<string[][]> {
    // 简单的拓扑排序
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[][] = [];
    const currentLevel: string[] = [];

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        log.warn('[PlanGenerator] 检测到循环依赖', { taskId });
        return;
      }

      visiting.add(taskId);

      const task = subTasks.find(t => t.id === taskId);
      if (task) {
        for (const depId of task.dependencies) {
          visit(depId);
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);
      currentLevel.push(taskId);
    };

    // 计算每个任务的入度
    const inDegree = new Map<string, number>();
    for (const task of subTasks) {
      inDegree.set(task.id, 0);
    }
    for (const task of subTasks) {
      for (const depId of task.dependencies) {
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      }
    }

    // 拓扑排序
    const queue: string[] = subTasks.filter(t => (inDegree.get(t.id) || 0) === 0).map(t => t.id);
    const levels: string[][] = [];

    while (queue.length > 0) {
      const levelSize = queue.length;
      const currentLevel: string[] = [];

      for (let i = 0; i < levelSize; i++) {
        const taskId = queue.shift()!;
        currentLevel.push(taskId);

        // 减少依赖此任务的任务的入度
        for (const task of subTasks) {
          if (task.dependencies.includes(taskId)) {
            inDegree.set(task.id, (inDegree.get(task.id) || 1) - 1);
            if (inDegree.get(task.id) === 0) {
              queue.push(task.id);
            }
          }
        }
      }

      levels.push(currentLevel);
    }

    return levels;
  }

  /**
   * 优化执行计划
   */
  async optimize(executionOrder: string[][], subTasks: SubTask[]): Promise<string[][]> {
    // 检查是否有可并行的任务
    const optimized: string[][] = [];

    for (const level of executionOrder) {
      // 分析任务是否可以并行执行
      const parallelizable = this.checkParallelizable(level, subTasks);

      if (parallelizable) {
        optimized.push(level);
      } else {
        // 顺序执行
        for (const taskId of level) {
          optimized.push([taskId]);
        }
      }
    }

    return optimized;
  }

  /**
   * 检查任务是否可以并行执行
   */
  private checkParallelizable(taskIds: string[], subTasks: SubTask[]): boolean {
    // 检查任务之间是否有资源冲突
    // 简化实现：检查是否有写文件操作
    for (const taskId of taskIds) {
      const task = subTasks.find(t => t.id === taskId);
      if (task && this.hasWriteOperation(task.description)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 检查是否有写操作
   */
  private hasWriteOperation(description: string): boolean {
    const writeKeywords = ['写', '保存', '创建', '删除', '修改', '更新'];
    return writeKeywords.some(keyword => description.includes(keyword));
  }
}