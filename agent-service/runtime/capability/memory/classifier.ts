/**
 * 记忆分类器
 *
 * 自动识别记忆内容类型。
 */

import type { MemoryType } from '../../../types/memory';
import type { LLMProvider } from '../../../types/provider';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'classifier']);

/** 分类结果 */
export interface ClassificationResult {
  type: MemoryType;
  confidence: number;
  matchedPatterns: string[];
  source: 'rule' | 'llm';
}

/** 分类选项 */
export interface ClassifyOptions {
  useLLM?: boolean;
  llmThreshold?: number;
  context?: string;
  llmProvider?: LLMProvider;
}

/** 分类规则 */
interface ClassificationRule {
  type: MemoryType;
  keywords: RegExp[];
  patterns: RegExp[];
  priority: number;
}

/** 分类规则库 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    type: 'preference',
    keywords: [
      /喜欢|愛|like|love|prefer|enjoy/i,
      /讨厌|討厭|hate|dislike/i,
      /想要|需要|want|need|wish/i,
    ],
    patterns: [
      /我(喜欢|愛|讨厌).*/i,
      /我(想要|需要).*/i,
    ],
    priority: 5,
  },
  {
    type: 'decision',
    keywords: [
      /决定|決定|decided|decision/i,
      /选择|選擇|choose|selected/i,
      /同意|approve|agreed/i,
    ],
    patterns: [
      /我们?(决定|選擇|同意).*/i,
      /(已)?(确定|決定).*/i,
    ],
    priority: 4,
  },
  {
    type: 'entity',
    keywords: [
      /电话|電話|手机|mobile|phone/i,
      /邮箱|郵箱|email/i,
      /地址|address/i,
    ],
    patterns: [
      /我的?(电话|電話|手机).*/i,
      /我的?(邮箱|郵箱|email).*/i,
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    ],
    priority: 3,
  },
  {
    type: 'fact',
    keywords: [
      /是|are|is|am/i,
      /有|have|has/i,
      /职位|崗位|position/i,
    ],
    patterns: [
      /我(是|在|有).*/i,
      /我(做|从事).*/i,
    ],
    priority: 2,
  },
  {
    type: 'other',
    keywords: [],
    patterns: [],
    priority: 1,
  },
];

/**
 * 对记忆内容进行分类
 */
export async function classifyMemory(
  content: string,
  options?: ClassifyOptions
): Promise<ClassificationResult> {
  const results: ClassificationResult[] = [];

  for (const rule of CLASSIFICATION_RULES) {
    let matchCount = 0;
    const matchedPatterns: string[] = [];

    for (const keyword of rule.keywords) {
      if (keyword.test(content)) {
        matchCount++;
        matchedPatterns.push(`keyword:${keyword.source.slice(0, 20)}`);
      }
    }

    for (const pattern of rule.patterns) {
      if (pattern.test(content)) {
        matchCount++;
        matchedPatterns.push(`pattern:${pattern.source.slice(0, 20)}`);
      }
    }

    if (matchCount > 0) {
      const baseConfidence = Math.min(matchCount * 0.3, 0.9);
      const priorityBonus = (rule.priority - 1) * 0.02;
      const confidence = Math.min(baseConfidence + priorityBonus, 1.0);

      results.push({
        type: rule.type,
        confidence,
        matchedPatterns: matchedPatterns.slice(0, 3),
        source: 'rule',
      });
    }
  }

  if (results.length > 0) {
    results.sort((a, b) => b.confidence - a.confidence);
    return results[0];
  }

  return {
    type: 'other',
    confidence: 0.5,
    matchedPatterns: [],
    source: 'rule',
  };
}

/**
 * 批量分类
 */
export async function classifyMemoriesBatch(
  contents: string[],
  options?: ClassifyOptions
): Promise<ClassificationResult[]> {
  return Promise.all(contents.map(c => classifyMemory(c, options)));
}

/**
 * 获取分类说明
 */
export function getMemoryTypeDescription(type: MemoryType): string {
  const descriptions: Record<MemoryType, string> = {
    conversation: '对话记录',
    summary: '会话摘要',
    preference: '用户偏好',
    fact: '事实陈述',
    decision: '决策记录',
    entity: '实体信息',
    document: '文档内容',
    other: '其他信息',
  };
  return descriptions[type] ?? '未知类型';
}

/**
 * 获取分类图标
 */
export function getMemoryTypeIcon(type: MemoryType): string {
  const icons: Record<MemoryType, string> = {
    conversation: '💬',
    summary: '📝',
    preference: '❤️',
    fact: '📋',
    decision: '✅',
    entity: '👤',
    document: '📄',
    other: '📦',
  };
  return icons[type] ?? '📄';
}
