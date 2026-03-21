/**
 * 消息处理模块
 *
 * 负责 Channel 消息到 AgentLoop 的转发和处理
 */

import { readFile } from "node:fs/promises";
import type { Settings } from "../../../config/loader.js";
import type { IProviderExtended } from "../../../../runtime/provider/contract.js";
import type { IChannelExtended } from "../../../../runtime/channel/contract.js";
import type { InboundMessage } from "../../../../runtime/channel/types.js";
import type { Message } from "../../../../runtime/types.js";
import { AgentLoop } from "../../../../runtime/kernel/agent-loop.js";
import { SessionManager } from "../../../../runtime/session/manager.js";
import {
  AGENTS_FILE,
  SOUL_FILE,
  USER_FILE,
  TOOLS_FILE,
  MEMORY_FILE,
  WORKSPACE_DIR,
} from "../../../shared/constants.js";
import {
  buildSystemPrompt,
  buildRuntimeContext,
  getCurrentDateString,
} from "../../../prompts/index.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "MessageHandler";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 读取文件内容（如果存在）
 */
async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * 截断文本用于日志
 */
function truncateForLog(text: string, maxLen = 1000): string {
  if (!text) return "";
  return text.length > maxLen ? text.substring(0, maxLen) + "...(truncated)" : text;
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 创建消息处理器（将 Channel 消息转发给 AgentLoop）
 */
export async function createMessageHandler(
  agent: AgentLoop,
  sessionManager: SessionManager,
  channels: IChannelExtended[],
  settings: Settings,
  provider: IProviderExtended
): Promise<(message: InboundMessage) => Promise<void>> {
  const handlerTimer = createTimer();
  logMethodCall(logger, { method: "createMessageHandler", module: MODULE_NAME, params: { channelCount: channels.length } });

  // 单用户模式：使用全局统一的 session key
  const GLOBAL_SESSION_KEY = "global";

  // 构建系统提示词（只构建一次）
  const [agentsContent, soulContent, userContent, toolsContent, memoryContent] = await Promise.all([
    readFileIfExists(AGENTS_FILE),
    readFileIfExists(SOUL_FILE),
    readFileIfExists(USER_FILE),
    readFileIfExists(TOOLS_FILE),
    readFileIfExists(MEMORY_FILE),
  ]);

  // 构建系统提示词
  const systemPromptResult = buildSystemPrompt({
    agentsContent: agentsContent || "You are MicroAgent, a helpful AI assistant.",
    soulContent,
    userContent,
    toolsContent,
    memoryContent,
    currentDate: getCurrentDateString(),
  });
  logger.info("使用标准系统提示词");

  logger.info("系统提示词已构建", { length: systemPromptResult.length });

  // 获取上下文配置
  const contextWindowTokens = settings.sessions?.contextWindowTokens ?? 65535;
  const compressionTokenThreshold = settings.sessions?.compressionTokenThreshold ?? 0.7;
  const compressionConfig = settings.sessions?.compression;

  // 创建 LLM 调用函数（用于摘要生成）
  // 注意：如果 LLM 调用失败，会降级到滑动窗口策略
  const llmCall = async (messages: Message[]): Promise<string> => {
    try {
      const model = settings.agents?.defaults?.model ?? "gpt-4o-mini";
      const response = await provider.chat({
        messages,
        model,
        maxTokens: 500,
        temperature: 0.3,
      });
      return response.text ?? "";
    } catch (error) {
      logger.error("摘要生成 LLM 调用失败，将降级到滑动窗口策略", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error; // 重新抛出，让 compressor 处理降级
    }
  };

  // 创建压缩器
  const { ContextCompressor } = await import("../../../shared/context-compressor.js");
  const compressorOptions = {
    contextWindowTokens,
    compressionTokenThreshold,
    llmCall,
    ...(compressionConfig && { compression: compressionConfig }),
  };
  const compressor = new ContextCompressor(compressorOptions);

  logMethodReturn(logger, { method: "createMessageHandler", module: MODULE_NAME, result: { success: true, compressionStrategy: compressionConfig?.strategy ?? "sliding-window" }, duration: handlerTimer() });

  return async (message: InboundMessage) => {
    const messageTimer = createTimer();

    logger.info("收到用户消息", {
      channelId: message.channelId,
      from: message.from,
      to: message.to,
      content: truncateForLog(message.text)
    });

    try {
      // 使用全局 session（跨平台共享上下文）
      const session = sessionManager.getOrCreate(GLOBAL_SESSION_KEY);

      // 添加用户消息并持久化
      await session.addMessageAndPersist({
        role: "user",
        content: message.text,
      });

      // 获取所有消息
      const allMessages = session.getMessages();

      // 使用压缩器处理消息
      const compressionResult = await compressor.compress(allMessages);

      // 构建运行时上下文（包含 workspace 路径）
      const runtimeContext = buildRuntimeContext({
        currentDate: getCurrentDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: process.platform,
        workspacePath: WORKSPACE_DIR,
      });

      // 构建最终消息列表：系统提示词 + 压缩后的消息
      const finalMessages: Message[] = [
        { role: "system", content: systemPromptResult.prompt },
      ];

      // 在压缩后的消息中注入运行时上下文
      const compressedMsgs = compressionResult.messages;
      for (let i = 0; i < compressedMsgs.length; i++) {
        const msg = compressedMsgs[i];
        if (!msg) continue;

        if (msg.role === "user" && i === compressedMsgs.length - 1) {
          // 最后一条用户消息前注入运行时上下文
          finalMessages.push({
            role: "user",
            content: `${runtimeContext}\n\n${msg.content}`,
          });
        } else {
          finalMessages.push(msg);
        }
      }

      logger.info("开始运行 Agent", {
        messageCount: finalMessages.length,
        originalTokens: compressionResult.originalTokens,
        compressedTokens: compressionResult.compressedTokens,
        hasSummary: compressionResult.hasSummary,
        strategy: compressionResult.strategy,
        systemPromptLength: systemPromptResult.length,
        hasWorkspacePath: true,
      });

      const result = await agent.run(finalMessages);

      // 记录 Agent 运行结果
      logger.info("Agent 运行完成", {
        hasContent: !!result.content,
        contentLength: result.content?.length ?? 0,
        hasError: !!result.error,
        errorMessage: result.error,
        messageCount: result.messages?.length ?? 0
      });

      // 更新 session 并持久化新消息
      if (result.messages) {
        const previousCount = session.getState().messageCount;
        session.clear();

        let index = 0;
        for (const msg of result.messages) {
          // 只持久化新增的消息（索引 >= previousCount 的消息）
          if (index >= previousCount) {
            await session.addMessageAndPersist(msg);
          } else {
            session.addMessage(msg);
          }
          index++;
        }
      }

      // 发送回复
      if (result.content) {
        const channel = channels.find((c) => c.id === message.channelId);
        if (channel) {
          // 回复目标：群聊回复到群，私聊回复给发送者
          const replyTo = message.to || message.from;

          logger.info("发送回复给用户", {
            channelId: message.channelId,
            to: replyTo,
            content: truncateForLog(result.content)
          });

          await channel.send({
            to: replyTo,
            text: result.content,
            format: "markdown", // 使用 Markdown 格式
            metadata: message.metadata, // 传递 Channel 特定元数据
          });
          logger.info("消息回复发送成功", { channelId: message.channelId, to: replyTo });
        }
      } else if (result.error) {
        logger.error("Agent 返回错误，无回复内容", { error: result.error });
      }

      logger.info("消息处理完成", { duration: messageTimer() });
    } catch (err) {
      const error = err as Error;
      logger.error("消息处理失败", {
        channelId: message.channelId,
        error: { name: error.name, message: error.message, stack: error.stack },
        duration: messageTimer(),
      });
    }
  };
}
