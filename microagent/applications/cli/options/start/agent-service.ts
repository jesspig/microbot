/**
 * Agent 服务运行模块
 *
 * 负责 Agent 服务的启动、运行和关闭
 */

import type { Settings } from "../../../config/loader.js";
import type { IProviderExtended } from "../../../../runtime/provider/contract.js";
import type { IChannelExtended } from "../../../../runtime/channel/contract.js";
import type { AgentConfig } from "../../../../runtime/kernel/types.js";
import type { InboundMessage } from "../../../../runtime/channel/types.js";
import type { StartOptions } from "./types.js";
import { AgentLoop } from "../../../../runtime/kernel/agent-loop.js";
import { SessionManager } from "../../../../runtime/session/manager.js";
import { ChannelManager } from "../../../../runtime/channel/manager.js";
import { MCPManager } from "../../../tools/index.js";
import { createMessageHandler } from "./message-handler.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "AgentService";

// 创建 MCP 管理器实例
const mcpManager = new MCPManager();

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 运行 Agent 服务
 */
export async function runAgentService(
  provider: IProviderExtended,
  toolRegistry: any,
  sessionManager: SessionManager,
  channelManager: ChannelManager,
  channels: IChannelExtended[],
  settings: Settings,
  _options: StartOptions
): Promise<void> {
  const timer = createTimer();
  logMethodCall(logger, { method: "runAgentService", module: MODULE_NAME, params: { channelCount: channels.length } });

  // 创建 AgentLoop
  // 处理模型名：剥离 provider 前缀
  let model = settings.agents?.defaults?.model ?? "default";
  const slashIndex = model.indexOf("/");
  if (slashIndex >= 0) {
    const originalModel = model;
    model = model.substring(slashIndex + 1);
    logger.debug("剥离模型 provider 前缀", { originalModel, strippedModel: model });
  }

  const agentConfig: AgentConfig = {
    model,
    maxIterations: settings.agents?.defaults?.maxToolIterations ?? 50,
    defaultTimeout: 60000,
    enableLogging: false,
  };
  const agent = new AgentLoop(provider, toolRegistry, agentConfig);
  logger.info("AgentLoop 创建完成", { model: agentConfig.model, maxIterations: agentConfig.maxIterations });

  // 创建消息处理器（传入 provider 用于摘要生成）
  const messageHandler = await createMessageHandler(agent, sessionManager, channels, settings, provider);

  // 注册消息处理器到所有 Channel
  for (const channel of channels) {
    channel.onMessage(messageHandler);
  }

  // 启动所有 Channel
  await channelManager.startAll();
  logger.info("Agent 服务启动完成", { channels: channels.map(c => c.id) });

  logMethodReturn(logger, { method: "runAgentService", module: MODULE_NAME, result: { success: true }, duration: timer() });

  // 保持运行
  return new Promise((resolve) => {
    const cleanup = async () => {
      logger.info("Agent 服务正在关闭...");
      // 关闭 MCP 连接
      try {
        await mcpManager.closeAll();
        logger.debug("MCP 连接已关闭");
      } catch (err) {
        const error = err as Error;
        logger.error("关闭 MCP 连接失败", { error: error.message });
      }

      // 停止 Channel
      await channelManager.stopAll();
      logger.info("Agent 服务已关闭");
      resolve();
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
