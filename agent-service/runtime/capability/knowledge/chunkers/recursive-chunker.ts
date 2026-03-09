/**
 * 递归字符分块器
 *
 * 实现递归字符分块策略，按照分隔符优先级进行分块。
 */

import { z } from 'zod';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['knowledge', 'chunkers', 'recursive']);

/** 分块器配置 Schema */
export const RecursiveChunkerConfigSchema = z.object({
  /** 分块大小（字符数） */
  chunkSize: z.number().min(100).max(8000).default(1500),
  /** 分块重叠（字符数） */
  chunkOverlap: z.number().min(0).max(1000).default(150),
  /** 自定义分隔符（按优先级排序） */
  separators: z.array(z.string()).optional(),
  /** 是否保留分隔符 */
  keepSeparator: z.boolean().default(true),
  /** 长度计算函数 */
  lengthFunction: z.function().optional(),
});

/** 分块器配置类型 */
export type RecursiveChunkerConfig = z.infer<typeof RecursiveChunkerConfigSchema>;

/** 分块结果 */
export interface ChunkResult {
  /** 分块内容 */
  content: string;
  /** 在原文中的起始位置 */
  startPos: number;
  /** 在原文中的结束位置 */
  endPos: number;
  /** 分块索引 */
  index: number;
  /** 元数据 */
  metadata?: {
    lineStart?: number;
    lineEnd?: number;
    section?: string;
    separator?: string;
  };
}

/** 默认分隔符（按优先级排序） */
const DEFAULT_SEPARATORS = [
  '\n\n\n', // 段落分隔
  '\n\n',   // 双换行
  '\n',     // 单换行
  '。',     // 中文句号
  '！',     // 中文感叹号
  '？',     // 中文问号
  '.',      // 英文句号
  '!',      // 英文感叹号
  '?',      // 英文问号
  '；',     // 中文分号
  ';',      // 英文分号
  '，',     // 中文逗号
  ',',      // 英文逗号
  ' ',      // 空格
  '',       // 字符级别（最后手段）
];

/**
 * 递归字符分块器
 *
 * 按照分隔符优先级递归分割文本，直到每个块大小符合要求。
 * 特点：
 * - 优先在自然边界（段落、句子）处分割
 * - 支持自定义分隔符优先级
 * - 支持分块重叠以保持上下文连贯性
 */
export class RecursiveChunker {
  private config: Required<
    Pick<RecursiveChunkerConfig, 'chunkSize' | 'chunkOverlap' | 'separators' | 'keepSeparator'>
  >;

  constructor(config?: Partial<RecursiveChunkerConfig>) {
    const parsed = RecursiveChunkerConfigSchema.parse(config ?? {});
    this.config = {
      chunkSize: parsed.chunkSize,
      chunkOverlap: parsed.chunkOverlap,
      separators: parsed.separators ?? DEFAULT_SEPARATORS,
      keepSeparator: parsed.keepSeparator,
    };

    // 验证重叠不超过分块大小
    if (this.config.chunkOverlap >= this.config.chunkSize) {
      log.warn('分块重叠不应大于等于分块大小，已自动调整');
      this.config.chunkOverlap = Math.floor(this.config.chunkSize / 4);
    }
  }

  /**
   * 分块文本
   * @param text - 待分块的文本
   * @returns 分块结果数组
   */
  chunk(text: string): ChunkResult[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // 文本长度小于分块大小，直接返回
    if (text.length <= this.config.chunkSize) {
      return [{
        content: text,
        startPos: 0,
        endPos: text.length,
        index: 0,
        metadata: this.extractMetadata(text, 0),
      }];
    }

    // 递归分块
    const chunks = this.recursiveSplit(text, this.config.separators);

    // 计算位置和索引
    let currentPos = 0;
    const results: ChunkResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 查找实际位置
      const startPos = text.indexOf(chunk, Math.max(0, currentPos - this.config.chunkOverlap));
      const actualStartPos = startPos >= 0 ? startPos : currentPos;

      results.push({
        content: chunk,
        startPos: actualStartPos,
        endPos: actualStartPos + chunk.length,
        index: i,
        metadata: this.extractMetadata(chunk, actualStartPos),
      });

      currentPos = actualStartPos + chunk.length;
    }

    log.debug('文本分块完成', {
      totalLength: text.length,
      chunkCount: results.length,
      avgChunkSize: Math.round(text.length / results.length),
    });

    return results;
  }

  /**
   * 递归分割文本
   */
  private recursiveSplit(
    text: string,
    separators: string[]
  ): string[] {
    if (text.length <= this.config.chunkSize) {
      return [text];
    }

    // 找到有效的分隔符
    let separator = '';
    let newSeparators: string[] = [];

    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i];
      if (sep === '' || text.includes(sep)) {
        separator = sep;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    // 如果没有找到分隔符，按字符分割
    if (!separator && separators[separators.length - 1] !== '') {
      return this.splitByChars(text);
    }

    // 按分隔符分割
    const splits = this.splitBySeparator(text, separator);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const split of splits) {
      const splitWithSep = this.config.keepSeparator && separator
        ? split + separator
        : split;

      // 如果单个分割已经超过大小限制，递归处理
      if (splitWithSep.length > this.config.chunkSize) {
        // 先保存当前块
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = '';
        }

        // 递归处理大块
        if (newSeparators.length > 0) {
          const subChunks = this.recursiveSplit(splitWithSep, newSeparators);
          chunks.push(...subChunks);
        } else {
          // 无法继续分割，强制分割
          const forcedChunks = this.splitByChars(splitWithSep);
          chunks.push(...forcedChunks);
        }
        continue;
      }

      // 检查是否可以加入当前块
      if (currentChunk.length + splitWithSep.length <= this.config.chunkSize) {
        currentChunk += splitWithSep;
      } else {
        // 保存当前块
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
        }
        // 开始新块（带重叠）
        currentChunk = this.getOverlapText(currentChunk) + splitWithSep;
      }
    }

    // 保存最后一个块
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * 按分隔符分割文本
   */
  private splitBySeparator(text: string, separator: string): string[] {
    if (!separator) {
      return text.split('');
    }

    // 使用正则分割，保留分隔符
    if (this.config.keepSeparator) {
      const escaped = this.escapeRegex(separator);
      const parts = text.split(new RegExp(`(${escaped})`));
      const result: string[] = [];

      for (let i = 0; i < parts.length; i += 2) {
        const content = parts[i] ?? '';
        const sep = parts[i + 1] ?? '';
        result.push(content + sep);
      }

      return result.filter(s => s.length > 0);
    }

    return text.split(separator).filter(s => s.length > 0);
  }

  /**
   * 按字符分割
   */
  private splitByChars(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + this.config.chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start = end - this.config.chunkOverlap;

      if (start >= text.length - this.config.chunkOverlap) {
        break;
      }
    }

    return chunks;
  }

  /**
   * 获取重叠文本
   */
  private getOverlapText(text: string): string {
    if (!text || this.config.chunkOverlap === 0) {
      return '';
    }

    const overlap = text.slice(-this.config.chunkOverlap);

    // 尝试在完整词边界处截断
    const spaceIndex = overlap.indexOf(' ');
    if (spaceIndex > 0 && spaceIndex < overlap.length - 1) {
      return overlap.slice(spaceIndex + 1);
    }

    return overlap;
  }

  /**
   * 提取元数据
   */
  private extractMetadata(text: string, startPos: number): ChunkResult['metadata'] {
    const lines = text.split('\n');
    const lineStart = this.countLinesBefore(text, startPos);

    return {
      lineStart,
      lineEnd: lineStart + lines.length - 1,
    };
  }

  /**
   * 计算位置前的行数
   */
  private countLinesBefore(fullText: string, pos: number): number {
    const beforeText = fullText.slice(0, pos);
    return beforeText.split('\n').length;
  }

  /**
   * 转义正则特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * 创建递归分块器
 */
export function createRecursiveChunker(
  config?: Partial<RecursiveChunkerConfig>
): RecursiveChunker {
  return new RecursiveChunker(config);
}

/**
 * 默认分块器实例（chunk_size=1500, overlap=150）
 */
export const defaultChunker = new RecursiveChunker({
  chunkSize: 1500,
  chunkOverlap: 150,
});
