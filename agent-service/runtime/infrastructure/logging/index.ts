/**
 * Logging 模块入口
 */

export {
  getLogger,
  initLogging,
  closeLogging,
  isLoggingInitialized,
  getLogFilePath,
  createModuleLogger,
  subscribeToLogs,
} from './logger';

export {
  getTracer,
  setTracer,
  traceMethod,
  traced,
} from './tracer';

// 重新导出 Tracer 类和 TracerOptions
export { Tracer } from './tracer';
export type { TracerOptions } from './types';

export type {
  LogLevel,
  LoggingConfig,
  TraceContext,
  LogType,
  BaseLogEntry,
  MethodCallLog,
  LLMCallLog,
  ToolCallLog,
  EventLog,
  LogEntry,
  LogEventListener,
  ServiceLifecycleLog,
  SessionLifecycleLog,
  IPCMessageLog,
  MemoryOpLog,
} from './types';
