/**
 * 工具执行器
 *
 * 负责工具定义的获取、缓存和执行
 */

import type { ToolRegistryLike, ToolExecutionContext } from './types';
import { getLogger } from '@logtape/logtape';
import { getTracer } from '../logging';
import { createToolCache, formatResultPreview, safeErrorMsg } from './utils';

const log = getLogger(['executor', 'tool']);
const tracer = getTracer();

/**
 * 工具执行器
 */
export class ToolExecutor {
  private toolCache: ReturnType<typeof createToolCache>;

  constructor(
    private tools: ToolRegistryLike
  ) {
    this.toolCache = createToolCache(() => this.tools.getDefinitions());
  }

  /**
   * 获取工具定义
   */
  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }> {
    return this.toolCache.getToolDefinitions();
  }

  /**
   * 获取 LLM 工具定义（Function Calling 格式）
   */
  getLLMToolDefinitions() {
    return this.toolCache.getLLMToolDefinitions();
  }

  /**
   * 执行单个工具
   */
  async executeTool(
    name: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<string> {
    const startTime = Date.now();
    let success = true;
    let errorMsg: string | undefined;
    
    try {
      // 执行工具
      const result = await this.tools.execute(name, input, context);
      
      const elapsed = Date.now() - startTime;
      
      // 记录工具调用结果（使用 tracer 格式化）
      tracer.logToolCall(name, input, result, elapsed, true);
      
      // 在 CLI 中显示简洁的工具结果
      const resultPreview = formatResultPreview(result);
      log.info(`✅ 工具完成: ${name}`, {
        duration: `${elapsed}ms`,
        result: resultPreview,
      });
      
      return result;
    } catch (error) {
      success = false;
      errorMsg = safeErrorMsg(error);
      const elapsed = Date.now() - startTime;
      
      tracer.logToolCall(name, input, '', elapsed, false, errorMsg);
      log.error(`❌ 工具失败: ${name}`, { error: errorMsg, duration: `${elapsed}ms` });
      
      return JSON.stringify({
        error: true,
        message: '工具执行失败: ' + errorMsg,
        tool: name
      });
    }
  }

  /**
   * 创建工具上下文
   */
  createToolContext(
    channel: string,
    chatId: string,
    workspace: string,
    currentDir: string,
    sendToBus: (message: unknown) => Promise<void>
  ): ToolExecutionContext {
    return {
      channel,
      chatId,
      workspace,
      currentDir,
      sendToBus,
    };
  }
}