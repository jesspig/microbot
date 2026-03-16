/**
 * 记忆管理工具
 *
 * 用于管理 Agent 的配置和记忆文件：
 * - AGENTS.md - 角色定义
 * - SOUL.md - 个性价值观
 * - USER.md - 用户偏好
 * - MEMORY.md - 长期记忆
 *
 * 支持操作：
 * - read: 读取指定文件内容
 * - update: 更新指定文件内容
 * - search: 搜索记忆内容
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { BaseTool } from "../../runtime/tool/base.js";
import type { ToolParameterSchema, ToolResult } from "../../runtime/tool/types.js";
import {
  AGENTS_FILE,
  SOUL_FILE,
  USER_FILE,
  MEMORY_FILE,
} from "../shared/constants.js";
import { toolsLogger, createTimer, logMethodCall, logMethodReturn, logMethodError, sanitize } from "../shared/logger.js";

const MODULE_NAME = "memory";
const logger = toolsLogger();

// ============================================================================
// 类型定义
// ============================================================================

/** 支持的记忆文件类型 */
type MemoryFileType = "agents" | "soul" | "user" | "memory";

/** 记忆文件路径映射 */
const MEMORY_FILE_MAP: Record<MemoryFileType, string> = {
  agents: AGENTS_FILE,
  soul: SOUL_FILE,
  user: USER_FILE,
  memory: MEMORY_FILE,
};

/** 记忆文件描述映射 */
const MEMORY_FILE_DESCRIPTION: Record<MemoryFileType, string> = {
  agents: "Agent 角色定义（AGENTS.md）",
  soul: "个性价值观（SOUL.md）",
  user: "用户偏好（USER.md）",
  memory: "长期记忆（MEMORY.md）",
};

/** 工具参数类型 */
interface MemoryToolParams extends Record<string, unknown> {
  /** 操作类型 */
  action: "read" | "update" | "search";
  /** 目标文件类型 */
  target: MemoryFileType;
  /** 新内容（update 操作必需） */
  content?: string;
  /** 搜索查询（search 操作必需） */
  query?: string;
  /** 是否追加模式（update 操作可选） */
  append?: boolean;
}

// ============================================================================
// 记忆管理工具实现
// ============================================================================

/**
 * 记忆管理工具
 *
 * 提供对 Agent 配置和记忆文件的安全访问
 */
export class MemoryTool extends BaseTool<MemoryToolParams> {
  readonly name = "memory";
  readonly description = `记忆管理工具，用于读取、更新和搜索 Agent 的配置与记忆文件。

支持的目标文件：
- agents: Agent 角色定义（AGENTS.md）
- soul: 个性价值观（SOUL.md）
- user: 用户偏好（USER.md）
- memory: 长期记忆（MEMORY.md）

支持的操作：
- read: 读取指定文件内容
- update: 更新指定文件内容（支持追加模式）
- search: 在所有记忆文件中搜索内容`;

  readonly parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "update", "search"],
        description: "操作类型：read（读取）、update（更新）、search（搜索）",
      },
      target: {
        type: "string",
        enum: ["agents", "soul", "user", "memory"],
        description: "目标文件类型",
      },
      content: {
        type: "string",
        description: "新内容（update 操作必需）",
      },
      query: {
        type: "string",
        description: "搜索查询（search 操作必需）",
      },
      append: {
        type: "boolean",
        description: "是否追加模式（update 操作可选，默认 false 覆盖）",
      },
    },
    required: ["action"],
  };

  /**
   * 执行工具
   */
  async execute(params: MemoryToolParams): Promise<ToolResult> {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "execute",
      module: MODULE_NAME,
      params: sanitize({
        action: params.action,
        target: params.target,
        hasContent: !!params.content,
        hasQuery: !!params.query,
        append: params.append,
      }) as Record<string, unknown>,
    });

    try {
      const action = this.readStringParam(params, "action", { required: true }) as
        | "read"
        | "update"
        | "search";

      let result: ToolResult;

      switch (action) {
        case "read":
          result = await this.handleRead(params);
          break;
        case "update":
          result = await this.handleUpdate(params);
          break;
        case "search":
          result = await this.handleSearch(params);
          break;
        default:
          throw new Error(`不支持的操作: ${action}`);
      }

      logMethodReturn(logger, {
        method: "execute",
        module: MODULE_NAME,
        result: sanitize({ isError: result.isError }),
        duration: timer(),
      });

      return result;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "execute",
        module: MODULE_NAME,
        error: {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        },
        params: sanitize({ action: params.action }) as Record<string, unknown>,
        duration: timer(),
      });

      return {
        content: "",
        isError: true,
        metadata: { error: error.message },
      };
    }
  }

  // ============================================================================
  // 操作处理方法
  // ============================================================================

  /**
   * 处理读取操作
   */
  private async handleRead(params: MemoryToolParams): Promise<ToolResult> {
    const target = this.readStringParam(params, "target", { required: true }) as MemoryFileType;
    const filePath = MEMORY_FILE_MAP[target];

    if (!filePath) {
      return {
        content: "",
        isError: true,
        metadata: { error: `未知的目标文件类型: ${target}` },
      };
    }

    if (!existsSync(filePath)) {
      return {
        content: "",
        isError: true,
        metadata: { error: `文件不存在: ${MEMORY_FILE_DESCRIPTION[target]}` },
      };
    }

    const fileContent = await readFile(filePath, "utf-8");

    return {
      content: `# ${MEMORY_FILE_DESCRIPTION[target]}\n\n${fileContent}`,
    };
  }

  /**
   * 处理更新操作
   */
  private async handleUpdate(params: MemoryToolParams): Promise<ToolResult> {
    const target = this.readStringParam(params, "target", { required: true }) as MemoryFileType;
    const content = this.readStringParam(params, "content", { required: true });
    const append = this.readBooleanParam(params, "append");

    const filePath = MEMORY_FILE_MAP[target];

    if (!filePath) {
      return {
        content: "",
        isError: true,
        metadata: { error: `未知的目标文件类型: ${target}` },
      };
    }

    if (!content) {
      return {
        content: "",
        isError: true,
        metadata: { error: "content 参数不能为空" },
      };
    }

    if (append && existsSync(filePath)) {
      // 追加模式
      const existingContent = await readFile(filePath, "utf-8");
      const newContent = `${existingContent}\n\n${content}`;
      await writeFile(filePath, newContent, "utf-8");

      return {
        content: `已追加内容到 ${MEMORY_FILE_DESCRIPTION[target]}`,
      };
    } else {
      // 覆盖模式
      await writeFile(filePath, content, "utf-8");

      return {
        content: `已更新 ${MEMORY_FILE_DESCRIPTION[target]}`,
      };
    }
  }

  /**
   * 处理搜索操作
   */
  private async handleSearch(params: MemoryToolParams): Promise<ToolResult> {
    const query = this.readStringParam(params, "query", { required: true });

    if (!query || query.trim().length === 0) {
      return {
        content: "",
        isError: true,
        metadata: { error: "搜索查询不能为空" },
      };
    }

    const results: string[] = [];
    const queryLower = query.toLowerCase();

    // 在所有记忆文件中搜索
    for (const [fileType, filePath] of Object.entries(MEMORY_FILE_MAP)) {
      if (!existsSync(filePath)) {
        continue;
      }

      try {
        const fileContent = await readFile(filePath, "utf-8");
        const lines = fileContent.split("\n");
        const matchingLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.toLowerCase().includes(queryLower)) {
            matchingLines.push(`L${i + 1}: ${lines[i]}`);
          }
        }

        if (matchingLines.length > 0) {
          results.push(
            `## ${MEMORY_FILE_DESCRIPTION[fileType as MemoryFileType]}\n${matchingLines.join("\n")}`
          );
        }
      } catch {
        // 忽略读取错误
      }
    }

    if (results.length === 0) {
      return {
        content: `未找到包含 "${query}" 的内容`,
      };
    }

    return {
      content: `搜索结果（查询: "${query}"）:\n\n${results.join("\n\n")}`,
    };
  }
}