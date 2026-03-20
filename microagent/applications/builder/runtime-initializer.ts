/**
 * 运行时初始化器
 *
 * 负责运行时目录初始化和模板复制
 */

import { mkdir, exists, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MICRO_AGENT_DIR,
  WORKSPACE_DIR,
  SESSIONS_DIR,
  LOGS_DIR,
  HISTORY_DIR,
  SKILLS_DIR,
} from "../shared/constants.js";
import { builderLogger, logMethodCall, logMethodReturn, logMethodError, createTimer } from "../shared/logger.js";

const MODULE_NAME = "RuntimeInitializer";

/** 模板目录路径 */
const TEMPLATES_DIR = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "templates"
);

/** 模板文件列表（全部复制到根目录） */
const TEMPLATE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "mcp.json",
  { src: "settings.example.yaml", dest: "settings.yaml" },
];

/**
 * 运行时初始化器
 * 负责运行时目录初始化和模板复制
 */
export class RuntimeInitializer {
  /** 是否已初始化目录 */
  private dirInitialized = false;

  /**
   * 确保运行时目录存在
   */
  async ensureDirectories(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "ensureDirectories", module: MODULE_NAME });

    try {
      if (this.dirInitialized) {
        logMethodReturn(logger, { method: "ensureDirectories", module: MODULE_NAME, result: { skipped: true }, duration: timer() });
        return;
      }

      // 创建主目录
      logger.debug("创建目录", { dir: MICRO_AGENT_DIR });
      await this.ensureDir(MICRO_AGENT_DIR);
      await this.ensureDir(WORKSPACE_DIR);
      await this.ensureDir(SESSIONS_DIR);
      await this.ensureDir(LOGS_DIR);
      await this.ensureDir(HISTORY_DIR);
      await this.ensureDir(SKILLS_DIR);

      // 复制模板文件
      await this.copyTemplates();

      this.dirInitialized = true;

      logMethodReturn(logger, { method: "ensureDirectories", module: MODULE_NAME, result: { initialized: true }, duration: timer() });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "ensureDirectories",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 确保目录存在
   * @param dir - 目录路径
   */
  private async ensureDir(dir: string): Promise<void> {
    const logger = builderLogger();
    try {
      const isExists = await this.pathExists(dir);
      if (!isExists) {
        await mkdir(dir, { recursive: true });
        logger.debug("目录创建成功", { dir });
      }
    } catch (error) {
      logger.debug("目录操作异常", { dir, error: String(error) });
      throw error;
    }
  }

  /**
   * 检查路径是否存在
   * @param path - 路径
   * @returns 是否存在
   */
  private async pathExists(path: string): Promise<boolean> {
    const logger = builderLogger();
    try {
      await exists(path);
      return true;
    } catch (error) {
      logger.debug("路径检查异常", { path, error: String(error) });
      return false;
    }
  }

  /**
   * 复制模板文件
   * 仅在目标文件不存在时复制
   */
  private async copyTemplates(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "copyTemplates", module: MODULE_NAME });

    let copiedCount = 0;
    let skippedCount = 0;

    // 复制模板文件到根目录
    for (const item of TEMPLATE_FILES) {
      // 处理两种格式：字符串或对象
      const srcFile = typeof item === "string" ? item : item.src;
      const destFile = typeof item === "string" ? item : item.dest;

      const srcPath = join(TEMPLATES_DIR, srcFile);
      const destPath = join(MICRO_AGENT_DIR, destFile);

      try {
        // 检查目标文件是否存在
        const destExists = await this.pathExists(destPath);
        if (destExists) {
          skippedCount++;
          continue;
        }

        // 检查源文件是否存在
        const srcExists = await this.pathExists(srcPath);
        if (!srcExists) {
          continue;
        }

        // 复制文件
        await copyFile(srcPath, destPath);
        copiedCount++;
        logger.debug("复制模板文件", { file: srcFile, destPath });
      } catch (error) {
        // 复制失败不影响启动
        logger.warn("模板复制失败", { file: srcFile, error: String(error) });
      }
    }

    logMethodReturn(logger, {
      method: "copyTemplates",
      module: MODULE_NAME,
      result: { copiedCount, skippedCount },
      duration: timer(),
    });
  }
}
