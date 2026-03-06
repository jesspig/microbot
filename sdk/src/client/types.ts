/**
 * SDK 公共类型定义
 */

/** 传输类型 */
export type TransportType = 'ipc' | 'http' | 'websocket';

/** IPC 配置 */
export interface IPCConfig {
  /** Agent Service 路径（Bun IPC 模式） */
  servicePath?: string;
  /** TCP 端口（TCP Loopback 模式，Windows） */
  port?: number;
  /** Socket 路径（Unix Socket 模式，Linux/macOS） */
  path?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 序列化方式（Bun IPC） */
  serialization?: 'advanced' | 'json';
}

/** HTTP 配置 */
export interface HTTPConfig {
  /** 服务地址 */
  baseUrl: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 请求头 */
  headers?: Record<string, string>;
}

/** WebSocket 配置 */
export interface WebSocketConfig {
  /** WebSocket URL */
  url: string;
  /** 重连间隔（毫秒） */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}

/** SDK 客户端配置 */
export interface SDKClientConfig {
  /** 传输类型 */
  transport: TransportType;
  /** IPC 配置 */
  ipc?: IPCConfig;
  /** HTTP 配置 */
  http?: HTTPConfig;
  /** WebSocket 配置 */
  websocket?: WebSocketConfig;
}

/** 流式响应块 */
export interface StreamChunk {
  /** 消息类型 */
  type: 'text' | 'tool_call' | 'thinking' | 'error' | 'done';
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp: Date;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 流式处理器 */
export type StreamHandler = (chunk: StreamChunk) => void;

/** 会话键类型 */
export type SessionKey = `${string}:${string}`;

/** 运行时配置 */
export interface RuntimeConfig {
  /** 工作目录 */
  workspace?: string;
  /** 模型配置 */
  models?: {
    chat?: string;
    tool?: string;
    embed?: string;
    vision?: string;
    coder?: string;
    intent?: string;
  };
  /** 最大 Token 数 */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 最大迭代次数 */
  maxIterations?: number;
}

/** 提示词模板 */
export interface PromptTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板内容 */
  content: string;
  /** 变量定义 */
  variables?: Record<string, {
    description?: string;
    default?: unknown;
    required?: boolean;
  }>;
}

/** LLM 消息 */
export interface LLMMessage {
  /** 角色 */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp?: Date;
  /** 工具调用 */
  toolCalls?: ToolCall[];
}

/** 工具调用 */
export interface ToolCall {
  /** 调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 参数 */
  arguments: Record<string, unknown>;
  /** 结果 */
  result?: unknown;
}
