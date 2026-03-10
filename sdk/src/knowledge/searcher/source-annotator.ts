/**
 * 来源标注器
 *
 * 高级封装：为检索结果标注来源文档和位置信息。
 */

import { getLogger } from '@logtape/logtape';
import type { KnowledgeDocument, KnowledgeChunk } from '../types';

const log = getLogger(['sdk', 'knowledge', 'annotator']);

/** 标注结果 */
export interface AnnotatedResult {
  /** 分块 ID */
  chunkId: string;
  /** 文档 ID */
  docId: string;
  /** 文档路径 */
  docPath: string;
  /** 文档标题 */
  docTitle: string;
  /** 文档类型 */
  docType: string;
  /** 分块索引 */
  chunkIndex: number;
  /** 总分块数 */
  totalChunks: number;
  /** 起始位置 */
  startPos: number;
  /** 结束位置 */
  endPos: number;
  /** 上下文片段 */
  context: {
    /** 前文 */
    before: string;
    /** 当前内容 */
    current: string;
    /** 后文 */
    after: string;
  };
  /** 行号信息 */
  lineInfo?: {
    /** 起始行 */
    startLine: number;
    /** 结束行 */
    endLine: number;
  };
  /** 章节信息 */
  section?: string;
  /** 格式化的来源引用 */
  citation: string;
}

/** 标注器配置 */
export interface SourceAnnotatorConfig {
  /** 上下文长度（字符数） */
  contextLength: number;
  /** 是否包含行号 */
  includeLineNumbers: boolean;
  /** 引用格式 */
  citationFormat: 'full' | 'short' | 'minimal';
}

/** 默认配置 */
const DEFAULT_CONFIG: SourceAnnotatorConfig = {
  contextLength: 100,
  includeLineNumbers: true,
  citationFormat: 'full',
};

/**
 * 来源标注器
 *
 * 功能：
 * - 标注文档路径和位置
 * - 提供上下文片段
 * - 生成格式化引用
 */
export class SourceAnnotator {
  private config: SourceAnnotatorConfig;

  constructor(config?: Partial<SourceAnnotatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 标注检索结果
   * @param chunkId - 分块 ID
   * @param docId - 文档 ID
   * @param content - 分块内容
   * @param documents - 文档映射
   * @returns 标注结果
   */
  annotate(
    chunkId: string,
    docId: string,
    content: string,
    documents: Map<string, KnowledgeDocument>
  ): AnnotatedResult {
    const doc = documents.get(docId);

    // 基础信息
    const result: AnnotatedResult = {
      chunkId,
      docId,
      docPath: doc?.path ?? '',
      docTitle: doc?.metadata.title ?? doc?.metadata.originalName ?? '',
      docType: doc?.metadata.fileType ?? 'text',
      chunkIndex: 0,
      totalChunks: doc?.chunks?.length ?? 1,
      startPos: 0,
      endPos: content.length,
      context: {
        before: '',
        current: content,
        after: '',
      },
      citation: '',
    };

    // 查找分块详细信息
    if (doc?.chunks) {
      const chunkIndex = doc.chunks.findIndex(c => c.id === chunkId);
      if (chunkIndex >= 0) {
        const chunk = doc.chunks[chunkIndex];
        result.chunkIndex = chunkIndex;
        result.startPos = chunk.startPos;
        result.endPos = chunk.endPos;

        // 提取上下文
        result.context = this.extractContext(doc.content, chunk, doc.chunks, chunkIndex);

        // 行号信息
        if (chunk.metadata?.lineStart !== undefined) {
          result.lineInfo = {
            startLine: chunk.metadata.lineStart,
            endLine: chunk.metadata.lineEnd ?? chunk.metadata.lineStart,
          };
        }

        // 章节信息
        result.section = chunk.metadata?.section;
      }
    }

    // 生成引用
    result.citation = this.generateCitation(result);

    return result;
  }

  /**
   * 批量标注
   * @param results - 检索结果数组
   * @param documents - 文档映射
   * @returns 标注后的结果
   */
  annotateBatch(
    results: Array<{ chunkId: string; docId: string; content: string }>,
    documents: Map<string, KnowledgeDocument>
  ): AnnotatedResult[] {
    return results.map(r => this.annotate(r.chunkId, r.docId, r.content, documents));
  }

  /**
   * 提取上下文
   */
  private extractContext(
    docContent: string,
    chunk: KnowledgeChunk,
    allChunks: KnowledgeChunk[],
    chunkIndex: number
  ): AnnotatedResult['context'] {
    const contextLength = this.config.contextLength;

    // 当前内容
    const current = chunk.content;

    // 前文
    let before = '';
    if (chunkIndex > 0) {
      const prevChunk = allChunks[chunkIndex - 1];
      before = prevChunk.content.slice(-contextLength);
    } else if (chunk.startPos > 0) {
      before = docContent.slice(
        Math.max(0, chunk.startPos - contextLength),
        chunk.startPos
      );
    }

    // 后文
    let after = '';
    if (chunkIndex < allChunks.length - 1) {
      const nextChunk = allChunks[chunkIndex + 1];
      after = nextChunk.content.slice(0, contextLength);
    } else if (chunk.endPos < docContent.length) {
      after = docContent.slice(chunk.endPos, Math.min(docContent.length, chunk.endPos + contextLength));
    }

    return {
      before: before.trim(),
      current: current.trim(),
      after: after.trim(),
    };
  }

  /**
   * 生成引用
   */
  private generateCitation(result: AnnotatedResult): string {
    const format = this.config.citationFormat;

    switch (format) {
      case 'minimal':
        return result.docTitle;

      case 'short':
        return `${result.docTitle} [${result.chunkIndex + 1}/${result.totalChunks}]`;

      case 'full':
      default:
        const parts: string[] = [result.docTitle];

        if (result.lineInfo) {
          if (result.lineInfo.startLine === result.lineInfo.endLine) {
            parts.push(`行 ${result.lineInfo.startLine}`);
          } else {
            parts.push(`行 ${result.lineInfo.startLine}-${result.lineInfo.endLine}`);
          }
        }

        parts.push(`分块 ${result.chunkIndex + 1}/${result.totalChunks}`);

        if (result.section) {
          parts.push(`章节: ${result.section}`);
        }

        return parts.join(' | ');
    }
  }

  /**
   * 格式化为 Markdown 引用
   */
  formatAsMarkdown(result: AnnotatedResult): string {
    const lines: string[] = [];

    lines.push(`> **来源**: ${result.citation}`);
    lines.push(`> **类型**: ${result.docType}`);

    if (result.lineInfo) {
      lines.push(`> **位置**: 行 ${result.lineInfo.startLine}-${result.lineInfo.endLine}`);
    }

    lines.push('');
    lines.push('**上下文**:')
    lines.push('');

    if (result.context.before) {
      lines.push(`...${result.context.before}`);
    }

    lines.push(`**${result.context.current}**`);

    if (result.context.after) {
      lines.push(`${result.context.after}...`);
    }

    return lines.join('\n');
  }

  /**
   * 格式化为简短引用
   */
  formatAsShort(result: AnnotatedResult): string {
    const title = result.docTitle.length > 30
      ? result.docTitle.slice(0, 27) + '...'
      : result.docTitle;

    if (result.lineInfo) {
      return `📁 ${title}:${result.lineInfo.startLine}`;
    }

    return `📁 ${title} [${result.chunkIndex + 1}]`;
  }

  /**
   * 获取文档摘要信息
   */
  getDocumentSummary(docId: string, documents: Map<string, KnowledgeDocument>): {
    title: string;
    type: string;
    chunkCount: number;
    size: string;
  } | null {
    const doc = documents.get(docId);
    if (!doc) return null;

    const sizeKB = (doc.metadata.fileSize / 1024).toFixed(1);

    return {
      title: doc.metadata.title ?? doc.metadata.originalName,
      type: doc.metadata.fileType,
      chunkCount: doc.chunks?.length ?? 0,
      size: `${sizeKB} KB`,
    };
  }
}

/**
 * 创建来源标注器
 */
export function createSourceAnnotator(
  config?: Partial<SourceAnnotatorConfig>
): SourceAnnotator {
  return new SourceAnnotator(config);
}
