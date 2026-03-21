/**
 * OpenAI Provider 工具函数
 *
 * 提供辅助函数
 */

import { LOG_TRUNCATE_LENGTH } from "./openai-constants.js";

/**
 * 截断文本用于日志
 * 避免日志过长影响可读性
 * @param text - 待截断的文本
 * @param maxLen - 最大长度
 * @returns 截断后的文本
 */
export function truncateTextForLog(text: string, maxLen = LOG_TRUNCATE_LENGTH): string {
  if (!text) return "";
  return text.length > maxLen ? text.substring(0, maxLen) + "...(truncated)" : text;
}
