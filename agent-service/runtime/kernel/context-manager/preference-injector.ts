/**
 * 偏好注入器
 *
 * 在对话开始时检索用户偏好并注入上下文。
 * 支持 Token 预算控制和按类型过滤偏好。
 */

import { z } from 'zod';
import { getLogger } from '@logtape/logtape';
import type { LLMMessage } from '../../../types/message';
import type { TokenBudget } from './token-budget';
import type { PreferenceType } from '../../../types/preference';
import { getTokenEstimator } from './token-estimator';

const log = getLogger(['kernel', 'preference-injector']);

/** 偏好注入配置 */
export const PreferenceInjectorConfigSchema = z.object({
  /** 是否启用偏好注入 */
  enabled: z.boolean().default(true),
  /** 偏好 Token 预算上限 */
  maxTokens: z.number().min(0).default(500),
  /** 单个偏好最大 Token 数 */
  maxTokensPerPreference: z.number().min(10).default(100),
  /** 最大注入偏好数量 */
  maxPreferences: z.number().min(1).default(10),
  /** 包含的偏好类型（空则包含所有） */
  includedTypes: z.array(z.enum(['like', 'dislike', 'want', 'avoid', 'habit', 'style'])).optional(),
  /** 排除的偏好类型 */
  excludedTypes: z.array(z.enum(['like', 'dislike', 'want', 'avoid', 'habit', 'style'])).optional(),
  /** 最小置信度阈值 */
  minConfidence: z.number().min(0).max(1).default(0.7),
  /** 是否包含元数据 */
  includeMetadata: z.boolean().default(false),
  /** 偏好模板格式 */
  template: z.string().optional(),
});

export type PreferenceInjectorConfig = z.infer<typeof PreferenceInjectorConfigSchema>;

/** 偏好记录（简化版，用于注入） */
export interface PreferenceForInjection {
  /** 偏好 ID */
  id: string;
  /** 偏好类型 */
  type: PreferenceType;
  /** 偏好主题 */
  subject: string;
  /** 偏好内容 */
  content: string;
  /** 置信度 */
  confidence: number;
}

/** 注入结果 */
export interface InjectionResult {
  /** 注入的系统消息 */
  systemMessage: LLMMessage | null;
  /** 注入的偏好数量 */
  injectedCount: number;
  /** 使用的 Token 数量 */
  tokensUsed: number;
  /** 过滤掉的偏好数量 */
  filteredCount: number;
  /** 过滤原因 */
  filterReasons: string[];
}

/** 默认偏好模板 */
const DEFAULT_TEMPLATE = `## 用户偏好信息

以下是用户已知的偏好和习惯，请在回复中适当参考：

{preferences}

请根据上述偏好调整你的回复风格和内容。`;

/** 偏好项模板 */
const PREFERENCE_ITEM_TEMPLATE = '- {type}: {content}';

/** 偏好类型标签 */
const TYPE_LABELS: Record<PreferenceType, string> = {
  like: '喜欢',
  dislike: '不喜欢',
  want: '想要',
  avoid: '避免',
  habit: '习惯',
  style: '风格偏好',
};

/**
 * 偏好注入器
 *
 * 职责：
 * - 检索用户偏好
 * - 按 Token 预算控制注入量
 * - 按类型过滤偏好
 * - 格式化为系统消息
 */
export class PreferenceInjector {
  private config: PreferenceInjectorConfig;
  private preferenceProvider?: () => Promise<PreferenceForInjection[]>;

  constructor(config?: Partial<PreferenceInjectorConfig>) {
    this.config = PreferenceInjectorConfigSchema.parse(config ?? {});
  }

  /**
   * 设置偏好提供者
   *
   * @param provider - 偏好提供函数
   */
  setPreferenceProvider(provider: () => Promise<PreferenceForInjection[]>): void {
    this.preferenceProvider = provider;
  }

  /**
   * 注入偏好到消息上下文
   *
   * @param _messages - 现有消息列表
   * @param tokenBudget - Token 预算
   * @returns 注入结果
   */
  async inject(
    _messages: LLMMessage[],
    tokenBudget?: TokenBudget
  ): Promise<InjectionResult> {
    if (!this.config.enabled) {
      return {
        systemMessage: null,
        injectedCount: 0,
        tokensUsed: 0,
        filteredCount: 0,
        filterReasons: ['偏好注入已禁用'],
      };
    }

    // 获取偏好
    const preferences = await this.fetchPreferences();
    if (preferences.length === 0) {
      return {
        systemMessage: null,
        injectedCount: 0,
        tokensUsed: 0,
        filteredCount: 0,
        filterReasons: ['无可用偏好'],
      };
    }

    // 过滤偏好
    const { filtered, filteredCount, filterReasons } = this.filterPreferences(preferences);

    // 按 Token 预算选择偏好
    const selected = this.selectByBudget(filtered, tokenBudget);

    if (selected.length === 0) {
      return {
        systemMessage: null,
        injectedCount: 0,
        tokensUsed: 0,
        filteredCount,
        filterReasons: [...filterReasons, '无符合预算的偏好'],
      };
    }

    // 构建系统消息
    const systemMessage = this.buildSystemMessage(selected);
    const tokensUsed = this.estimateTokens(systemMessage.content as string);

    log.debug('偏好注入完成', {
      injectedCount: selected.length,
      tokensUsed,
      filteredCount,
    });

    return {
      systemMessage,
      injectedCount: selected.length,
      tokensUsed,
      filteredCount,
      filterReasons,
    };
  }

  /**
   * 构建包含偏好的系统提示
   *
   * @param preferences - 偏好列表
   * @returns 系统消息
   */
  buildSystemPrompt(preferences: PreferenceForInjection[]): string {
    if (preferences.length === 0) {
      return '';
    }

    const preferenceLines = preferences.map(p => {
      const typeLabel = TYPE_LABELS[p.type] ?? p.type;
      return PREFERENCE_ITEM_TEMPLATE
        .replace('{type}', typeLabel)
        .replace('{content}', p.content || p.subject);
    });

    const template = this.config.template ?? DEFAULT_TEMPLATE;
    return template.replace('{preferences}', preferenceLines.join('\n'));
  }

  /**
   * 获取配置
   */
  getConfig(): PreferenceInjectorConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PreferenceInjectorConfig>): void {
    this.config = PreferenceInjectorConfigSchema.parse({
      ...this.config,
      ...config,
    });
  }

  // ========== 私有方法 ==========

  /**
   * 获取偏好列表
   */
  private async fetchPreferences(): Promise<PreferenceForInjection[]> {
    if (!this.preferenceProvider) {
      log.warn('偏好提供者未设置');
      return [];
    }

    try {
      return await this.preferenceProvider();
    } catch (error) {
      log.error('获取偏好失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 过滤偏好
   */
  private filterPreferences(preferences: PreferenceForInjection[]): {
    filtered: PreferenceForInjection[];
    filteredCount: number;
    filterReasons: string[];
  } {
    const filterReasons: string[] = [];
    let filtered = [...preferences];
    let filteredCount = 0;

    // 置信度过滤
    const beforeConfidence = filtered.length;
    filtered = filtered.filter(p => p.confidence >= this.config.minConfidence);
    const afterConfidence = filtered.length;
    if (beforeConfidence > afterConfidence) {
      filteredCount += beforeConfidence - afterConfidence;
      filterReasons.push(`置信度过滤: ${beforeConfidence - afterConfidence} 条`);
    }

    // 类型过滤 - 包含
    if (this.config.includedTypes && this.config.includedTypes.length > 0) {
      const before = filtered.length;
      filtered = filtered.filter(p => this.config.includedTypes!.includes(p.type));
      const after = filtered.length;
      if (before > after) {
        filteredCount += before - after;
        filterReasons.push(`类型包含过滤: ${before - after} 条`);
      }
    }

    // 类型过滤 - 排除
    if (this.config.excludedTypes && this.config.excludedTypes.length > 0) {
      const before = filtered.length;
      filtered = filtered.filter(p => !this.config.excludedTypes!.includes(p.type));
      const after = filtered.length;
      if (before > after) {
        filteredCount += before - after;
        filterReasons.push(`类型排除过滤: ${before - after} 条`);
      }
    }

    // 数量限制
    if (filtered.length > this.config.maxPreferences) {
      filteredCount += filtered.length - this.config.maxPreferences;
      filterReasons.push(`数量限制: ${filtered.length - this.config.maxPreferences} 条`);
      filtered = filtered.slice(0, this.config.maxPreferences);
    }

    return { filtered, filteredCount, filterReasons };
  }

  /**
   * 按 Token 预算选择偏好
   */
  private selectByBudget(
    preferences: PreferenceForInjection[],
    tokenBudget?: TokenBudget
  ): PreferenceForInjection[] {
    const maxBudget = tokenBudget
      ? Math.min(this.config.maxTokens, tokenBudget.getRemaining())
      : this.config.maxTokens;

    const selected: PreferenceForInjection[] = [];
    let usedTokens = 0;

    // 按置信度排序
    const sorted = [...preferences].sort((a, b) => b.confidence - a.confidence);

    for (const pref of sorted) {
      const prefTokens = this.estimatePreferenceTokens(pref);

      // 检查单条偏好限制
      if (prefTokens > this.config.maxTokensPerPreference) {
        continue;
      }

      // 检查总预算
      if (usedTokens + prefTokens <= maxBudget) {
        selected.push(pref);
        usedTokens += prefTokens;
      }

      // 达到最大数量
      if (selected.length >= this.config.maxPreferences) {
        break;
      }
    }

    return selected;
  }

  /**
   * 构建系统消息
   */
  private buildSystemMessage(preferences: PreferenceForInjection[]): LLMMessage {
    const content = this.buildSystemPrompt(preferences);

    return {
      role: 'system',
      content,
    };
  }

  /**
   * 估算 Token 数量
   *
   * 使用统一的 TokenEstimator 进行估算，支持中英文智能检测。
   */
  private estimateTokens(text: string): number {
    return getTokenEstimator().estimateText(text);
  }

  /**
   * 估算单个偏好的 Token 数量
   */
  private estimatePreferenceTokens(pref: PreferenceForInjection): number {
    const text = `${TYPE_LABELS[pref.type]}: ${pref.content || pref.subject}`;
    return this.estimateTokens(text) + 10; // 加上格式化开销
  }
}

// ========== 导出便捷函数 ==========

/**
 * 格式化偏好为可读文本
 */
export function formatPreferences(preferences: PreferenceForInjection[]): string {
  return preferences
    .map(p => `- ${TYPE_LABELS[p.type]}: ${p.content || p.subject}`)
    .join('\n');
}

/**
 * 合并偏好到现有系统提示
 */
export function mergeWithSystemPrompt(
  existingPrompt: string,
  preferences: PreferenceForInjection[]
): string {
  if (preferences.length === 0) {
    return existingPrompt;
  }

  const preferenceSection = `\n\n## 用户偏好\n\n${formatPreferences(preferences)}\n`;
  return existingPrompt + preferenceSection;
}
