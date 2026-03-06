/**
 * 日志类型定义
 */

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志配置 */
export interface LoggingConfig {
  /** 控制台输出 */
  console?: boolean;
  /** 文件输出 */
  file?: boolean;
  /** 日志级别 */
  level?: LogLevel;
  /** 日志目录 */
  logDir?: string;
  /** 启用追踪 */
  traceEnabled?: boolean;
}

/** 默认配置 */
export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  console: true,
  file: false,
  level: 'info',
  traceEnabled: false,
};

/** 追踪上下文 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/** 方法调用日志 */
export interface MethodCallLog {
  timestamp: Date;
  module: string;
  method: string;
  args: unknown[];
  result?: unknown;
  error?: Error;
  duration: number;
}

/** LLM 调用日志 */
export interface LLMCallLog {
  timestamp: Date;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  duration: number;
}

/** 工具调用日志 */
export interface ToolCallLog {
  timestamp: Date;
  tool: string;
  input: unknown;
  output?: unknown;
  error?: Error;
  duration: number;
}

/** 事件日志 */
export interface EventLog {
  timestamp: Date;
  event: string;
  data: unknown;
}

/** 日志条目 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string[];
  message: string;
  data?: Record<string, unknown>;
  trace?: TraceContext;
}

/** 追踪器选项 */
export interface TracerOptions {
  enabled: boolean;
  sampleRate: number;
}
