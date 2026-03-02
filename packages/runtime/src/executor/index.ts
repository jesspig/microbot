/**
 * Executor 模块主入口
 *
 * Agent 执行器 - 实现 Function Calling 模式处理消息并协调工具调用
 * 
 * 模块结构：
 * - types.ts: 类型定义
 * - utils.ts: 辅助工具方法
 * - tool-executor.ts: 工具执行器
 * - loop-handler.ts: 循环处理器
 * - memory-manager.ts: 记忆管理器
 * - message-builder.ts: 消息构建器
 * - context-manager.ts: 上下文管理器
 * - executor-core.ts: Agent 执行器核心
 */

// 重新导出类型
export type {
  ToolRegistryLike,
  AgentExecutorConfig,
  ExecutorDependencies,
  ToolExecutionContext,
} from './types';

export {
  DEFAULT_CONFIG,
  MAX_SESSIONS,
} from './types';

// 重新导出工具类
export { ToolExecutor } from './tool-executor';
export { LoopHandler } from './loop-handler';
export { MemoryManager } from './memory-manager';
export { MessageBuilder } from './message-builder';
export { ContextManager } from './context-manager';

// 重新导出工具函数
export {
  safeErrorMsg,
  formatInputPreview,
  formatResultPreview,
  createToolCache,
} from './utils';

// 重新导出核心类
export { AgentExecutorCore } from './executor-core';

// 为了保持向后兼容，将 AgentExecutorCore 导出为 AgentExecutor
export { AgentExecutorCore as AgentExecutor } from './executor-core';