/**
 * 运行时目录和配置初始化模块
 *
 * 负责创建必要的目录结构和初始化配置文件
 */

import { mkdirSync } from "node:fs";
import {
  MICRO_AGENT_DIR,
  WORKSPACE_DIR,
  SESSIONS_DIR,
  LOGS_DIR,
  HISTORY_DIR,
  SKILLS_DIR,
  SETTINGS_FILE,
  AGENTS_FILE,
  SOUL_FILE,
  USER_FILE,
  TOOLS_FILE,
  HEARTBEAT_FILE,
  MEMORY_FILE,
  MCP_CONFIG_FILE,
} from "../../../shared/constants.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "Initializer";

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 初始化运行时目录结构
 */
export function initializeRuntimeDirectories(): void {
  const timer = createTimer();
  logMethodCall(logger, { method: "initializeRuntimeDirectories", module: MODULE_NAME, params: {} });

  const dirs = [
    MICRO_AGENT_DIR,
    WORKSPACE_DIR,
    SESSIONS_DIR,
    LOGS_DIR,
    HISTORY_DIR,
    SKILLS_DIR,
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  logger.debug("运行时目录初始化完成", { directories: dirs });
  logMethodReturn(logger, { method: "initializeRuntimeDirectories", module: MODULE_NAME, result: { success: true, count: dirs.length }, duration: timer() });
}

/**
 * 初始化配置文件（从模板复制）
 */
export async function initializeConfigFiles(): Promise<void> {
  const timer = createTimer();
  logMethodCall(logger, { method: "initializeConfigFiles", module: MODULE_NAME, params: {} });

  const templateDir = import.meta.dir + "/../../../templates";
  const configFiles = [
    { src: "AGENTS.md", dest: AGENTS_FILE },
    { src: "SOUL.md", dest: SOUL_FILE },
    { src: "USER.md", dest: USER_FILE },
    { src: "TOOLS.md", dest: TOOLS_FILE },
    { src: "HEARTBEAT.md", dest: HEARTBEAT_FILE },
    { src: "MEMORY.md", dest: MEMORY_FILE },
    { src: "mcp.json", dest: MCP_CONFIG_FILE },
  ];

  const createdFiles: string[] = [];

  for (const { src, dest } of configFiles) {
    const destFile = Bun.file(dest);
    if (!(await destFile.exists())) {
      const srcFile = Bun.file(`${templateDir}/${src}`);
      if (await srcFile.exists()) {
        const content = await srcFile.text();
        await Bun.write(dest, content);
        createdFiles.push(dest);
      }
    }
  }

  // settings.yaml 特殊处理
  const settingsFile = Bun.file(SETTINGS_FILE);
  if (!(await settingsFile.exists())) {
    const exampleFile = Bun.file(`${templateDir}/settings.example.yaml`);
    if (await exampleFile.exists()) {
      const content = await exampleFile.text();
      await Bun.write(SETTINGS_FILE, content);
      createdFiles.push(SETTINGS_FILE);
    }
  }

  if (createdFiles.length > 0) {
    logger.debug("配置文件初始化完成", { createdFiles });
  }
  logMethodReturn(logger, { method: "initializeConfigFiles", module: MODULE_NAME, result: { success: true, createdCount: createdFiles.length }, duration: timer() });
}
