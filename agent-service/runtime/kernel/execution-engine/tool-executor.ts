/**
 * 工具执行器
 *
 * 执行工具调用并处理结果。
 */

import type { SubTask } from '../planner/task-decomposer';
import type { ToolRegistry } from '../../capability/tool-system';
import type { ToolContext, ToolResult } from '../../../types/tool';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'tool-executor']);

/** 工具执行器配置 */
export interface ToolExecutorConfig {
  /** 工作目录 */
  workspace: string;
  /** 工具执行超时（毫秒） */
  toolTimeout?: number;
}

/**
 * 工具执行器
 */
export class ToolExecutor {
  constructor(
    private tools: ToolRegistry,
    private config: ToolExecutorConfig
  ) {}

  /**
   * 执行任务
   */
  async execute(task: SubTask, context?: Record<string, unknown>): Promise<unknown> {
    // 将任务描述转换为工具调用
    const toolCall = this.taskToToolCall(task);

    // 创建工具上下文
    const toolContext = this.createToolContext(context);

    // 执行工具
    const result = await this.tools.executeTool(toolCall.name, toolCall.arguments, toolContext);

    return this.handleResult(result);
  }

  /**
   * 将任务转换为工具调用
   */
  private taskToToolCall(task: SubTask): { name: string; arguments: Record<string, unknown> } {
    // 简化实现：根据任务描述选择工具
    // 实际实现应该使用 LLM 进行解析

    const description = task.description.toLowerCase();

    if (description.includes('读') || description.includes('获取')) {
      return {
        name: 'read_file',
        arguments: { path: this.extractPath(description) },
      };
    }

    if (description.includes('写') || description.includes('保存')) {
      return {
        name: 'write_file',
        arguments: {
          path: this.extractPath(description),
          content: this.extractContent(description),
        },
      };
    }

    if (description.includes('搜索') || description.includes('查找')) {
      return {
        name: 'search',
        arguments: { query: this.extractQuery(description) },
      };
    }

    // 默认使用通用工具
    return {
      name: 'execute',
      arguments: { command: task.description },
    };
  }

  /**
   * 创建工具上下文
   */
  private createToolContext(context?: Record<string, unknown>): ToolContext {
    return {
      channel: context?.channel as string || 'default',
      chatId: context?.chatId as string || 'default',
      workspace: this.config.workspace,
      currentDir: context?.currentDir as string || this.config.workspace,
      sendToBus: async () => {},
    };
  }

  /**
   * 提取路径
   */
  private extractPath(description: string): string {
    const match = description.match(/['"`](.+?)['"`]/);
    return match?.[1] || '';
  }

  /**
   * 提取内容
   */
  private extractContent(description: string): string {
    // 简化实现
    return '';
  }

  /**
   * 提取查询
   */
  private extractQuery(description: string): string {
    return description.replace(/搜索|查找/g, '').trim();
  }

  /**
   * 处理结果
   */
  private handleResult(result: ToolResult): unknown {
    if (result.isError) {
      throw new Error(`工具执行失败: ${JSON.stringify(result.content)}`);
    }

    // 提取文本内容
    const textContent = result.content.find(c => c.type === 'text');
    if (textContent) {
      return (textContent as { text: string }).text;
    }

    return result.content;
  }
}