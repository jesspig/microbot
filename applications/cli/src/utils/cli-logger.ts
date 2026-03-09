/**
 * CLI 日志输出器
 * 
 * CLI 前台仅输出错误、警告、重要操作日志，避免信息过载。
 * 支持彩色输出和简洁格式。
 */

import type { LogEntry, LogLevel, MemoryOpLog } from '@micro-agent/sdk/runtime';

// ============================================================
// 类型定义
// ============================================================

/** CLI 日志级别 */
export type CLILogLevel = 'error' | 'warn' | 'info' | 'debug';

/** CLI 日志配置 */
export interface CLILoggerConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 最低输出级别 */
  level: CLILogLevel;
  /** 是否启用彩色输出 */
  colorEnabled: boolean;
  /** 是否显示时间戳 */
  showTimestamp: boolean;
  /** 是否显示操作详情 */
  verbose: boolean;
  /** 关键操作列表（这些操作的日志会显示） */
  importantOperations: string[];
}

/** 默认配置 */
const DEFAULT_CONFIG: CLILoggerConfig = {
  enabled: true,
  level: 'warn', // 默认只显示警告和错误
  colorEnabled: true,
  showTimestamp: true,
  verbose: false,
  importantOperations: [
    'clear',      // 清空记忆
    'migrate',    // 迁移操作
    'cleanup',    // 清理过期
    'error',      // 错误
  ],
};

// ============================================================
// 颜色工具
// ============================================================

/** ANSI 颜色代码 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
} as const;

/** 级别对应的颜色 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: COLORS.dim,
  debug: COLORS.cyan,
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
  fatal: COLORS.bgRed + COLORS.white,
};

/** 级别对应的图标 */
const LEVEL_ICONS: Record<LogLevel, string> = {
  trace: '🔍',
  debug: '🐛',
  info: '✓',
  warn: '⚠',
  error: '✗',
  fatal: '💀',
};

// ============================================================
// CLI 日志输出器
// ============================================================

/**
 * CLI 日志输出器
 * 
 * 提供简洁的 CLI 日志输出，仅显示重要信息。
 */
export class CLILogger {
  private config: CLILoggerConfig;
  private pendingLogs: LogEntry[] = [];
  private maxPendingSize = 50;

  constructor(config: Partial<CLILoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 级别优先级
   */
  private getLevelPriority(level: LogLevel): number {
    const priorities: Record<LogLevel, number> = {
      trace: 0,
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
      fatal: 5,
    };
    return priorities[level] ?? 0;
  }

  /**
   * 检查是否应该输出
   */
  private shouldOutput(entry: LogEntry): boolean {
    if (!this.config.enabled) return false;
    
    // 检查级别
    const entryPriority = this.getLevelPriority(entry.level);
    const configPriority = this.getLevelPriority(this.config.level as LogLevel);
    if (entryPriority < configPriority) return false;
    
    // 检查是否是重要操作
    if (this.isMemoryLog(entry)) {
      const operation = entry.operation;
      if (this.config.importantOperations.includes(operation)) {
        return true;
      }
    }
    
    // 错误和警告总是显示
    if (entry.level === 'error' || entry.level === 'warn' || entry.level === 'fatal') {
      return true;
    }
    
    return false;
  }

  /**
   * 类型守卫：检查是否为记忆日志
   */
  private isMemoryLog(entry: LogEntry): entry is MemoryOpLog {
    return entry._type === 'memory_op';
  }

  /**
   * 应用颜色
   */
  private colorize(text: string, color: string): string {
    if (!this.config.colorEnabled) return text;
    return `${color}${text}${COLORS.reset}`;
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * 格式化日志条目
   */
  private formatEntry(entry: LogEntry): string {
    const parts: string[] = [];
    
    // 时间戳
    if (this.config.showTimestamp) {
      const ts = this.colorize(this.formatTimestamp(entry.timestamp), COLORS.dim);
      parts.push(`[${ts}]`);
    }
    
    // 级别图标
    const icon = LEVEL_ICONS[entry.level];
    parts.push(icon);
    
    // 消息
    const levelColor = LEVEL_COLORS[entry.level];
    const message = this.colorize(entry.message, levelColor);
    parts.push(message);
    
    // 详细信息
    if (this.config.verbose && this.isMemoryLog(entry)) {
      const details: string[] = [];
      
      if (entry.memoryType) {
        details.push(`类型: ${entry.memoryType}`);
      }
      if (entry.sessionId) {
        details.push(`会话: ${entry.sessionId.slice(0, 8)}...`);
      }
      if (entry.duration !== undefined) {
        details.push(`耗时: ${entry.duration}ms`);
      }
      if (entry.resultCount !== undefined) {
        details.push(`结果: ${entry.resultCount}`);
      }
      
      if (details.length > 0) {
        const detailStr = this.colorize(`(${details.join(', ')})`, COLORS.dim);
        parts.push(detailStr);
      }
    }
    
    // 错误信息（仅对包含 error 字段的日志类型）
    if ('error' in entry && entry.error) {
      const errorStr = this.colorize(`错误: ${entry.error}`, COLORS.red);
      parts.push(errorStr);
    }
    
    return parts.join(' ');
  }

  /**
   * 输出日志
   */
  output(entry: LogEntry): void {
    if (!this.shouldOutput(entry)) {
      // 保存到待处理队列（用于查询）
      this.pendingLogs.push(entry);
      if (this.pendingLogs.length > this.maxPendingSize) {
        this.pendingLogs.shift();
      }
      return;
    }
    
    const formatted = this.formatEntry(entry);
    
    // 根据级别选择输出流
    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(formatted);
    } else if (entry.level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
    
    // 同时保存到待处理队列
    this.pendingLogs.push(entry);
    if (this.pendingLogs.length > this.maxPendingSize) {
      this.pendingLogs.shift();
    }
  }

  /**
   * 批量输出
   */
  outputBatch(entries: LogEntry[]): void {
    for (const entry of entries) {
      this.output(entry);
    }
  }

  /**
   * 输出简单消息
   */
  log(level: CLILogLevel, message: string, details?: Record<string, unknown>): void {
    const entry = {
      _type: 'event' as const,
      timestamp: new Date().toISOString(),
      level: level === 'debug' ? 'debug' as const : level as LogLevel,
      category: 'cli',
      message,
      eventName: 'cli_log',
      data: details,
    };
    
    this.output(entry as LogEntry);
  }

  /**
   * 快捷方法：错误
   */
  error(message: string, error?: Error | string): void {
    const entry: LogEntry = {
      _type: 'error',
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'cli',
      errorType: 'CLIError',
      errorMessage: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    } as LogEntry;
    
    this.output(entry);
  }

  /**
   * 快捷方法：警告
   */
  warn(message: string, details?: Record<string, unknown>): void {
    this.log('warn', message, details);
  }

  /**
   * 快捷方法：信息
   */
  info(message: string, details?: Record<string, unknown>): void {
    this.log('info', message, details);
  }

  /**
   * 快捷方法：调试
   */
  debug(message: string, details?: Record<string, unknown>): void {
    this.log('debug', message, details);
  }

  /**
   * 输出进度条
   */
  progress(current: number, total: number, label: string): void {
    if (!this.config.enabled) return;
    
    const percent = Math.round((current / total) * 100);
    const barLength = 20;
    const filled = Math.round((current / total) * barLength);
    const empty = barLength - filled;
    
    const bar = this.colorize('█'.repeat(filled), COLORS.green) + 
                this.colorize('░'.repeat(empty), COLORS.dim);
    const percentStr = this.colorize(`${percent}%`, COLORS.cyan);
    
    process.stdout.write(`\r${bar} ${percentStr} ${label}`);
    
    if (current >= total) {
      process.stdout.write('\n');
    }
  }

  /**
   * 输出表格
   */
  table(data: Record<string, unknown>[]): void {
    if (!this.config.enabled) return;
    console.table(data);
  }

  /**
   * 清空控制台
   */
  clear(): void {
    console.clear();
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(count = 10): LogEntry[] {
    return this.pendingLogs.slice(-count);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CLILoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): CLILoggerConfig {
    return { ...this.config };
  }

  /**
   * 设置详细模式
   */
  setVerbose(enabled: boolean): void {
    this.config.verbose = enabled;
    this.config.level = enabled ? 'debug' : 'warn';
  }

  /**
   * 设置级别
   */
  setLevel(level: CLILogLevel): void {
    this.config.level = level;
  }
}

// ============================================================
// 全局实例
// ============================================================

/** 全局 CLI 日志器实例 */
let globalCLILogger: CLILogger | null = null;

/**
 * 获取全局 CLI 日志器
 */
export function getCLILogger(config?: Partial<CLILoggerConfig>): CLILogger {
  if (!globalCLILogger) {
    globalCLILogger = new CLILogger(config);
  }
  return globalCLILogger;
}

/**
 * 重置全局 CLI 日志器
 */
export function resetCLILogger(): void {
  globalCLILogger = null;
}
