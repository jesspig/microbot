/**
 * 工具注册表
 *
 * 管理已注册工具的生命周期
 */

import { getLogger } from '@logtape/logtape';
import type { Tool, ToolDefinition, ToolContext, ToolResult } from '../../../types';

// 重新导出类型供外部使用
export type { ToolContext } from '../../../types';

const log = getLogger(['tool', 'registry']);

/** 工具注册表配置 */
export interface ToolRegistryConfig {
  /** 工作目录 */
  workspace?: string;
}

/** 已注册工具 */
interface RegisteredTool {
  tool: Tool;
  registeredAt: Date;
  source?: string;
}

/**
 * 工具注册表
 *
 * 负责工具的注册、查找和执行
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private config: ToolRegistryConfig;

  constructor(config: ToolRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * 注册工具
   */
  register(tool: Tool, source?: string): void {
    if (this.tools.has(tool.name)) {
      log.warn('工具已注册，将覆盖: {name}', { name: tool.name });
    }

    this.tools.set(tool.name, {
      tool,
      registeredAt: new Date(),
      source,
    });

    log.info('工具已注册: {name}', { name: tool.name });
  }

  /**
   * 批量注册工具
   */
  registerBatch(tools: Tool[], source?: string): void {
    for (const tool of tools) {
      this.register(tool, source);
    }
  }

  /**
   * 注销工具
   */
  unregister(name: string): void {
    if (this.tools.delete(name)) {
      log.info('工具已注销: {name}', { name });
    }
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具定义
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(r => ({
      name: r.tool.name,
      description: r.tool.description,
      inputSchema: r.tool.inputSchema,
    }));
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values()).map(r => r.tool);
  }

  /**
   * 执行工具
   */
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const registered = this.tools.get(name);
    if (!registered) {
      return {
        content: [{ type: 'text', text: `工具不存在: ${name}` }],
        isError: true,
      };
    }

    try {
      log.debug('执行工具: {name}', { name });
      const result = await registered.tool.execute(input, ctx);
      log.debug('工具执行完成: {name}', { name });
      return result;
    } catch (error) {
      log.error('工具执行失败: {name} - {error}', { name, error: String(error) });
      return {
        content: [{ type: 'text', text: `工具执行失败: ${String(error)}` }],
        isError: true,
      };
    }
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.tools.clear();
    log.info('工具注册表已清空');
  }
}

/**
 * 创建工具注册表
 */
export function createToolRegistry(config?: ToolRegistryConfig): ToolRegistry {
  return new ToolRegistry(config);
}
