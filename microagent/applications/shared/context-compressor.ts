/**
 * 上下文压缩器
 *
 * 实现三种压缩策略：
 * - sliding-window: 滑动窗口，丢弃旧消息
 * - summarization: 摘要压缩，用 LLM 压缩旧消息
 * - hybrid: 混合策略，摘要旧消息 + 保留最近消息
 */

import type { Message } from "../../runtime/types.js";
import type { CompressionConfig, CompressionStrategy, SummaryMaxTokens } from "../config/schema.js";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  selectMessagesByTokens,
} from "./token-estimator.js";
import {
  sharedLogger,
  createTimer,
  logMethodCall,
  logMethodReturn,
  logMethodError,
} from "./logger.js";

const logger = sharedLogger();

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 解析 summaryMaxTokens 配置值
 * @param value - 配置值：数字（绝对值）或 "10%"（比例）或 undefined（默认 5%）
 * @param contextWindowTokens - 上下文窗口大小
 * @returns 实际的 token 数量
 */
function parseSummaryMaxTokens(
  value: SummaryMaxTokens | undefined,
  contextWindowTokens: number
): number {
  // 默认值 5%
  if (value === undefined) {
    return Math.floor(contextWindowTokens * 0.05);
  }

  // 百分比格式
  if (typeof value === "string") {
    const percentage = parseFloat(value.slice(0, -1)) / 100;
    return Math.floor(contextWindowTokens * percentage);
  }

  // 绝对数值
  return value;
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 压缩前 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 是否产生了摘要 */
  hasSummary: boolean;
  /** 使用的策略 */
  strategy: CompressionStrategy;
}

/**
 * LLM 调用函数类型
 */
export type LLMCallable = (messages: Message[]) => Promise<string>;

/**
 * 压缩器配置
 */
export interface CompressorOptions {
  /** 上下文窗口大小（tokens） */
  contextWindowTokens: number;
  /** 压缩阈值（0-1） */
  compressionTokenThreshold: number;
  /** 压缩配置 */
  compression?: CompressionConfig;
  /** LLM 调用函数（用于摘要） */
  llmCall?: LLMCallable;
}

/**
 * Running Summary 存储
 */
export interface RunningSummary {
  /** 摘要内容 */
  content: string;
  /** 最后更新的消息索引 */
  lastMessageIndex: number;
  /** token 数量 */
  tokens: number;
}

// ============================================================================
// 摘要提示词模板
// ============================================================================

const SUMMARY_SYSTEM_PROMPT = `你是一个对话摘要专家。你的任务是将对话历史压缩成简洁但完整的摘要。

摘要要求：
1. 保留关键信息：用户目标、重要决策、已完成的任务
2. 保留上下文：用户偏好、项目背景、重要约定
3. 保留未完成事项：待办任务、待回答问题
4. 省略细节：闲聊、重复内容、无关信息
5. 使用简洁的第三人称叙述

输出格式：
- 用项目符号列出要点
- 每个要点不超过一行
- 总字数控制在 200 字以内`;

const SUMMARY_USER_PROMPT = `请总结以下对话内容：

{conversation}

请输出摘要：`;

// ============================================================================
// 压缩器类
// ============================================================================

/**
 * 上下文压缩器
 *
 * 根据配置策略压缩对话历史
 */
export class ContextCompressor {
  private readonly contextWindowTokens: number;
  private readonly compressionTokenThreshold: number;
  private readonly config: CompressionConfig;
  private readonly llmCall?: LLMCallable;
  private runningSummary: RunningSummary | null = null;

  constructor(options: CompressorOptions) {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "ContextCompressor.constructor",
      module: "context-compressor",
      params: {
        contextWindowTokens: options.contextWindowTokens,
        threshold: options.compressionTokenThreshold,
        strategy: options.compression?.strategy,
      },
    });

    this.contextWindowTokens = options.contextWindowTokens;
    this.compressionTokenThreshold = options.compressionTokenThreshold;

    // 解析 summaryMaxTokens（支持数字和百分比格式）
    const summaryMaxTokens = parseSummaryMaxTokens(
      options.compression?.summaryMaxTokens,
      this.contextWindowTokens
    );

    // 验证范围：建议 1% ~ 10%
    const minSummaryTokens = Math.max(100, Math.floor(this.contextWindowTokens * 0.01));
    const maxSummaryTokens = Math.floor(this.contextWindowTokens * 0.10);

    if (summaryMaxTokens < minSummaryTokens || summaryMaxTokens > maxSummaryTokens) {
      logger.warn("summaryMaxTokens 超出建议范围", {
        calculated: summaryMaxTokens,
        suggested: `${minSummaryTokens} ~ ${maxSummaryTokens}`,
        contextWindowTokens: this.contextWindowTokens,
      });
    }

    // 构建完整配置
    this.config = {
      strategy: options.compression?.strategy ?? "hybrid",
      keepRecentMessages: options.compression?.keepRecentMessages ?? 10,
      summaryMaxTokens,
      enabled: options.compression?.enabled ?? true,
    };

    if (options.llmCall) {
      this.llmCall = options.llmCall;
    }

    logMethodReturn(logger, {
      method: "ContextCompressor.constructor",
      module: "context-compressor",
      result: {
        initialized: true,
        summaryMaxTokens: this.config.summaryMaxTokens,
        source: options.compression?.summaryMaxTokens ?? "5% (default)",
      },
      duration: timer(),
    });
  }

  /**
   * 检查是否需要压缩
   */
  needsCompression(messages: Message[]): boolean {
    const totalTokens = estimateMessagesTokens(messages);
    const threshold = this.contextWindowTokens * this.compressionTokenThreshold;
    return totalTokens >= threshold;
  }

  /**
   * 压缩消息
   */
  async compress(messages: Message[]): Promise<CompressionResult> {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "compress",
      module: "context-compressor",
      params: {
        messageCount: messages.length,
        strategy: this.config.strategy,
      },
    });

    try {
      const originalTokens = estimateMessagesTokens(messages);

      // 如果不需要压缩，直接返回
      if (!this.needsCompression(messages)) {
        const result: CompressionResult = {
          messages,
          originalTokens,
          compressedTokens: originalTokens,
          hasSummary: false,
          strategy: this.config.strategy,
        };
        logMethodReturn(logger, {
          method: "compress",
          module: "context-compressor",
          result: { compressed: false, tokens: originalTokens },
          duration: timer(),
        });
        return result;
      }

      // 根据策略压缩
      let result: CompressionResult;
      switch (this.config.strategy) {
        case "sliding-window":
          result = await this.compressWithSlidingWindow(messages, originalTokens);
          break;
        case "summarization":
          result = await this.compressWithSummarization(messages, originalTokens);
          break;
        case "hybrid":
        default:
          result = await this.compressWithHybrid(messages, originalTokens);
          break;
      }

      logMethodReturn(logger, {
        method: "compress",
        module: "context-compressor",
        result: {
          compressed: true,
          originalTokens,
          compressedTokens: result.compressedTokens,
          strategy: result.strategy,
        },
        duration: timer(),
      });
      return result;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "compress",
        module: "context-compressor",
        error: {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        },
        params: { messageCount: messages.length },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 滑动窗口压缩
   */
  private async compressWithSlidingWindow(
    messages: Message[],
    originalTokens: number,
  ): Promise<CompressionResult> {
    const selectedMessages = selectMessagesByTokens(
      messages,
      this.contextWindowTokens,
    );
    const compressedTokens = estimateMessagesTokens(selectedMessages);

    return {
      messages: selectedMessages,
      originalTokens,
      compressedTokens,
      hasSummary: false,
      strategy: "sliding-window",
    };
  }

  /**
   * 纯摘要压缩
   */
  private async compressWithSummarization(
    messages: Message[],
    originalTokens: number,
  ): Promise<CompressionResult> {
    // 如果没有 LLM 调用函数，回退到滑动窗口
    if (!this.llmCall) {
      logger.warn("LLM 调用函数未提供，回退到滑动窗口策略");
      return this.compressWithSlidingWindow(messages, originalTokens);
    }

    const keepCount = this.config.keepRecentMessages;
    const recentMessages = messages.slice(-keepCount);
    const oldMessages = messages.slice(0, -keepCount);

    // 如果没有旧消息可摘要，直接返回
    if (oldMessages.length === 0) {
      return {
        messages: recentMessages,
        originalTokens,
        compressedTokens: estimateMessagesTokens(recentMessages),
        hasSummary: false,
        strategy: "summarization",
      };
    }

    // 生成摘要（失败时降级到滑动窗口）
    let summaryMessage: Message;
    try {
      summaryMessage = await this.generateSummary(oldMessages);
    } catch (error) {
      logger.error("摘要生成失败，降级到滑动窗口策略", {
        error: error instanceof Error ? error.message : String(error),
        oldMessageCount: oldMessages.length,
      });
      return this.compressWithSlidingWindow(messages, originalTokens);
    }
    const resultMessages = [summaryMessage, ...recentMessages];
    const compressedTokens = estimateMessagesTokens(resultMessages);

    return {
      messages: resultMessages,
      originalTokens,
      compressedTokens,
      hasSummary: true,
      strategy: "summarization",
    };
  }

  /**
   * 混合压缩
   *
   * 1. 保留最近 N 条消息
   * 2. 旧消息生成摘要（追加到 running summary）
   * 3. 合并：[summary message] + [recent messages]
   */
  private async compressWithHybrid(
    messages: Message[],
    originalTokens: number,
  ): Promise<CompressionResult> {
    // 如果没有 LLM 调用函数，回退到滑动窗口
    if (!this.llmCall) {
      logger.warn("LLM 调用函数未提供，回退到滑动窗口策略");
      return this.compressWithSlidingWindow(messages, originalTokens);
    }

    const keepCount = this.config.keepRecentMessages;
    const recentMessages = messages.slice(-keepCount);
    const oldMessages = messages.slice(0, -keepCount);

    // 如果没有旧消息可摘要
    if (oldMessages.length === 0) {
      return {
        messages: recentMessages,
        originalTokens,
        compressedTokens: estimateMessagesTokens(recentMessages),
        hasSummary: false,
        strategy: "hybrid",
      };
    }

    // 生成或更新 running summary（失败时降级到滑动窗口）
    let summaryMessage: Message;
    try {
      summaryMessage = await this.updateRunningSummary(oldMessages);
    } catch (error) {
      logger.error("摘要生成失败，降级到滑动窗口策略", {
        error: error instanceof Error ? error.message : String(error),
        oldMessageCount: oldMessages.length,
      });
      return this.compressWithSlidingWindow(messages, originalTokens);
    }
    const resultMessages = [summaryMessage, ...recentMessages];

    // 如果仍然超过限制，再次裁剪
    const compressedTokens = estimateMessagesTokens(resultMessages);
    if (compressedTokens > this.contextWindowTokens) {
      const finalMessages = selectMessagesByTokens(
        resultMessages,
        this.contextWindowTokens,
      );
      return {
        messages: finalMessages,
        originalTokens,
        compressedTokens: estimateMessagesTokens(finalMessages),
        hasSummary: true,
        strategy: "hybrid",
      };
    }

    return {
      messages: resultMessages,
      originalTokens,
      compressedTokens,
      hasSummary: true,
      strategy: "hybrid",
    };
  }

  /**
   * 生成摘要消息
   */
  private async generateSummary(messages: Message[]): Promise<Message> {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "generateSummary",
      module: "context-compressor",
      params: { messageCount: messages.length },
    });

    try {
      // 格式化对话内容
      const conversationText = this.formatConversation(messages);
      const userPrompt = SUMMARY_USER_PROMPT.replace(
        "{conversation}",
        conversationText,
      );

      // 调用 LLM 生成摘要
      const summaryContent = await this.llmCall!([
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      // 构建摘要消息
      const summaryMessage: Message = {
        role: "user",
        content: `[对话历史摘要]\n${summaryContent.trim()}`,
      };

      logMethodReturn(logger, {
        method: "generateSummary",
        module: "context-compressor",
        result: { summaryLength: summaryContent.length },
        duration: timer(),
      });

      return summaryMessage;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "generateSummary",
        module: "context-compressor",
        error: {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        },
        params: { messageCount: messages.length },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 更新 Running Summary
   *
   * 将新消息追加到现有摘要
   */
  private async updateRunningSummary(messages: Message[]): Promise<Message> {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "updateRunningSummary",
      module: "context-compressor",
      params: { messageCount: messages.length },
    });

    try {
      const conversationText = this.formatConversation(messages);

      let summaryContent: string;

      if (this.runningSummary) {
        // 增量更新摘要
        const updatePrompt = `现有摘要：
${this.runningSummary.content}

新增对话内容：
${conversationText}

请更新摘要，整合新信息。保持简洁，不超过 300 字。`;

        summaryContent = await this.llmCall!([
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: updatePrompt },
        ]);
      } else {
        // 首次生成摘要
        const userPrompt = SUMMARY_USER_PROMPT.replace(
          "{conversation}",
          conversationText,
        );
        summaryContent = await this.llmCall!([
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ]);
      }

      // 更新 running summary
      this.runningSummary = {
        content: summaryContent.trim(),
        lastMessageIndex: messages.length - 1,
        tokens: estimateMessageTokens({
          role: "user",
          content: summaryContent,
        }),
      };

      const summaryMessage: Message = {
        role: "user",
        content: `[对话历史摘要]\n${summaryContent.trim()}`,
      };

      logMethodReturn(logger, {
        method: "updateRunningSummary",
        module: "context-compressor",
        result: { summaryTokens: this.runningSummary.tokens },
        duration: timer(),
      });

      return summaryMessage;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "updateRunningSummary",
        module: "context-compressor",
        error: {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        },
        params: { messageCount: messages.length },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 格式化对话内容
   */
  private formatConversation(messages: Message[]): string {
    return messages
      .map((msg) => {
        const role = msg.role === "user" ? "用户" : "助手";
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        // 截断过长的消息
        const truncated =
          content.length > 500
            ? content.substring(0, 500) + "...[已截断]"
            : content;
        return `${role}: ${truncated}`;
      })
      .join("\n\n");
  }

  /**
   * 重置 Running Summary
   */
  resetSummary(): void {
    this.runningSummary = null;
    logger.info("Running Summary 已重置");
  }

  /**
   * 获取当前 Running Summary
   */
  getRunningSummary(): RunningSummary | null {
    return this.runningSummary;
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建压缩器实例
 */
export function createContextCompressor(
  options: CompressorOptions,
): ContextCompressor {
  return new ContextCompressor(options);
}

/**
 * 快速压缩（滑动窗口，无需 LLM）
 */
export function quickCompress(
  messages: Message[],
  maxTokens: number,
): Message[] {
  return selectMessagesByTokens(messages, maxTokens);
}
