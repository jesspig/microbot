/**
 * Executor 模块类型定义
 *
 * 包含 AgentExecutor 相关的所有类型和接口定义
 */

import type { ModelConfig, LoopDetectionConfig } from '@micro-agent/config';
import type { SessionKey, LLMMessage, LLMToolDefinition, PreflightPromptBuilder, ToolContext, MessageContent } from '@micro-agent/types';
import type { MessageBus } from '../bus/queue';
import type { LLMGateway } from '@micro-agent/providers';
import type { AgentLoopResult, MemoryEntry, MemoryEntryType } from '../types';
import type { MemoryStore, ConversationSummarizer } from '../memory';
import type { KnowledgeBaseManager } from '../knowledge';
import type { SessionStore } from '@micro-agent/storage';

/**
 * 工具注册表接口（避免循环依赖）
 */
export interface ToolRegistryLike {
  getDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }>;
  execute(name: string, input: unknown, ctx: ToolContext): Promise<string>;
}

/**
 * Agent 配置
 */
export interface AgentExecutorConfig {
  /** 工作目录 */
  workspace: string;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 最大 tokens */
  maxTokens: number;
  /** 温度 */
  temperature: number;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 对话模型 */
  chatModel?: string;
  /** 工具调用模型（可选，默认使用 chatModel） */
  toolModel?: string;
  /** 视觉模型，用于图片识别任务 */
  visionModel?: string;
  /** 编程模型，用于代码编写任务 */
  coderModel?: string;
  /** 意图识别模型（不会被路由，始终固定） */
  intentModel?: string;
  /** 可用模型列表 */
  availableModels?: Map<string, ModelConfig[]>;
  /** 预处理阶段提示词构建函数 */
  buildPreflightPrompt?: PreflightPromptBuilder;
  /** 模型选择阶段提示词构建函数 */
  buildRoutingPrompt?: PreflightPromptBuilder;
  /** 循环检测配置 */
  loopDetection?: Partial<LoopDetectionConfig>;
  /** 最大历史消息数 */
  maxHistoryMessages?: number;
  /** 记忆系统是否启用 */
  memoryEnabled?: boolean;
  /** 自动摘要阈值 */
  summarizeThreshold?: number;
  /** 空闲超时时间 */
  idleTimeout?: number;
  /** 知识库是否启用 */
  knowledgeEnabled?: boolean;
  /** 知识库检索结果数量 */
  knowledgeLimit?: number;
  /** 是否启用引用溯源 */
  citationEnabled?: boolean;
  /** 引用最小置信度 */
  citationMinConfidence?: number;
  /** 最大引用数 */
  citationMaxCount?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: AgentExecutorConfig = {
  workspace: './workspace',
  maxIterations: 20,
  maxTokens: 8192,
  temperature: 0.7,
};

/**
 * 最大会话数量（防止内存泄漏）
 */
export const MAX_SESSIONS = 1000;

/**
 * Executor 依赖项
 */
export interface ExecutorDependencies {
  bus: MessageBus;
  gateway: LLMGateway;
  tools: ToolRegistryLike;
  config?: AgentExecutorConfig;
  memoryStore?: MemoryStore;
  summarizer?: ConversationSummarizer;
  knowledgeBaseManager?: KnowledgeBaseManager;
  sessionStore?: SessionStore;
}

/**
 * 工具调用上下文
 */
export interface ToolExecutionContext {
  channel: string;
  chatId: string;
  workspace: string;
  currentDir: string;
  sendToBus: (message: unknown) => Promise<void>;
}