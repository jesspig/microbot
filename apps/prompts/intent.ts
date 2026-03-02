/**
 * 应用层意图识别提示词
 *
 * 分阶段提示词：
 * 1. preflight.md - 预处理阶段，决定是否检索记忆
 * 2. routing.md - 模型选择阶段，决定使用哪个模型
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryEntry } from '@micro-agent/providers';

// 缓存 markdown 模板
const templateCache = new Map<string, string>();

/**
 * 读取提示词模板
 */
function loadTemplate(name: string): string {
  if (templateCache.has(name)) {
    return templateCache.get(name)!;
  }

  const templatePath = join(__dirname, `${name}.md`);
  const content = readFileSync(templatePath, 'utf-8');
  templateCache.set(name, content);
  return content;
}

/**
 * 构建预处理阶段提示词
 * @param content 用户消息内容
 * @param hasImage 是否包含图片
 * @param history 对话历史（可选，用于上下文重试）
 */
export function buildPreflightPrompt(
  content: string,
  hasImage: boolean,
  history?: HistoryEntry[],
): string {
  const template = loadTemplate('preflight');

  // 如果有历史记录，注入上下文
  if (history && history.length > 0) {
    const historyText = history
      .map(h => `[${h.role === 'user' ? '用户' : '助手'}]: ${h.content}`)
      .join('\n');

    return `${template}

---

## 当前消息
${hasImage ? '（包含图片）' : ''}${content}

## 对话历史
${historyText}`;
  }

  // 无历史记录，简单模式
  return `${template}

---

请分析以下用户请求${hasImage ? '（包含图片）' : ''}：

${content}`;
}

/**
 * 构建模型选择阶段提示词
 */
export function buildRoutingPrompt(content: string, hasImage: boolean): string {
  const template = loadTemplate('routing');
  return `${template}

---

请分析以下用户请求${hasImage ? '（包含图片）' : ''}：

${content}`;
}