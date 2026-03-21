/**
 * 工具管理器
 *
 * 负责工具注册和管理
 */

import type { Settings } from "../config/index.js";
import { ToolRegistry } from "../../runtime/index.js";
import { toolFactories } from "../tools/index.js";
import { builderLogger, logMethodCall, logMethodReturn, logMethodError, createTimer } from "../shared/logger.js";

const MODULE_NAME = "ToolManager";

/**
 * MCP 管理器接口
 * 用于解耦对具体 MCP 管理器的依赖
 */
export interface IMCPManager {
  loadConfig(): Promise<{ mcpServers: Record<string, unknown> }>;
  connectAll(callback: (tool: unknown, serverName: string) => void): Promise<
    Array<{ status: "connected" | "error" | "disconnected" }>
  >;
}

/**
 * 工具管理器
 * 负责工具注册和管理
 */
export class ToolManager {
  /** 工具注册表 */
  private readonly tools = new ToolRegistry();

  /** 自定义工具名称列表 */
  private customToolNames: string[] = [];

  /** MCP 管理器 */
  private mcpManager: IMCPManager | null = null;

  /**
   * 设置自定义工具名称列表
   * @param names - 工具名称列表
   */
  withCustomToolNames(names: string[]): this {
    this.customToolNames = names;
    return this;
  }

  /**
   * 设置 MCP 管理器
   * @param manager - MCP 管理器
   */
  withMCPManager(manager: IMCPManager): this {
    this.mcpManager = manager;
    return this;
  }

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getRegistry(): ToolRegistry {
    return this.tools;
  }

  /**
   * 注册工具
   * @param settings - 配置对象
   */
  async register(settings: Settings): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "register", module: MODULE_NAME });

    try {
      // 确定要注册的工具
      let toolNames = this.determineToolNames(settings);

      logger.debug("注册工具", { toolNames, count: toolNames.length });

      // 注册工具
      for (const name of toolNames) {
        const factory = toolFactories[name];
        if (factory) {
          const tool = factory();
          if (tool) {
            this.tools.register(tool);
          }
        }
      }

      // 加载 MCP 工具
      await this.loadMCPTools();

      logMethodReturn(logger, {
        method: "register",
        module: MODULE_NAME,
        result: { toolsCount: this.tools.list().length },
        duration: timer(),
      });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "register",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 确定要注册的工具名称列表
   * @param settings - 配置对象
   * @returns 工具名称列表
   */
  private determineToolNames(settings: Settings): string[] {
    let toolNames = this.customToolNames;

    // 如果没有指定，使用配置中的工具列表或全部工具
    if (toolNames.length === 0) {
      const allToolNames = Object.keys(toolFactories);

      if (settings.tools) {
        const { enabled, disabled } = settings.tools;

        // 如果启用了特定工具，只注册这些工具
        if (enabled && enabled.length > 0) {
          toolNames = enabled.filter(
            (name) => allToolNames.includes(name) && !disabled.includes(name)
          );
        } else {
          // 否则注册所有工具，除了被禁用的
          toolNames = allToolNames.filter((name) => !disabled.includes(name));
        }
      } else {
        toolNames = allToolNames;
      }
    }

    return toolNames;
  }

  /**
   * 加载 MCP 工具
   */
  private async loadMCPTools(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "loadMCPTools", module: MODULE_NAME });

    try {
      // 检查 MCP 管理器是否已设置
      if (!this.mcpManager) {
        logMethodReturn(logger, {
          method: "loadMCPTools",
          module: MODULE_NAME,
          result: { serversCount: 0, reason: "MCP 管理器未设置" },
          duration: timer(),
        });
        return;
      }

      // 加载 MCP 配置
      const config = await this.mcpManager.loadConfig();

      if (Object.keys(config.mcpServers).length === 0) {
        logMethodReturn(logger, {
          method: "loadMCPTools",
          module: MODULE_NAME,
          result: { serversCount: 0 },
          duration: timer(),
        });
        return;
      }

      logger.debug("加载 MCP 配置", { serversCount: Object.keys(config.mcpServers).length });

      // 连接所有启用的服务器并注册工具
      const results = await this.mcpManager.connectAll((tool, _serverName) => {
        this.tools.register(tool);
      });

      // 统计连接结果
      const connected = results.filter((r) => r.status === "connected").length;
      const errors = results.filter((r) => r.status === "error").length;
      const disconnected = results.filter((r) => r.status === "disconnected").length;

      logger.info("MCP 连接结果", { connected, errors, disconnected });

      logMethodReturn(logger, {
        method: "loadMCPTools",
        module: MODULE_NAME,
        result: { connected, errors, disconnected },
        duration: timer(),
      });
    } catch (err) {
      const error = err as Error;
      logger.warn("MCP 加载失败", { error: error.message });
      logMethodReturn(logger, {
        method: "loadMCPTools",
        module: MODULE_NAME,
        result: { error: error.message },
        duration: timer(),
      });
    }
  }
}
