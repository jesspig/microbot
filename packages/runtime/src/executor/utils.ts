/**
 * Executor 辅助工具方法
 *
 * 包含格式化、错误处理等通用工具函数
 */

import type { LLMToolDefinition } from '@micro-agent/types';

/**
 * 安全的错误消息（脱敏）
 */
export function safeErrorMsg(error: unknown): string {
  if (!(error instanceof Error)) return '未知错误';

  let msg = error.message;
  msg = msg.replace(/[A-Z]:\\[^\s]+/gi, '[路径]');
  msg = msg.replace(/[a-zA-Z0-9_-]{20,}/g, '[密钥]');

  return msg;
}

/**
 * 格式化工具输入参数预览
 */
export function formatInputPreview(input: unknown, maxLength = 50): string {
  if (input === null || input === undefined) return '';
  
  if (typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return '';
    
    const parts = entries.slice(0, 2).map(([key, value]) => {
      let valStr: string;
      if (typeof value === 'string') {
        valStr = value.length > 20 ? `${value.slice(0, 20)}...` : value;
      } else if (typeof value === 'object' && value !== null) {
        valStr = '{...}';
      } else {
        valStr = String(value);
      }
      return `${key}=${valStr}`;
    });
    
    let result = parts.join(', ');
    if (entries.length > 2) {
      result += ` +${entries.length - 2}`;
    }
    return result.length > maxLength ? result.slice(0, maxLength) + '...' : result;
  }
  
  return '';
}

/**
 * 格式化工具结果预览
 */
export function formatResultPreview(result: string, maxLength = 100): string {
  if (!result) return '\x1b[90m(空)\x1b[0m';
  
  // 尝试解析 JSON 结果
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === 'object' && parsed !== null) {
      if (parsed.error) {
        return `\x1b[31m❌ ${parsed.message || '执行失败'}\x1b[0m`;
      }
      // 显示关键字段
      const keys = Object.keys(parsed);
      if (keys.length > 0) {
        const preview = keys.slice(0, 3).join(', ');
        return `\x1b[32m{${preview}${keys.length > 3 ? ', ...' : ''}}\x1b[0m`;
      }
    }
  } catch {
    // 非 JSON
  }
  
  // 普通文本截取
  const cleanResult = result.replace(/\n/g, ' ').trim();
  if (cleanResult.length > maxLength) {
    return `\x1b[90m${cleanResult.slice(0, maxLength)}...\x1b[0m`;
  }
  return `\x1b[90m${cleanResult}\x1b[0m`;
}

/**
 * 缓存工具定义
 */
export function createToolCache(
  getDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }>
) {
  let cachedToolDefinitions: Array<{ name: string; description: string; inputSchema: unknown }> | null = null;
  let cachedLLMTools: LLMToolDefinition[] | null = null;

  return {
    getToolDefinitions: () => {
      if (!cachedToolDefinitions) {
        cachedToolDefinitions = getDefinitions();
      }
      return cachedToolDefinitions;
    },
    getLLMToolDefinitions: () => {
      if (!cachedLLMTools) {
        const defs = getDefinitions();
        cachedLLMTools = defs.map(def => ({
          type: 'function' as const,
          function: {
            name: def.name,
            description: def.description,
            parameters: def.inputSchema as Record<string, unknown>,
          },
        }));
      }
      return cachedLLMTools;
    },
  };
}
