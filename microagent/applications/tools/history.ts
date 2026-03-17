/**
 * 历史记录搜索工具
 *
 * 用于搜索 history/*.md 文件中的历史记录
 *
 * 支持操作：
 * - search: 按关键词或正则搜索历史记录
 * - list: 列出指定日期范围内的历史文件
 * - read: 读取指定日期的历史记录
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BaseTool } from "../../runtime/tool/base.js";
import type { ToolParameterSchema, ToolResult } from "../../runtime/tool/types.js";
import { HISTORY_DIR } from "../shared/constants.js";
import {
  toolsLogger,
  createTimer,
  logMethodCall,
  logMethodReturn,
  logMethodError,
  sanitize,
} from "../shared/logger.js";

const MODULE_NAME = "history";
const logger = toolsLogger();

// ============================================================================
// 类型定义
// ============================================================================

/** 工具参数类型 */
interface HistoryToolParams extends Record<string, unknown> {
  /** 操作类型 */
  action: "search" | "list" | "read";
  /** 搜索查询（search 操作） */
  query?: string;
  /** 是否使用正则表达式（search 操作） */
  useRegex?: boolean;
  /** 日期范围开始（search/list 操作） */
  dateFrom?: string;
  /** 日期范围结束（search/list 操作） */
  dateTo?: string;
  /** 指定日期（read 操作） */
  date?: string;
  /** 返回结果数量限制 */
  limit?: number;
}

/** 搜索结果项 */
interface SearchResult {
  /** 文件名 */
  file: string;
  /** 匹配行号 */
  line?: number;
  /** 匹配内容 */
  content: string;
}

// ============================================================================
// 历史记录搜索工具实现
// ============================================================================

/**
 * 历史记录搜索工具
 *
 * 提供对历史记录文件的搜索和读取功能
 */
export class HistoryTool extends BaseTool<HistoryToolParams> {
  readonly name = "history";
  readonly description = `历史记录搜索工具，用于搜索和读取历史记录。

历史记录存储在 ~/.micro-agent/history/YYYY-MM-DD.md 文件中。

支持的操作：
- search: 按关键词或正则表达式搜索历史记录
- list: 列出指定日期范围内的历史文件
- read: 读取指定日期的完整历史记录

日期格式：YYYY-MM-DD（如 2026-03-16）`;

  readonly parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["search", "list", "read"],
        description: "操作类型：search（搜索）、list（列表）、read（读取）",
      },
      query: {
        type: "string",
        description: "搜索查询（search 操作必需）",
      },
      useRegex: {
        type: "boolean",
        description: "是否使用正则表达式（默认 false，使用字符串匹配）",
      },
      dateFrom: {
        type: "string",
        description: "日期范围开始（格式：YYYY-MM-DD）",
      },
      dateTo: {
        type: "string",
        description: "日期范围结束（格式：YYYY-MM-DD）",
      },
      date: {
        type: "string",
        description: "指定日期（read 操作，格式：YYYY-MM-DD）",
      },
      limit: {
        type: "number",
        description: "返回结果数量限制（默认 20）",
      },
    },
    required: ["action"],
  };

  /**
   * 执行工具
   */
  async execute(params: HistoryToolParams): Promise<ToolResult> {
    const timer = createTimer();
    logMethodCall(logger, {
      method: "execute",
      module: MODULE_NAME,
      params: sanitize({
        action: params.action,
        hasQuery: !!params.query,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        date: params.date,
        limit: params.limit,
      }) as Record<string, unknown>,
    });

    try {
      const action = this.readStringParam(params, "action", {
        required: true,
      }) as "search" | "list" | "read";

      let result: ToolResult;

      switch (action) {
        case "search":
          result = await this.handleSearch(params);
          break;
        case "list":
          result = await this.handleList(params);
          break;
        case "read":
          result = await this.handleRead(params);
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
   * 处理搜索操作
   */
  private async handleSearch(params: HistoryToolParams): Promise<ToolResult> {
    const query = this.readStringParam(params, "query", { required: true });
    const useRegex = this.readBooleanParam(params, "useRegex");
    const dateFrom = this.readStringParam(params, "dateFrom");
    const dateTo = this.readStringParam(params, "dateTo");
    const limit = this.readNumberParam(params, "limit") ?? 20;

    if (!query) {
      return {
        content: "",
        isError: true,
        metadata: { error: "搜索查询不能为空" },
      };
    }

    // 获取要搜索的文件列表
    const files = await this.getHistoryFiles(dateFrom, dateTo);

    if (files.length === 0) {
      return {
        content: "没有找到历史记录文件",
      };
    }

    // 编译正则表达式（如果需要）
    let regex: RegExp | null = null;
    if (useRegex) {
      try {
        regex = new RegExp(query, "gi");
      } catch {
        return {
          content: "",
          isError: true,
          metadata: { error: `无效的正则表达式: ${query}` },
        };
      }
    }

    // 搜索文件
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const file of files) {
      const filePath = join(HISTORY_DIR, file);
      if (!existsSync(filePath)) continue;

      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;

          let isMatch = false;
          if (regex) {
            isMatch = regex.test(line);
          } else {
            isMatch = line.toLowerCase().includes(queryLower);
          }

          if (isMatch) {
            results.push({
              file,
              line: i + 1,
              content: line.trim(),
            });

            if (results.length >= limit) break;
          }
        }

        if (results.length >= limit) break;
      } catch {
        // 忽略读取错误
      }
    }

    if (results.length === 0) {
      return {
        content: `未找到包含 "${query}" 的历史记录`,
      };
    }

    // 格式化输出
    const output = results
      .map((r) => {
        const location = r.line ? `:${r.line}` : "";
        return `**${r.file}${location}**\n${r.content}`;
      })
      .join("\n\n");

    return {
      content: `找到 ${results.length} 条匹配结果:\n\n${output}`,
      metadata: { count: results.length, query },
    };
  }

  /**
   * 处理列表操作
   */
  private async handleList(params: HistoryToolParams): Promise<ToolResult> {
    const dateFrom = this.readStringParam(params, "dateFrom");
    const dateTo = this.readStringParam(params, "dateTo");

    const files = await this.getHistoryFiles(dateFrom, dateTo);

    if (files.length === 0) {
      return {
        content: "没有找到历史记录文件",
      };
    }

    return {
      content: `历史记录文件 (${files.length} 个):\n\n${files.map((f) => `- ${f}`).join("\n")}`,
      metadata: { count: files.length },
    };
  }

  /**
   * 处理读取操作
   */
  private async handleRead(params: HistoryToolParams): Promise<ToolResult> {
    const date = this.readStringParam(params, "date", { required: true });

    if (!date) {
      return {
        content: "",
        isError: true,
        metadata: { error: "日期参数不能为空" },
      };
    }

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        content: "",
        isError: true,
        metadata: { error: `日期格式错误，应为 YYYY-MM-DD: ${date}` },
      };
    }

    const filePath = join(HISTORY_DIR, `${date}.md`);

    if (!existsSync(filePath)) {
      return {
        content: "",
        isError: true,
        metadata: { error: `历史记录不存在: ${date}` },
      };
    }

    const content = await readFile(filePath, "utf-8");

    return {
      content,
      metadata: { date },
    };
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 获取历史文件列表
   * @param dateFrom 开始日期
   * @param dateTo 结束日期
   */
  private async getHistoryFiles(
    dateFrom?: string,
    dateTo?: string,
  ): Promise<string[]> {
    if (!existsSync(HISTORY_DIR)) {
      return [];
    }

    const files = await readdir(HISTORY_DIR);

    // 过滤 .md 文件
    let historyFiles = files.filter(
      (f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f),
    );

    // 按日期范围过滤
    if (dateFrom) {
      historyFiles = historyFiles.filter((f) => f >= `${dateFrom}.md`);
    }
    if (dateTo) {
      historyFiles = historyFiles.filter((f) => f <= `${dateTo}.md`);
    }

    // 按日期降序排列（最新的在前）
    historyFiles.sort((a, b) => b.localeCompare(a));

    return historyFiles;
  }
}
