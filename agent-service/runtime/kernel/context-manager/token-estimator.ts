/**
 * Token 估算器
 *
 * 提供统一的 Token 估算逻辑，支持可配置的估算策略。
 * 
 * 设计说明：
 * - 使用字符比例估算，不引入 tiktoken 等重量级依赖
 * - 支持中英文混合文本的智能估算
 * - 配置化设计，允许用户根据实际模型调整参数
 * - 这是估算值，精度有限，但足以用于上下文预算管理
 */

import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'token-estimator']);

/** Token 估算配置 */
export interface TokenEstimatorConfig {
  /**
   * 每个 Token 对应的英文字符数
   * 
   * 经验值：
   * - GPT 系列：约 4 字符/token（英文）
   * - Claude 系列：约 3.5 字符/token（英文）
   * 
   * 默认值：4（GPT 系列常用）
   */
  charsPerTokenEn: number;

  /**
   * 每个 Token 对应的中文字符数
   * 
   * 经验值：
   * - GPT 系列：约 1.5 字符/token（中文）
   * - Claude 系列：约 2 字符/token（中文）
   * 
   * 默认值：1.5（GPT 系列常用）
   */
  charsPerTokenCn: number;

  /**
   * 是否启用中英文智能检测
   * 
   * 启用后会检测文本中的中英文字符比例，
   * 使用加权平均计算 token 数量。
   * 
   * 默认值：true
   */
  enableLanguageDetection: boolean;

  /**
   * 消息格式化开销（Token）
   * 
   * 包含 role、字段名等 JSON 结构开销。
   * 
   * 默认值：4
   */
  messageOverhead: number;
}

/** 默认配置 */
export const DEFAULT_TOKEN_ESTIMATOR_CONFIG: TokenEstimatorConfig = {
  charsPerTokenEn: 4,
  charsPerTokenCn: 1.5,
  enableLanguageDetection: true,
  messageOverhead: 4,
};

/** 配置验证 Schema */
export const TokenEstimatorConfigSchema = {
  validate(config: unknown): TokenEstimatorConfig {
    if (typeof config !== 'object' || config === null) {
      return { ...DEFAULT_TOKEN_ESTIMATOR_CONFIG };
    }

    const c = config as Record<string, unknown>;
    return {
      charsPerTokenEn: typeof c.charsPerTokenEn === 'number' && c.charsPerTokenEn > 0
        ? c.charsPerTokenEn
        : DEFAULT_TOKEN_ESTIMATOR_CONFIG.charsPerTokenEn,
      charsPerTokenCn: typeof c.charsPerTokenCn === 'number' && c.charsPerTokenCn > 0
        ? c.charsPerTokenCn
        : DEFAULT_TOKEN_ESTIMATOR_CONFIG.charsPerTokenCn,
      enableLanguageDetection: typeof c.enableLanguageDetection === 'boolean'
        ? c.enableLanguageDetection
        : DEFAULT_TOKEN_ESTIMATOR_CONFIG.enableLanguageDetection,
      messageOverhead: typeof c.messageOverhead === 'number' && c.messageOverhead >= 0
        ? c.messageOverhead
        : DEFAULT_TOKEN_ESTIMATOR_CONFIG.messageOverhead,
    };
  },
};

/**
 * Token 估算器
 *
 * 提供统一的 Token 估算功能。
 */
export class TokenEstimator {
  private config: TokenEstimatorConfig;

  constructor(config?: Partial<TokenEstimatorConfig>) {
    this.config = TokenEstimatorConfigSchema.validate(config);
    log.debug('[TokenEstimator] 初始化', { config: this.config });
  }

  /**
   * 获取当前配置
   */
  getConfig(): TokenEstimatorConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TokenEstimatorConfig>): void {
    this.config = TokenEstimatorConfigSchema.validate({
      ...this.config,
      ...config,
    });
    log.debug('[TokenEstimator] 配置已更新', { config: this.config });
  }

  /**
   * 估算文本的 Token 数量
   *
   * @param text - 要估算的文本
   * @returns 估算的 Token 数量
   */
  estimateText(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    if (this.config.enableLanguageDetection) {
      return this.estimateWithLanguageDetection(text);
    }

    // 简单模式：使用英文字符比例
    return Math.ceil(text.length / this.config.charsPerTokenEn);
  }

  /**
   * 估算消息的 Token 数量
   *
   * @param message - LLM 消息
   * @returns 估算的 Token 数量（包含消息格式化开销）
   */
  estimateMessage(message: { content: string | unknown; role?: string }): number {
    let content: string;

    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      // 多模态内容：提取文本部分
      const textParts = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text);
      content = textParts.join('\n');
    } else {
      content = JSON.stringify(message.content);
    }

    return this.estimateText(content) + this.config.messageOverhead;
  }

  /**
   * 批量估算消息的 Token 数量
   *
   * @param messages - LLM 消息列表
   * @returns 总 Token 数量
   */
  estimateMessages(messages: Array<{ content: string | unknown; role?: string }>): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessage(msg), 0);
  }

  // ========== 私有方法 ==========

  /**
   * 使用语言检测估算 Token
   */
  private estimateWithLanguageDetection(text: string): number {
    const { cnCount, enCount, otherCount } = this.countCharacters(text);
    const total = cnCount + enCount + otherCount;

    if (total === 0) {
      return 0;
    }

    // 计算中英文比例
    const cnRatio = cnCount / total;
    const enRatio = (enCount + otherCount) / total;

    // 加权计算 token 数量
    // 中文部分使用中文比例，其他部分使用英文比例
    const cnTokens = cnCount / this.config.charsPerTokenCn;
    const enTokens = (enCount + otherCount) / this.config.charsPerTokenEn;

    const estimated = Math.ceil(cnTokens * cnRatio + enTokens * enRatio);

    // 返回至少 1 个 token
    return Math.max(1, estimated);
  }

  /**
   * 统计字符类型
   *
   * @returns 中文字符数、英文字符数、其他字符数
   */
  private countCharacters(text: string): { cnCount: number; enCount: number; otherCount: number } {
    let cnCount = 0;
    let enCount = 0;
    let otherCount = 0;

    for (const char of text) {
      const code = char.codePointAt(0);
      if (code === undefined) continue;

      // CJK 统一汉字范围
      // U+4E00 - U+9FFF: 基本汉字
      // U+3400 - U+4DBF: 扩展 A
      // U+20000 - U+2A6DF: 扩展 B
      // U+2A700 - U+2B73F: 扩展 C
      // U+2B740 - U+2B81F: 扩展 D
      // U+2B820 - U+2CEAF: 扩展 E
      // U+F900 - U+FAFF: 兼容汉字
      if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x20000 && code <= 0x2a6df) ||
        (code >= 0x2a700 && code <= 0x2b73f) ||
        (code >= 0x2b740 && code <= 0x2b81f) ||
        (code >= 0x2b820 && code <= 0x2ceaf) ||
        (code >= 0xf900 && code <= 0xfaff)
      ) {
        cnCount++;
      }
      // 英文字母和数字
      else if (
        (code >= 0x41 && code <= 0x5a) || // A-Z
        (code >= 0x61 && code <= 0x7a) || // a-z
        (code >= 0x30 && code <= 0x39)    // 0-9
      ) {
        enCount++;
      }
      // 其他字符（标点、空格、特殊符号等）
      else if (!this.isWhitespace(char)) {
        otherCount++;
      }
    }

    return { cnCount, enCount, otherCount };
  }

  /**
   * 判断是否为空白字符
   */
  private isWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
  }
}

// ========== 全局默认实例 ==========

/** 默认 Token 估算器实例 */
let defaultEstimator: TokenEstimator | null = null;

/**
 * 获取默认 Token 估算器实例
 */
export function getTokenEstimator(): TokenEstimator {
  if (!defaultEstimator) {
    defaultEstimator = new TokenEstimator();
  }
  return defaultEstimator;
}

/**
 * 配置默认 Token 估算器
 */
export function configureTokenEstimator(config: Partial<TokenEstimatorConfig>): void {
  if (defaultEstimator) {
    defaultEstimator.updateConfig(config);
  } else {
    defaultEstimator = new TokenEstimator(config);
  }
}

/**
 * 重置默认 Token 估算器
 *
 * 主要用于测试场景
 */
export function resetTokenEstimator(): void {
  defaultEstimator = null;
}
