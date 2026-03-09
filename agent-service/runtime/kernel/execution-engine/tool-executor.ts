/**
 * 工具执行器
 *
 * 执行工具调用并处理结果。
 */

import type { SubTask } from '../planner/task-decomposer';
import type { ToolRegistry } from '../../capability/tool-system';
import type { ToolContext, ToolResult, ToolDefinition } from '../../../types/tool';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'tool-executor']);

/** 工具执行器配置 */
export interface ToolExecutorConfig {
  /** 工作目录 */
  workspace: string;
  /** 知识库目录 */
  knowledgeBase: string;
  /** 工具执行超时（毫秒） */
  toolTimeout?: number;
}

/**
 * 工具执行器
 */
export class ToolExecutor {
  private abortController: AbortController | null = null;

  constructor(
    private tools: ToolRegistry,
    private config: ToolExecutorConfig
  ) {}

  /**
   * 中止当前执行
   */
  abort(): void {
    if (this.abortController) {
      log.info('[ToolExecutor] 中止执行');
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 执行任务
   */
  async execute(task: SubTask, context?: Record<string, unknown>): Promise<unknown> {
    // 创建新的 AbortController
    this.abortController = new AbortController();

    // 将任务描述转换为工具调用
    const toolCall = this.taskToToolCall(task);

    // 创建工具上下文（包含中止信号）
    const toolContext = this.createToolContext(context, this.abortController.signal);

    try {
      // 执行工具
      const result = await this.tools.execute(toolCall.name, toolCall.arguments, toolContext);
      return this.handleResult(result);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 将任务转换为工具调用
   *
   * 使用语义匹配算法根据任务描述选择最合适的工具：
   * 1. 首先尝试精确匹配工具名称
   * 2. 然后尝试关键词与工具描述的匹配
   * 3. 最后根据工具功能关键词匹配
   *
   * 注：对于复杂场景，未来可以考虑使用 LLM 进行更精确的解析，
   * 但基于规则的匹配在大多数简单场景下已足够。
   */
  private taskToToolCall(task: SubTask): { name: string; arguments: Record<string, unknown> } {
    const description = task.description.toLowerCase();
    const availableTools = this.tools.getDefinitions();

    // 尝试匹配工具名称
    for (const tool of availableTools) {
      if (description.includes(tool.name.toLowerCase())) {
        return {
          name: tool.name,
          arguments: this.extractArguments(description, tool),
        };
      }
    }

    // 关键词到工具的映射规则
    const keywordMappings: Array<{
      keywords: string[];
      toolName: string;
      argExtractor: (desc: string) => Record<string, unknown>;
    }> = [
      {
        keywords: ['读取', '读取文件', 'read', 'read_file', '获取文件', '打开文件'],
        toolName: 'read_file',
        argExtractor: (desc) => ({ path: this.extractPath(desc) }),
      },
      {
        keywords: ['写入', '写入文件', 'write', 'write_file', '保存文件', '创建文件'],
        toolName: 'write_file',
        argExtractor: (desc) => ({
          path: this.extractPath(desc),
          content: this.extractContent(desc),
        }),
      },
      {
        keywords: ['搜索', '查找', 'search', 'find', '检索'],
        toolName: 'search',
        argExtractor: (desc) => ({ query: this.extractQuery(desc) }),
      },
      {
        keywords: ['执行', '运行', 'execute', 'run', '命令'],
        toolName: 'execute',
        argExtractor: (desc) => ({ command: this.extractCommand(desc) }),
      },
      {
        keywords: ['列出', 'list', '目录', '文件列表'],
        toolName: 'list_directory',
        argExtractor: (desc) => ({ path: this.extractPath(desc) || this.config.workspace }),
      },
      {
        keywords: ['删除', 'delete', 'remove', '移除'],
        toolName: 'delete_file',
        argExtractor: (desc) => ({ path: this.extractPath(desc) }),
      },
    ];

    // 尝试关键词匹配
    for (const mapping of keywordMappings) {
      if (mapping.keywords.some(kw => description.includes(kw))) {
        // 检查工具是否可用
        if (this.tools.has(mapping.toolName)) {
          return {
            name: mapping.toolName,
            arguments: mapping.argExtractor(description),
          };
        }
      }
    }

    // 尝试基于工具描述的语义匹配
    const bestMatch = this.findBestToolMatch(description, availableTools);
    if (bestMatch) {
      return {
        name: bestMatch.name,
        arguments: this.extractArguments(description, bestMatch),
      };
    }

    // 默认：查找通用执行工具
    if (this.tools.has('execute')) {
      return {
        name: 'execute',
        arguments: { command: task.description },
      };
    }

    // 无匹配工具，抛出错误
    throw new Error(`无法找到匹配的工具执行任务: ${task.description}`);
  }

  /**
   * 基于描述查找最佳匹配工具
   */
  private findBestToolMatch(description: string, tools: ToolDefinition[]): ToolDefinition | null {
    const descWords = new Set(description.toLowerCase().split(/\s+/));

    let bestMatch: ToolDefinition | null = null;
    let bestScore = 0;

    for (const tool of tools) {
      const toolWords = new Set(
        (tool.name + ' ' + tool.description).toLowerCase().split(/\s+/)
      );

      // 计算词汇重叠分数
      let score = 0;
      for (const word of descWords) {
        if (toolWords.has(word)) {
          score++;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = tool;
      }
    }

    // 只返回有足够匹配度的结果
    return bestScore >= 1 ? bestMatch : null;
  }

  /**
   * 根据工具定义提取参数
   */
  private extractArguments(description: string, tool: ToolDefinition): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const schema = tool.inputSchema;

    if (schema && typeof schema === 'object' && 'properties' in schema) {
      const props = (schema as { properties: Record<string, unknown> }).properties;

      for (const [propName, propDef] of Object.entries(props)) {
        const _prop = propDef as { type?: string; description?: string };

        // 根据属性名或描述推断值
        if (propName.includes('path') || propName.includes('file')) {
          args[propName] = this.extractPath(description);
        } else if (propName.includes('content')) {
          args[propName] = this.extractContent(description);
        } else if (propName.includes('query') || propName.includes('search')) {
          args[propName] = this.extractQuery(description);
        } else if (propName.includes('command')) {
          args[propName] = this.extractCommand(description);
        }
      }
    }

    return args;
  }

  /**
   * 创建工具上下文
   */
  private createToolContext(context?: Record<string, unknown>, abortSignal?: AbortSignal): ToolContext {
    return {
      channel: context?.channel as string || 'default',
      chatId: context?.chatId as string || 'default',
      workspace: this.config.workspace,
      currentDir: context?.currentDir as string || this.config.workspace,
      knowledgeBase: this.config.knowledgeBase,
      sendToBus: async () => {},
      abortSignal,
    };
  }

  /**
   * 提取路径
   */
  private extractPath(description: string): string {
    // 尝试匹配引号内的路径
    const quotedMatch = description.match(/['"`]([^'"`]+)['"`]/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // 尝试匹配文件路径模式
    const pathMatch = description.match(/(?:文件|路径|path)[:\s]*([^\s,，。]+)/i);
    if (pathMatch) {
      return pathMatch[1];
    }

    return '';
  }

  /**
   * 提取内容
   */
  private extractContent(description: string): string {
    // 尝试匹配引号内的内容
    const contentMatch = description.match(/内容[:\s]*['"`]([^'"`]+)['"`]/);
    if (contentMatch) {
      return contentMatch[1];
    }

    // 尝试匹配最后一个引号块
    const quotedBlocks = description.match(/['"`]([^'"`]+)['"`]/g);
    if (quotedBlocks && quotedBlocks.length > 1) {
      // 假设第一个是路径，第二个是内容
      const second = quotedBlocks[1];
      return second.slice(1, -1);
    }

    return '';
  }

  /**
   * 提取查询
   */
  private extractQuery(description: string): string {
    // 移除常见关键词
    let query = description
      .replace(/搜索|查找|检索|search|find|query/gi, '')
      .replace(/['"`]/g, '')
      .trim();

    // 如果有引号内容，使用引号内容
    const quotedMatch = description.match(/['"`]([^'"`]+)['"`]/);
    if (quotedMatch) {
      query = quotedMatch[1];
    }

    return query;
  }

  /**
   * 提取命令
   */
  private extractCommand(description: string): string {
    // 尝试匹配引号内的命令
    const quotedMatch = description.match(/['"`]([^'"`]+)['"`]/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // 尝试匹配命令关键词后的内容
    const cmdMatch = description.match(/(?:执行|运行|命令|command|run)[:\s]*([^\n]+)/i);
    if (cmdMatch) {
      return cmdMatch[1].trim();
    }

    return description;
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
