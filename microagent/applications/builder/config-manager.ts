/**
 * 配置管理器
 *
 * 负责配置加载和验证
 */

import { loadSettings, type Settings } from "../config/index.js";
import { SETTINGS_FILE } from "../shared/constants.js";
import { builderLogger, logMethodCall, logMethodReturn, logMethodError, createTimer } from "../shared/logger.js";

const MODULE_NAME = "ConfigManager";

/**
 * 配置管理器
 * 负责配置加载和验证
 */
export class ConfigManager {
  /** 配置对象 */
  private settings: Settings | null = null;

  /** 配置文件路径 */
  private configPath: string | null = null;

  /**
   * 设置配置文件路径
   * @param path - 配置文件路径
   */
  withConfigPath(path: string): this {
    this.configPath = path;
    return this;
  }

  /**
   * 直接设置配置对象
   * @param settings - 配置对象
   */
  withSettings(settings: Settings): this {
    this.settings = settings;
    return this;
  }

  /**
   * 加载配置
   * @returns 配置对象
   */
  async load(): Promise<Settings> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "load", module: MODULE_NAME, params: { configPath: this.configPath } });

    try {
      // 已设置配置对象
      if (this.settings) {
        logMethodReturn(logger, { method: "load", module: MODULE_NAME, result: { source: "cached" }, duration: timer() });
        return this.settings;
      }

      // 从文件加载
      const configPath = this.configPath ?? SETTINGS_FILE;
      logger.debug("加载配置文件", { configPath });
      this.settings = await loadSettings(configPath);

      logMethodReturn(logger, { method: "load", module: MODULE_NAME, result: { source: "file", configPath }, duration: timer() });
      return this.settings;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "load",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        params: { configPath: this.configPath },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 重置配置管理器
   */
  reset(): void {
    this.settings = null;
    this.configPath = null;
  }
}
