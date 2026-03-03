/**
 * 记忆分类器
 * 
 * 自动识别记忆内容类型，参考 OpenClaw 的分类策略：
 * - preference: 用户偏好（喜欢、讨厌、想要）
 * - fact: 事实陈述（用户属性、状态）
 * - decision: 决策记录（达成的决定）
 * - entity: 实体信息（电话、邮箱、名称等）
 * - document: 文档内容（知识库文档）
 * - other: 其他无法分类的信息
 * 
 * 支持规则分类和 LLM 辅助分类：
 * 1. 规则分类：基于关键词和正则模式匹配
 * 2. LLM 分类：当规则分类置信度低于阈值时，可选调用 LLM 辅助
 */

import type { MemoryEntryType } from '../types';
import type { LLMProvider } from '@micro-agent/types';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'classifier']);

/** 分类规则定义 */
interface ClassificationRule {
  type: MemoryEntryType;
  keywords: RegExp[];
  patterns: RegExp[];
  priority: number; // 优先级，数字越大越优先
}

/** 分类置信度结果 */
export interface ClassificationResult {
  type: MemoryEntryType;
  confidence: number; // 0-1
  matchedPatterns: string[];
  source: 'rule' | 'llm'; // 分类来源
}

/** 分类选项 */
export interface ClassifyOptions {
  /** 是否使用 LLM 辅助分类（默认 false） */
  useLLM?: boolean;
  /** 规则分类置信度阈值，低于此值时触发 LLM 分类（默认 0.5） */
  llmThreshold?: number;
  /** 上下文信息，用于辅助分类 */
  context?: string;
  /** LLM Provider 实例（useLLM 为 true 时必填） */
  llmGateway?: LLMProvider;
}

/** 分类规则库 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    type: 'preference',
    keywords: [
      /喜欢|愛|like|love|prefer|enjoy/i,
      /讨厌|討厭|恨|hate|dislike|can't stand/i,
      /想要|需要|want|need|wish|desire/i,
      /不喜欢|不想|don't like|don't want/i,
      /偏好|傾向|preference|favor/i,
    ],
    patterns: [
      /我(喜欢|愛|讨厌|討厭).*/i,
      /我(想要|需要|wish).*/i,
      /我(更|比較)?(喜欢|愛|偏好).*/i,
      /我的(喜好|偏好|兴趣).*/i,
    ],
    priority: 5,
  },
  {
    type: 'decision',
    keywords: [
      /决定|決定|decided|decision/i,
      /选择|選擇|choose|selected|picked/i,
      /使用|採用|use|adopt|implement/i,
      /同意|approve|agreed|consensus/i,
      /计划|計劃|plan|schedule|arrange/i,
    ],
    patterns: [
      /我们?(决定|選擇|同意).*/i,
      /(已经|已)?(确定|決定|选定).*/i,
      /(采用|使用|採用).*(方案|方法|策略)/i,
      /达成(一致|共识|協議).*/i,
    ],
    priority: 4,
  },
  {
    type: 'entity',
    keywords: [
      /电话|電話|手机|mobile|phone/i,
      /邮箱|郵箱|email|e-mail/i,
      /地址|address|location/i,
      /姓名|名字|name|称呼/i,
      /公司|企业|company|organization/i,
      /项目|專案|project|task/i,
    ],
    patterns: [
      /我的?(电话|電話|手机).*/i,
      /我的?(邮箱|郵箱|email).*/i,
      /我的?(地址|位置).*/i,
      /我是|我叫|我的名字是.*/i,
      /我在.*/i,
      // 实体识别模式
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // 邮箱
      /\b1[3-9]\d{9}\b/, // 中国手机号
      /\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}/, // 国际电话
    ],
    priority: 3,
  },
  {
    type: 'fact',
    keywords: [
      /是|are|is|am/i,
      /有|have|has|own|possess/i,
      /在|at|in|located/i,
      /做|work|do|did/i,
      /职位|崗位|职位|title|position/i,
      /负责|負責|responsible|in charge/i,
    ],
    patterns: [
      /我(是|在|有).*/i,
      /我(做|从事|負責).*/i,
      /我的?(职位|崗位|工作).*/i,
      /我(会|能|可以).*/i,
      /我(已经|已).*/i,
    ],
    priority: 2,
  },
  {
    type: 'other',
    keywords: [],
    patterns: [],
    priority: 1, // 最低优先级，作为默认分类
  },
];

/** LLM 分类 Prompt 模板 */
const CLASSIFICATION_PROMPT = `你是一个记忆分类专家。请分析以下内容，判断它属于哪种记忆类型。

## 记忆类型定义
- preference: 用户偏好（喜欢、讨厌、想要、偏好）
- fact: 事实陈述（用户属性、状态、身份）
- decision: 决策记录（达成的决定、选择、计划）
- entity: 实体信息（电话、邮箱、地址、名称）
- other: 其他无法分类的信息

## 待分类内容
{{content}}

{{#if context}}
## 上下文
{{context}}
{{/if}}

## 输出要求
只输出一个 JSON 对象，格式如下：
{"type": "<类型>", "confidence": <0.0-1.0>}`;

/**
 * 使用 LLM 辅助分类
 * @param content 记忆内容
 * @param options 分类选项
 * @returns 分类结果
 */
async function classifyWithLLM(
  content: string,
  options: ClassifyOptions
): Promise<ClassificationResult> {
  const { llmGateway, context } = options;
  
  if (!llmGateway) {
    return { type: 'other', confidence: 0.5, matchedPatterns: [], source: 'llm' };
  }

  try {
    // 构建 prompt
    let prompt = CLASSIFICATION_PROMPT
      .replace('{{content}}', content.slice(0, 500))
      .replace('{{context}}', context || '');
    
    // 移除未使用的条件块
    if (!context) {
      prompt = prompt.replace(/{{#if context}}[\s\S]*?{{\/if}}/g, '');
    }

    const response = await llmGateway.chat(
      [{ role: 'user', content: prompt }],
      undefined,
      undefined,
      { maxTokens: 100 }
    );

    // 解析 JSON 响应
    const jsonMatch = response.content?.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validTypes: MemoryEntryType[] = ['preference', 'fact', 'decision', 'entity', 'other'];
      if (validTypes.includes(parsed.type)) {
        return {
          type: parsed.type,
          confidence: Math.min(Math.max(parsed.confidence || 0.7, 0), 1),
          matchedPatterns: ['llm:classified'],
          source: 'llm',
        };
      }
    }
  } catch (error) {
    // LLM 分类失败，返回默认值
    log.warn('LLM 分类失败', { error: String(error) });
  }

  return { type: 'other', confidence: 0.5, matchedPatterns: [], source: 'llm' };
}

/**
 * 对记忆内容进行分类
 * @param content 记忆内容
 * @param options 分类选项（可选）
 * @returns 分类结果
 */
export async function classifyMemory(
  content: string,
  options?: ClassifyOptions
): Promise<ClassificationResult> {
  const results: ClassificationResult[] = [];

  for (const rule of CLASSIFICATION_RULES) {
    let matchCount = 0;
    const matchedPatterns: string[] = [];

    // 检查关键词匹配
    for (const keyword of rule.keywords) {
      if (keyword.test(content)) {
        matchCount++;
        matchedPatterns.push(`keyword:${keyword.source}`);
      }
    }

    // 检查模式匹配
    for (const pattern of rule.patterns) {
      if (pattern.test(content)) {
        matchCount++;
        matchedPatterns.push(`pattern:${pattern.source}`);
      }
    }

    if (matchCount > 0) {
      // 计算置信度：基于匹配数和优先级
      const baseConfidence = Math.min(matchCount * 0.3, 0.9);
      const priorityBonus = (rule.priority - 1) * 0.02;
      const confidence = Math.min(baseConfidence + priorityBonus, 1.0);

      results.push({
        type: rule.type,
        confidence,
        matchedPatterns: matchedPatterns.slice(0, 3), // 最多记录3个匹配模式
        source: 'rule' as const,
      });
    }
  }

  // 按置信度排序
  if (results.length > 0) {
    results.sort((a, b) => b.confidence - a.confidence);
    const topResult = results[0];
    
    // 如果置信度低于阈值且启用了 LLM 辅助，则调用 LLM
    const threshold = options?.llmThreshold ?? 0.5;
    if (topResult.confidence < threshold && options?.useLLM && options.llmGateway) {
      const llmResult = await classifyWithLLM(content, options);
      // LLM 结果置信度更高时使用 LLM 结果
      if (llmResult.confidence > topResult.confidence) {
        return llmResult;
      }
    }
    
    return topResult;
  }

  // 规则分类无结果，尝试 LLM 分类
  if (options?.useLLM && options.llmGateway) {
    return await classifyWithLLM(content, options);
  }

  // 默认返回 other 类型
  return {
    type: 'other',
    confidence: 0.5,
    matchedPatterns: [],
    source: 'rule',
  };
}

/**
 * 批量分类记忆
 * @param contents 记忆内容列表
 * @param options 分类选项（可选）
 * @returns 分类结果列表
 */
export async function classifyMemoriesBatch(
  contents: string[],
  options?: ClassifyOptions
): Promise<ClassificationResult[]> {
  return Promise.all(contents.map(content => classifyMemory(content, options)));
}

/**
 * 获取分类说明
 * @param type 记忆类型
 * @returns 分类说明
 */
export function getMemoryTypeDescription(type: MemoryEntryType): string {
  const descriptions: Record<MemoryEntryType, string> = {
    conversation: '对话记录',
    summary: '会话摘要',
    preference: '用户偏好',
    fact: '事实陈述',
    decision: '决策记录',
    entity: '实体信息',
    document: '文档内容',
    other: '其他信息',
  };
  return descriptions[type] || '未知类型';
}

/**
 * 获取分类图标
 * @param type 记忆类型
 * @returns 图标字符串
 */
export function getMemoryTypeIcon(type: MemoryEntryType): string {
  const icons: Record<MemoryEntryType, string> = {
    conversation: '💬',
    summary: '📝',
    preference: '❤️',
    fact: '📋',
    decision: '✅',
    entity: '👤',
    document: '📄',
    other: '📦',
  };
  return icons[type] || '📄';
}
