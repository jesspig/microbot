/**
 * start 命令入口
 *
 * 重构后的简洁版本，仅负责协调各模块
 */

import type { Settings } from "../../../config/loader.js";
import {
  SETTINGS_FILE,
} from "../../../shared/constants.js";
import { loadSettings } from "../../../config/loader.js";
import { getAllTools, MCPManager } from "../../../tools/index.js";
import { FilesystemSkillLoader } from "../../../skills/index.js";
import { ToolRegistry } from "../../../../runtime/tool/registry.js";
import { SessionManager } from "../../../../runtime/session/manager.js";
import { ChannelManager } from "../../../../runtime/channel/manager.js";
import type { StartOptions, StartResult } from "./types.js";
import { initializeRuntimeDirectories, initializeConfigFiles } from "./initializer.js";
import { createProvider } from "./provider-setup.js";
import { createChannels } from "./channel-setup.js";
import { runAgentService } from "./agent-service.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "StartCommand";

// 创建 MCP 管理器实例
const mcpManager = new MCPManager();

/**
 * 执行 start 命令
 */
export async function startCommand(
  options: StartOptions = {}
): Promise<StartResult> {
  const timer = createTimer();
  logMethodCall(logger, { method: "startCommand", module: MODULE_NAME, params: { config: options.config, model: options.model, debug: options.debug } });

  // 全局错误处理：捕获 Channel SDK 的异步错误
  const handleUncaughtError = (error: Error & { code?: string }) => {
    // 网络连接错误（SDK 内部错误）
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      logger.debug("网络错误已静默处理", { code: error.code });
      return;
    }

    // 其他未捕获的错误
    logger.error("未捕获的错误", { name: error.name, message: error.message, code: error.code });
  };

  process.on("uncaughtException", handleUncaughtError);

  try {
    // 1. 初始化运行时目录
    logger.debug("步骤 1: 初始化运行时目录");
    initializeRuntimeDirectories();
    await initializeConfigFiles();

    // 2. 加载配置
    logger.debug("步骤 2: 加载配置");
    const configPath = options.config ?? SETTINGS_FILE;

    let settings: Settings;
    try {
      settings = await loadSettings(configPath);
      logger.info("配置加载成功", { configPath });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "startCommand",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message },
        params: { configPath },
        duration: timer(),
      });
      return { success: false, error: error.message };
    }

    // 3. 覆盖模型
    if (options.model) {
      logger.debug("覆盖模型", { model: options.model });
      settings.agents!.defaults!.model = options.model;
    }

    // 4. 注册工具
    logger.debug("步骤 4: 注册工具");
    const toolRegistry = new ToolRegistry();
    const tools = getAllTools();
    for (const tool of tools) {
      toolRegistry.register(tool);
    }
    logger.info("内置工具注册完成", { toolCount: tools.length });

    // 4.1 异步加载 MCP 工具（不阻塞启动）
    const loadMCPTools = async () => {
      try {
        const mcpConfig = await mcpManager.loadConfig();
        const serverCount = Object.keys(mcpConfig.mcpServers).length;

        if (serverCount === 0) {
          return;
        }

        logger.debug("开始加载 MCP 工具", { serverCount });
        const results = await mcpManager.connectAll((tool, _serverName) => {
          toolRegistry.register(tool);
        });

        const connectedCount = results.filter((r) => r.status === "connected").length;
        logger.info("MCP 工具加载完成", { serverCount, connectedCount });
      } catch (err) {
        const error = err as Error;
        logger.error("加载 MCP 工具失败", { error: error.message });
      }
    };

    // 后台异步加载 MCP，不阻塞启动
    loadMCPTools();

    // 5. 加载技能
    logger.debug("步骤 5: 加载技能");
    const skillLoader = new FilesystemSkillLoader();
    const skills = await skillLoader.listSkills();
    logger.info("技能加载完成", { skillCount: skills.length });

    // 6. 创建 Provider
    logger.debug("步骤 6: 创建 Provider");
    const provider = createProvider(settings);
    if (!provider) {
      logMethodError(logger, {
        method: "startCommand",
        module: MODULE_NAME,
        error: { name: "ProviderError", message: "未找到可用的 Provider" },
        params: {},
        duration: timer(),
      });
      return { success: false, error: "未找到可用的 Provider" };
    }

    // 7. 创建 Channel
    logger.debug("步骤 7: 创建 Channel");
    const channels = createChannels(settings);

    // 8. 创建 Session 管理器并加载历史会话
    logger.debug("步骤 8: 创建 Session 管理器");
    const sessionManager = new SessionManager();
    const GLOBAL_SESSION_KEY = "global";

    // 读取会话配置
    const persistEnabled = settings.sessions?.persist ?? true;
    const contextWindowTokens = settings.sessions?.contextWindowTokens ?? 65535;

    // 仅在持久化启用时加载历史
    if (persistEnabled) {
      try {
        await sessionManager.loadHistory(GLOBAL_SESSION_KEY, contextWindowTokens);
        logger.debug("历史会话加载成功");
      } catch (err) {
        const error = err as Error;
        logger.debug("历史会话加载跳过", { reason: error.message });
      }
    }

    // 9. 创建 Channel 管理器
    logger.debug("步骤 9: 创建 Channel 管理器");
    const channelManager = new ChannelManager();
    for (const channel of channels) {
      channelManager.register(channel);
    }

    // 10. 启动 Agent 服务
    logger.info("启动 Agent 服务");
    await runAgentService(
      provider,
      toolRegistry,
      sessionManager,
      channelManager,
      channels,
      settings,
      options
    );

    logMethodReturn(logger, { method: "startCommand", module: MODULE_NAME, result: { success: true }, duration: timer() });
    return { success: true };
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "startCommand",
      module: MODULE_NAME,
      error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
      params: { config: options.config, model: options.model, debug: options.debug },
      duration: timer(),
    });
    return { success: false, error: error.message };
  }
}

/**
 * 显示 start 命令帮助信息（保留接口，但不做任何输出）
 */
export function showStartHelp(): void {
  // 已移除所有 console.log 调用
}
