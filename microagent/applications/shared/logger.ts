/**
 * LogTape 日志配置模块
 *
 * 提供结构化 JSON 文件日志和人类可读的控制台输出
 * 
 * 日志策略：
 * - 文件日志：JSON Lines 格式（每行一个 JSON 对象），用于问题定位和调试
 * - 控制台日志：人类可读格式，支持颜色输出
 * - 日志文件存储在 ~/.micro-agent/logs/ 目录
 * - 按日期滚动，自动保留最近 7 天的日志
 */

import { configure, getLogger, type Logger, type LogRecord, type Sink } from "@logtape/logtape";
import { getFileSink } from "@logtape/file";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { LOGS_DIR } from "./constants.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 日志配置选项
 */
export interface LoggerConfig {
  /** 日志级别 */
  level?: "debug" | "info" | "warning" | "error";
  /** 是否输出到控制台 */
  console?: boolean;
  /** 是否输出到文件 */
  file?: boolean;
  /** 自定义日志目录 */
  logDir?: string;
  /** 是否启用颜色输出（仅控制台） */
  color?: boolean;
}

/**
 * 方法调用日志数据
 */
export interface MethodCallLogData {
  /** 方法名 */
  method: string;
  /** 类名或模块名 */
  module: string;
  /** 接收的参数 */
  params?: Record<string, unknown>;
  /** 调用来源 */
  caller?: string;
}

/**
 * 方法返回日志数据
 */
export interface MethodReturnLogData {
  /** 方法名 */
  method: string;
  /** 类名或模块名 */
  module: string;
  /** 返回值（脱敏后） */
  result?: unknown;
  /** 执行耗时（毫秒） */
  duration?: number;
}

/**
 * 方法错误日志数据
 */
export interface MethodErrorLogData {
  /** 方法名 */
  method: string;
  /** 类名或模块名 */
  module: string;
  /** 错误信息 */
  error: {
    name: string;
    message: string;
    stack?: string | undefined;
  };
  /** 接收的参数 */
  params?: Record<string, unknown>;
  /** 执行耗时（毫秒） */
  duration?: number;
}

// ============================================================================
// 全局状态
// ============================================================================

/** 是否已初始化 */
let initialized = false;

/** 默认日志级别 */
let defaultLevel: "debug" | "info" | "warning" | "error" = "info";

/** 是否启用颜色 */
let colorEnabled = true;

/** 原始 console 方法（在 CLI 禁用全局 console 前保存） */
let originalConsole: {
  log: typeof console.log;
  info: typeof console.info;
  debug: typeof console.debug;
  warn: typeof console.warn;
  error: typeof console.error;
} | null = null;

/**
 * 设置原始 console 方法
 * 在 CLI 禁用全局 console 之前调用
 */
export function setOriginalConsole(console: {
  log: typeof globalThis.console.log;
  info: typeof globalThis.console.info;
  debug: typeof globalThis.console.debug;
  warn: typeof globalThis.console.warn;
  error: typeof globalThis.console.error;
}): void {
  originalConsole = console;
}

// ============================================================================
// 颜色定义（ANSI 转义码）
// ============================================================================

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

/** 日志级别背景色（用于标签） */
const LEVEL_BG_COLORS: Record<string, string> = {
  debug: "\x1b[100m", // 灰色背景
  info: "\x1b[44m",   // 蓝色背景
  warning: "\x1b[43m", // 黄色背景
  error: "\x1b[41m",  // 红色背景
};

// ============================================================================
// 格式化器
// ============================================================================

/** JSON Lines 格式化器 */
function jsonFormatter(record: LogRecord): string {
  const entry = {
    timestamp: new Date(record.timestamp).toISOString(),
    level: record.level,
    category: record.category,
    message: record.message,
    properties: record.properties,
  };
  return JSON.stringify(entry) + "\n";
}

/**
 * 人类可读的控制台格式化器
 * 
 * 输出格式：
 * [时间] 级别 [分类] 消息 | 属性1=值1 属性2=值2 ...
 */
function humanReadableFormatter(record: LogRecord): string {
  const timestamp = new Date(record.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  
  const level = record.level.toUpperCase().padEnd(7);
  const category = record.category.slice(1).join("."); // 去掉 "microagent" 前缀
  const message = typeof record.message === "string" 
    ? record.message 
    : JSON.stringify(record.message);
  
  // 格式化属性
  let propsStr = "";
  if (record.properties && Object.keys(record.properties).length > 0) {
    propsStr = " | " + formatProperties(record.properties);
  }
  
  // 应用颜色
  if (colorEnabled) {
    const bgLevel = LEVEL_BG_COLORS[record.level] ?? "";
    const coloredLevel = `${bgLevel}${COLORS.bold}${COLORS.white} ${level.trim()} ${COLORS.reset}`;
    const coloredTimestamp = `${COLORS.dim}${timestamp}${COLORS.reset}`;
    const coloredCategory = `${COLORS.cyan}${category}${COLORS.reset}`;
    
    return `${coloredTimestamp} ${coloredLevel} [${coloredCategory}] ${message}${propsStr}`;
  }
  
  return `[${timestamp}] ${level} [${category}] ${message}${propsStr}`;
}

/**
 * 格式化属性对象为易读字符串
 */
function formatProperties(props: Record<string, unknown>, _indent = 0): string {
  const entries: string[] = [];
  
  for (const [key, value] of Object.entries(props)) {
    const formattedValue = formatValue(value, _indent);
    entries.push(`${key}=${formattedValue}`);
  }
  
  return entries.join(" ");
}

/**
 * 格式化单个值
 */
function formatValue(value: unknown, indent = 0): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  
  if (typeof value === "string") {
    // 长字符串截断
    if (value.length > 100) {
      return `"${value.substring(0, 100)}..."`;
    }
    return `"${value}"`;
  }
  
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.length <= 3 && value.every(v => typeof v !== "object")) {
      return `[${value.map(v => formatValue(v, indent)).join(", ")}]`;
    }
    return `[${value.length} items]`;
  }
  
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    if (keys.length <= 3) {
      const inner = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}:${formatValue(v, indent + 1)}`)
        .join(", ");
      return `{${inner}}`;
    }
    return `{${keys.length} keys}`;
  }
  
  return String(value);
}

// ============================================================================
// 日志配置函数
// ============================================================================

/**
 * 初始化日志系统
 * 
 * @param config - 日志配置
 */
export async function initLogger(config: LoggerConfig = {}): Promise<void> {
  if (initialized) {
    return;
  }

  const level = config.level ?? "info";
  defaultLevel = level;
  colorEnabled = config.color !== false;
  const logDir = config.logDir ?? LOGS_DIR;

  // 构建 sinks 配置
  const sinks: Record<string, Sink> = {};

  // JSON 文件 sink（主 sink）
  if (config.file !== false) {
    // 确保日志目录存在
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      // 忽略目录已存在的错误
    }
    
    const date = new Date().toISOString().split("T")[0];
    const logFile = join(logDir, `${date}.jsonl`);
    
    sinks.jsonl = getFileSink(logFile, {
      formatter: jsonFormatter,
    });
  }

  // 控制台 sink（可选）
  if (config.console === true) {
    sinks.console = (record: LogRecord) => {
      const output = humanReadableFormatter(record);
      const con = originalConsole ?? console;
      
      if (record.level === "error") {
        con.error(output);
      } else if (record.level === "warning") {
        con.warn(output);
      } else {
        con.log(output);
      }
    };
  }

  // 配置 logtape
  await configure({
    sinks,
    loggers: [
      {
        category: ["microagent"],
        sinks: config.console === true ? ["jsonl", "console"] : ["jsonl"],
        lowestLevel: level,
      },
    ],
  });

  initialized = true;
}

/**
 * 获取指定分类的 Logger
 * 
 * @param category - 日志分类，如 ["runtime", "kernel", "agent-loop"]
 * @returns Logger 实例
 */
export function getModuleLogger(category: string[]): Logger {
  return getLogger(["microagent", ...category]);
}

// ============================================================================
// 便捷函数 - 按模块获取 Logger
// ============================================================================

/** Runtime Kernel */
export const kernelLogger = () => getModuleLogger(["runtime", "kernel"]);

/** Runtime Provider */
export const providerLogger = () => getModuleLogger(["runtime", "provider"]);

/** Runtime Tool */
export const toolLogger = () => getModuleLogger(["runtime", "tool"]);

/** Runtime Session */
export const sessionLogger = () => getModuleLogger(["runtime", "session"]);

/** Runtime Bus */
export const busLogger = () => getModuleLogger(["runtime", "bus"]);

/** Runtime Channel */
export const channelLogger = () => getModuleLogger(["runtime", "channel"]);

/** Runtime Memory */
export const memoryLogger = () => getModuleLogger(["runtime", "memory"]);

/** Runtime Skill */
export const skillLogger = () => getModuleLogger(["runtime", "skill"]);

/** Applications Builder */
export const builderLogger = () => getModuleLogger(["applications", "builder"]);

/** Applications Config */
export const configLogger = () => getModuleLogger(["applications", "config"]);

/** Applications CLI */
export const cliLogger = () => getModuleLogger(["applications", "cli"]);

/** Applications Providers */
export const providersLogger = () => getModuleLogger(["applications", "providers"]);

/** Applications Channels */
export const channelsLogger = () => getModuleLogger(["applications", "channels"]);

/** Applications Tools */
export const toolsLogger = () => getModuleLogger(["applications", "tools"]);

/** Applications MCP */
export const mcpLogger = () => getModuleLogger(["applications", "mcp"]);

/** Applications Skills */
export const skillsLogger = () => getModuleLogger(["applications", "skills"]);

/** Applications Prompts */
export const promptsLogger = () => getModuleLogger(["applications", "prompts"]);

/** Applications Shared */
export const sharedLogger = () => getModuleLogger(["applications", "shared"]);

// ============================================================================
// 辅助函数 - 方法调用日志
// ============================================================================

/**
 * 记录方法调用开始
 */
export function logMethodCall(
  logger: Logger,
  data: MethodCallLogData
): void {
  logger.debug("方法调用开始", {
    ...data,
    timestamp: Date.now(),
  });
}

/**
 * 记录方法调用返回
 */
export function logMethodReturn(
  logger: Logger,
  data: MethodReturnLogData
): void {
  logger.debug("方法调用返回", {
    ...data,
    timestamp: Date.now(),
  });
}

/**
 * 记录方法调用错误
 */
export function logMethodError(
  logger: Logger,
  data: MethodErrorLogData
): void {
  logger.error("方法调用错误", {
    ...data,
    timestamp: Date.now(),
  });
}

/**
 * 创建计时器
 */
export function createTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

/**
 * 脱敏对象（移除敏感信息）
 */
export function sanitize(obj: unknown, maxDepth = 3): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    // 字符串截断
    if (typeof obj === "string" && obj.length > 500) {
      return obj.substring(0, 500) + "...[truncated]";
    }
    return obj;
  }

  if (maxDepth <= 0) {
    return "[max depth reached]";
  }

  // 处理数组
  if (Array.isArray(obj)) {
    if (obj.length > 10) {
      return [...obj.slice(0, 10).map(v => sanitize(v, maxDepth - 1)), `...${obj.length - 10} more items`];
    }
    return obj.map(v => sanitize(v, maxDepth - 1));
  }

  // 处理对象
  const sensitiveKeys = ["password", "token", "secret", "apiKey", "api_key", "credential", "authorization"];
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // 敏感字段脱敏
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitize(value, maxDepth - 1);
    }
  }
  
  return result;
}

// 导出初始化状态检查
export const isLoggerInitialized = () => initialized;

// 导出获取默认日志级别
export const getDefaultLevel = () => defaultLevel;
