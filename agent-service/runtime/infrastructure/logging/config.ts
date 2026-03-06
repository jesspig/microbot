/**
 * 日志配置管理
 */

import { homedir } from 'os';
import { join } from 'path';
import type { LoggingConfig, LogLevel } from './types';

let loggingConfig: LoggingConfig = {};
let logFilePath: string | null = null;

/** 初始化日志系统 */
export async function initLogging(config: LoggingConfig = {}): Promise<void> {
  loggingConfig = config;
  
  if (config.file) {
    const logDir = config.logDir || join(homedir(), '.micro-agent', 'logs');
    logFilePath = join(logDir, `agent-${new Date().toISOString().split('T')[0]}.log`);
  }
}

/** 关闭日志系统 */
export async function closeLogging(): Promise<void> {
  loggingConfig = {};
  logFilePath = null;
}

/** 检查日志是否已初始化 */
export function isLoggingInitialized(): boolean {
  return Object.keys(loggingConfig).length > 0;
}

/** 获取日志文件路径 */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/** 创建模块日志器 */
export function createModuleLogger(module: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => 
      log('debug', [module], message, data),
    info: (message: string, data?: Record<string, unknown>) => 
      log('info', [module], message, data),
    warn: (message: string, data?: Record<string, unknown>) => 
      log('warn', [module], message, data),
    error: (message: string, data?: Record<string, unknown>) => 
      log('error', [module], message, data),
  };
}

/** 内部日志函数 */
function log(level: LogLevel, module: string[], message: string, data?: Record<string, unknown>): void {
  const configLevel = loggingConfig.level || 'info';
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  
  if (levels.indexOf(level) < levels.indexOf(configLevel)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${module.join(':')}]`;
  
  if (loggingConfig.console) {
    const colors = {
      debug: '\x1b[36m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    const reset = '\x1b[0m';
    
    let output = `${colors[level]}${prefix}${reset} ${message}`;
    if (data && Object.keys(data).length > 0) {
      output += ` ${reset}\x1b[90m${JSON.stringify(data)}\x1b[0m`;
    }
    
    console.log(output);
  }

  // TODO: 文件输出
}
