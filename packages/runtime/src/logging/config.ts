/**
 * 日志配置模块
 * 
 * 提供统一的日志配置，支持控制台和文件输出，JSON Lines 格式。
 * 日志文件格式：YYYY-MM-DD-<batch>.log
 */

import { configure, getConsoleSink, reset, type LogRecord, type Sink } from '@logtape/logtape';
import { mkdirSync, existsSync, statSync, readdirSync, createWriteStream, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { LoggingConfig } from './types';

/** 默认日志配置 */
const DEFAULT_CONFIG: LoggingConfig = {
  console: true,
  file: true,
  logDir: '~/.micro-agent/logs',
  logFilePrefix: 'app',
  level: 'info',
  traceEnabled: true,
  logInput: true,
  logOutput: true,
  logDuration: true,
  sensitiveFields: ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 30, // 保留30个日志文件
};

/** 是否已初始化 */
let initialized = false;

/** 当前日志文件信息 */
interface LogFileInfo {
  path: string;
  date: string;
  batch: number;
}

/**
 * 展开路径（支持 ~ 符号）
 */
function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * 获取当前日期字符串 (YYYY-MM-DD)
 */
function getCurrentDate(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

/**
 * 查找或创建当天最新的日志文件
 */
function findOrCreateLogFile(logDir: string, maxFileSize: number): LogFileInfo {
  const today = getCurrentDate();
  
  // 查找当天已有的日志文件
  let files: string[] = [];
  try {
    files = readdirSync(logDir)
      .filter(f => f.startsWith(today) && f.endsWith('.log'))
      .sort((a, b) => {
        // 按批次号降序排序
        const batchA = parseInt(a.match(/-(\d+)\.log$/)?.[1] ?? '0', 10);
        const batchB = parseInt(b.match(/-(\d+)\.log$/)?.[1] ?? '0', 10);
        return batchB - batchA;
      });
  } catch {
    // 目录不存在或读取失败
  }

  // 检查最新文件是否还有空间
  if (files.length > 0) {
    const latestFile = files[0];
    const filePath = join(logDir, latestFile);
    try {
      const stats = statSync(filePath);
      if (stats.size < maxFileSize) {
        const batch = parseInt(latestFile.match(/-(\d+)\.log$/)?.[1] ?? '1', 10);
        return { path: filePath, date: today, batch };
      }
    } catch {
      // 文件访问失败，创建新文件
    }
  }

  // 创建新文件
  const newBatch = files.length > 0 
    ? parseInt(files[0].match(/-(\d+)\.log$/)?.[1] ?? '0', 10) + 1 
    : 1;
  const batchStr = newBatch.toString().padStart(3, '0');
  const newFileName = `${today}-${batchStr}.log`;
  const newPath = join(logDir, newFileName);

  return { path: newPath, date: today, batch: newBatch };
}

/**
 * 清理过期日志文件
 */
function cleanupOldLogs(logDir: string, maxFiles: number): void {
  try {
    const files = readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .sort(); // 按文件名排序（日期批次格式自然排序）

    if (files.length > maxFiles) {
      const toDelete = files.slice(0, files.length - maxFiles);
      for (const f of toDelete) {
        try {
          unlinkSync(join(logDir, f));
        } catch {
          // 忽略删除失败
        }
      }
    }
  } catch {
    // 忽略清理失败
  }
}

/**
 * 自定义 JSON Lines 格式化器
 */
function jsonLinesFormatter(record: LogRecord): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: record.level,
    category: record.category.join('.'),
    message: record.message,
  };

  if (record.properties && Object.keys(record.properties).length > 0) {
    entry.properties = record.properties;
  }

  return JSON.stringify(entry) + '\n';
}

/**
 * 详细控制台格式化器
 */
function detailedConsoleFormatter(record: LogRecord): readonly unknown[] {
  const levelColors: Record<string, string> = {
    trace: '\x1b[90m',
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    warning: '\x1b[33m',
    error: '\x1b[31m',
    fatal: '\x1b[35m',
  };

  const resetColor = '\x1b[0m';
  const level = record.level.toUpperCase().padEnd(5);
  const levelColor = levelColors[record.level] ?? '';
  const category = record.category.join('\x1b[2m·\x1b[0m');
  const timestamp = new Date().toISOString().slice(11, 23);

  let message = '';
  const values: unknown[] = [];

  for (let i = 0; i < record.message.length; i++) {
    if (i % 2 === 0) {
      message += record.message[i];
    } else {
      message += '%o';
      values.push(record.message[i]);
    }
  }

  return [
    `${timestamp} ${levelColor}${level}${resetColor} \x1b[90m${category}\x1b[0m ${message}`,
    ...values,
  ];
}

/**
 * 创建日期批次文件 Sink
 * 
 * 日志文件格式：YYYY-MM-DD-<batch>.log
 * - 每天自动创建新日期的文件
 * - 文件超过 maxFileSize 时自动创建新批次
 */
function createDateBatchFileSink(
  logDir: string,
  maxFileSize: number,
  maxFiles: number,
  formatter: (record: LogRecord) => string
): Sink {
  let currentFile: LogFileInfo | null = null;
  let writer: ReturnType<typeof createWriteStream> | null = null;
  let lastCheckDate = '';

  // 初始化
  currentFile = findOrCreateLogFile(logDir, maxFileSize);
  writer = createWriteStream(currentFile.path, { flags: 'a' });
  lastCheckDate = currentFile.date;

  // 清理旧日志
  cleanupOldLogs(logDir, maxFiles);

  return (record: LogRecord) => {
    const today = getCurrentDate();

    // 确保文件已初始化
    if (!currentFile || !writer) {
      currentFile = findOrCreateLogFile(logDir, maxFileSize);
      writer = createWriteStream(currentFile.path, { flags: 'a' });
      lastCheckDate = currentFile.date;
      cleanupOldLogs(logDir, maxFiles);
    }

    // 检查是否需要切换文件（日期变化或文件过大）
    try {
      const stats = statSync(currentFile.path);
      if (today !== lastCheckDate || stats.size >= maxFileSize) {
        // 关闭当前文件
        writer.end();
        writer = null;

        // 创建新文件
        currentFile = findOrCreateLogFile(logDir, maxFileSize);
        writer = createWriteStream(currentFile.path, { flags: 'a' });
        lastCheckDate = today;

        // 清理旧日志
        cleanupOldLogs(logDir, maxFiles);
      }
    } catch {
      // 文件访问失败，重新创建
      currentFile = findOrCreateLogFile(logDir, maxFileSize);
      writer = createWriteStream(currentFile.path, { flags: 'a' });
      lastCheckDate = today;
    }

    // 写入日志
    const formatted = formatter(record);
    writer.write(formatted);
  };
}

/**
 * 初始化日志系统
 */
export async function initLogging(config: Partial<LoggingConfig> = {}): Promise<void> {
  const fullConfig: LoggingConfig = { ...DEFAULT_CONFIG, ...config };

  if (initialized) {
    reset();
  }

  const logDir = expandPath(fullConfig.logDir);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const sinks: Record<string, Sink> = {};

  // 控制台输出
  if (fullConfig.console) {
    sinks.console = getConsoleSink({
      formatter: detailedConsoleFormatter,
    });
  }

  // 文件输出 - 日期批次格式
  if (fullConfig.file) {
    sinks.file = createDateBatchFileSink(
      logDir,
      fullConfig.maxFileSize,
      fullConfig.maxFiles,
      jsonLinesFormatter
    );
  }

  // 日志级别映射
  const levelMap: Record<string, 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'> = {
    trace: 'trace',
    debug: 'debug',
    info: 'info',
    warn: 'warning',
    warning: 'warning',
    error: 'error',
    fatal: 'fatal',
  };

  const mappedLevel = levelMap[fullConfig.level] ?? 'info';

  const loggers = [
    { category: [], sinks: Object.keys(sinks), lowestLevel: mappedLevel },
    { category: ['logtape', 'meta'], sinks: Object.keys(sinks), lowestLevel: 'warning' as const },
    { category: ['tracer'], sinks: Object.keys(sinks), lowestLevel: fullConfig.traceEnabled ? 'debug' as const : 'info' as const },
  ];

  await configure({ sinks, loggers, reset: true });
  initialized = true;
}

/**
 * 关闭日志系统
 */
export async function closeLogging(): Promise<void> {
  if (initialized) {
    reset();
    initialized = false;
  }
}

/**
 * 检查日志系统是否已初始化
 */
export function isLoggingInitialized(): boolean {
  return initialized;
}

/**
 * 获取当前日志文件路径
 */
export function getLogFilePath(config: Partial<LoggingConfig> = {}): string {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const logDir = expandPath(fullConfig.logDir);
  const today = getCurrentDate();
  return join(logDir, `${today}-001.log`);
}

/**
 * 创建模块专用日志器
 */
export function createModuleLogger(moduleName: string) {
  return {
    getLogger: () => {
      return import('@logtape/logtape').then(({ getLogger }) => getLogger([moduleName]));
    },
  };
}
