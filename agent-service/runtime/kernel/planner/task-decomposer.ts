/**
 * 任务分解器
 *
 * 将复杂任务分解为可执行的子任务。
 */

import type { LLMProvider } from '../../../types/provider';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'task-decomposer']);

/** 子任务定义 */
export interface SubTask {
  id: string;
  description: string;
  dependencies: string[];
  estimatedSteps?: number;
}

/** 分解结果 */
export interface DecomposeResult {
  subTasks: SubTask[];
  reasoning: string;
}

/**
 * 任务分解器
 */
export class TaskDecomposer {
  constructor(
    private llmProvider: LLMProvider,
    private model: string
  ) {}

  /**
   * 分解任务
   */
  async decompose(task: string, context?: string): Promise<SubTask[]> {
    const prompt = this.buildPrompt(task, context);

    const response = await this.llmProvider.chat(
      [{ role: 'user', content: prompt }],
      undefined,
      this.model,
      { maxTokens: 2048, temperature: 0.3 }
    );

    return this.parseResponse(response.content);
  }

  /**
   * 构建提示词
   */
  private buildPrompt(task: string, context?: string): string {
    let prompt = `你是一个任务分解专家。请将以下任务分解为可执行的子任务。

任务: ${task}

请按照以下要求分解:
1. 每个子任务应该是独立的、可执行的
2. 标识子任务之间的依赖关系
3. 为每个子任务生成唯一ID (task-1, task-2, ...)
4. 估计每个子任务所需的步骤数

请以 JSON 格式输出:
{
  "reasoning": "分解理由",
  "subTasks": [
    {
      "id": "task-1",
      "description": "任务描述",
      "dependencies": [],
      "estimatedSteps": 3
    }
  ]
}`;

    if (context) {
      prompt = `上下文: ${context}\n\n${prompt}`;
    }

    return prompt;
  }

  /**
   * 解析响应
   */
  private parseResponse(content: string): SubTask[] {
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;
      const parsed = JSON.parse(jsonStr);

      if (parsed.subTasks && Array.isArray(parsed.subTasks)) {
        return parsed.subTasks.map((t: unknown) => ({
          id: (t as SubTask).id || `task-${Math.random().toString(36).slice(2, 8)}`,
          description: (t as SubTask).description || '',
          dependencies: (t as SubTask).dependencies || [],
          estimatedSteps: (t as SubTask).estimatedSteps || 1,
        }));
      }
    } catch (error) {
      log.warn('[TaskDecomposer] JSON 解析失败', { error: String(error) });
    }

    // 回退：简单分解
    return this.simpleDecompose(content);
  }

  /**
   * 简单分解（回退方案）
   */
  private simpleDecompose(content: string): SubTask[] {
    const lines = content.split('\n')
      .filter(line => line.trim())
      .filter(line => line.match(/^\d+\.|^\-|\*/));

    return lines.map((line, index) => ({
      id: `task-${index + 1}`,
      description: line.replace(/^\d+\.|^\-|\*/, '').trim(),
      dependencies: index > 0 ? [`task-${index}`] : [],
      estimatedSteps: 1,
    }));
  }
}