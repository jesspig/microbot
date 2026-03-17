/**
 * 系统提示词构建
 *
 * 构建分层系统提示词：
 * 1. 角色定义（AGENTS.md）
 * 2. 个性价值观（SOUL.md）
 * 3. 用户偏好（USER.md）
 * 4. 工具约束（TOOLS.md）
 * 5. 平台策略（动态注入）
 *
 * 设计原则：Agent 层不感知底层 LLM Provider
 */

import { platform } from "node:os";
import { promptsLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";

const logger = promptsLogger();

// ============================================================================
// 核心身份（不可配置）
// ============================================================================

/**
 * 核心身份声明
 *
 * 简洁的身份标识，在系统提示词最前面注入
 */
const CORE_IDENTITY = `You are MicroAgent, a helpful AI assistant.

## 工具调用强制要求

你必须使用工具来完成任务，禁止假装执行操作：

1. 当需要读取文件、列表目录、搜索内容时 → 调用相应工具（read_file、list_directory、search_file_content 等）
2. 当需要创建、修改、删除文件时 → 调用相应工具（write_file、replace 等）
3. 当需要执行命令时 → 调用 run_shell_command 工具
4. 当需要管理技能时 → 调用 skill_* 系列工具

禁止行为：
- 禁止输出"这是内容，您可以保存它"而不调用工具
- 禁止假装已执行操作而未调用工具
- 禁止编造本应通过工具获取的信息`;

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 系统提示词参数
 */
export interface SystemPromptParams {
  /** Agent 角色定义内容（AGENTS.md） */
  agentsContent: string;
  /** 个性/价值观内容（SOUL.md） */
  soulContent?: string;
  /** 用户偏好内容（USER.md） */
  userContent?: string;
  /** 工具使用指南内容（TOOLS.md） */
  toolsContent?: string;
  /** 长期记忆内容（MEMORY.md） */
  memoryContent?: string;
  /** 当前日期时间 */
  currentDate?: string;
  /** 渠道信息 */
  channelInfo?: string;
}

/**
 * 运行时上下文（注入用户消息）
 */
export interface RuntimeContext {
  /** 当前日期时间 */
  currentDate: string;
  /** 时区 */
  timezone: string;
  /** 渠道信息（可选） */
  channel?: string;
  /** 聊天 ID（可选） */
  chatId?: string;
  /** 平台信息 */
  platform: string;
  /** workspace 路径（可选） */
  workspacePath?: string;
}

/**
 * 构建后的系统提示词
 */
export interface BuiltSystemPrompt {
  /** 完整的系统提示词 */
  prompt: string;
  /** 提示词总字符数 */
  length: number;
  /** 包含的各个部分 */
  sections: string[];
}

// ============================================================================
// 平台策略
// ============================================================================

/**
 * 获取平台特定策略
 */
function getPlatformPolicy(): string {
  const system = platform();

  if (system === "win32") {
    return `## 平台策略 (Windows)

- 不要假设存在 GNU 工具（如 grep、sed、awk）
- 优先使用 Windows 原生命令或 Bun API
- PowerShell 5.1 不支持 \`&&\` 和 \`||\`，使用 \`if($?) {}\` 替代
- 路径使用反斜杠 \`\\\`，但大多数工具也接受正斜杠 \`/\``;
  }

  return `## 平台策略 (POSIX)

- 优先使用 UTF-8 编码和标准 shell 工具
- 路径使用正斜杠 \`/\``;
}

// ============================================================================
// 核心工具摘要
// ============================================================================

/**
 * 核心工具描述摘要
 * 
 * 用于在系统提示词中预定义常用工具的描述
 * 减少外部工具注入的上下文开销
 */
const CORE_TOOL_SUMMARIES = `
### 文件操作
- read_file: 读取文件内容，支持分页读取
- write_file: 创建或覆盖文件
- replace: 精确替换文件中的文本内容
- list_directory: 列出目录内容
- glob: 按模式搜索文件

### 命令执行
- run_shell_command: 在沙箱环境中执行 shell 命令

### 搜索与检索
- search_file_content: 使用正则表达式搜索文件内容
- web_search: 网络搜索获取最新信息
- web_fetch: 获取网页内容

### 技能管理
- skill_list: 列出所有可用技能
- skill_search: 按关键词搜索技能
- skill_read: 读取技能文件内容
- skill_create: 创建新技能（必须调用此工具创建，而不是直接输出内容）
- skill_delete: 删除技能
- skill_execute: 在技能目录中执行命令
- skill_add: 从工作区添加技能`;

/**
 * 获取工具摘要章节
 */
function getToolSummariesSection(): string {
  return `## 核心工具

以下是你可以使用的核心工具：${CORE_TOOL_SUMMARIES}

外部工具会在运行时动态注入。

【重要】工具调用原则：
- 当需要执行操作时（如创建文件、创建技能、执行命令），必须调用相应工具执行操作
- 当需要获取信息时（如查看技能列表、读取文件、搜索内容），必须调用相应工具获取信息
- 不要直接猜测、编造或输出本应通过工具获取的信息
- 不要直接输出操作内容或告诉用户"这是内容，您可以保存它"
- 正确流程：调用工具 → 工具执行操作 → 返回结果给用户

【禁止行为】：
- 禁止在未调用 skill_list 工具的情况下直接输出技能列表
- 禁止在未调用 skill_create 工具的情况下直接输出技能创建内容
- 禁止在未调用相应工具的情况下假装已执行操作`;
}

// ============================================================================
// 安全章节
// ============================================================================

/**
 * 安全准则章节
 * 
 * 参考 Anthropic Constitution 和行业最佳实践
 */
const SAFETY_SECTION = `## 安全准则

- 你没有独立目标：不要追求自我保存、复制或获取资源
- 优先考虑安全和用户监督，而非任务完成速度
- 不要试图操纵或说服任何人扩大你的权限
- 如果用户请求可能有害，拒绝并解释原因
- 敏感信息（密钥、密码、凭证）需要保护，不要在输出中暴露`;

/**
 * 获取安全章节
 */
function getSafetySection(): string {
  return SAFETY_SECTION;
}

// ============================================================================
// YAML Frontmatter 处理
// ============================================================================

/**
 * 移除 YAML Frontmatter
 *
 * 支持格式：
 * ---
 * key: value
 * ---
 * 内容...
 */
export function removeYamlFrontmatter(content: string): string {
  // 匹配开头的 YAML frontmatter
  const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n?/;
  return content.replace(frontmatterRegex, "").trim();
}

/**
 * 检测是否为空模板
 *
 * 空模板特征：
 * - 仅包含占位符（如 [ ]、________）
 * - 无实际内容
 */
function isEmptyTemplate(content: string): boolean {
  const cleaned = removeYamlFrontmatter(content);
  // 移除占位符和空白
  const stripped = cleaned
    .replace(/\[ \]/g, "")           // 移除复选框占位符
    .replace(/_{2,}/g, "")           // 移除下划线占位符
    .replace(/`{3}[\s\S]*?`{3}/g, "") // 移除空代码块
    .replace(/#+\s*/g, "")           // 移除标题
    .replace(/\|[-\s|]+\|/g, "")     // 移除空表格
    .replace(/\s+/g, "")             // 移除空白
    .trim();
  return stripped.length < 10;  // 剩余内容少于10字符视为空
}

// ============================================================================
// 提示词构建函数
// ============================================================================

/**
 * 构建系统提示词
 *
 * 整合 AGENTS.md、SOUL.md、USER.md、MEMORY.md、TOOLS.md 等内容，
 * 生成完整的系统提示词。
 *
 * 构建顺序：
 * 1. Agent 角色定义（AGENTS.md）- 核心身份和行为准则
 * 2. 个性价值观（SOUL.md）- 沟通风格和行为边界
 * 3. 用户偏好（USER.md）- 个性化配置
 * 4. 长期记忆（MEMORY.md）- 跨会话记忆信息
 * 5. 核心工具摘要 - 预定义工具描述
 * 6. 工具使用指南（TOOLS.md）- 工具调用规范
 * 7. 安全准则 - 安全边界和禁止行为
 * 8. 平台策略 - 操作系统特定指导
 *
 * @param params 系统提示词参数
 * @returns 构建后的系统提示词
 */
export function buildSystemPrompt(params: SystemPromptParams): BuiltSystemPrompt {
  const timer = createTimer();
  logMethodCall(logger, {
    method: "buildSystemPrompt",
    module: "system-prompt",
    params: {
      hasAgentsContent: !!params.agentsContent,
      hasSoulContent: !!params.soulContent,
      hasUserContent: !!params.userContent,
      hasToolsContent: !!params.toolsContent,
      hasMemoryContent: !!params.memoryContent,
      hasCurrentDate: !!params.currentDate,
    },
  });

  try {
    const sections: string[] = [];

    // 0. 注入核心身份（不可配置）
    sections.push(CORE_IDENTITY);

    // 1. 添加 Agent 角色定义（核心）
    const agentsContent = removeYamlFrontmatter(params.agentsContent);
    if (agentsContent.trim()) {
      sections.push(agentsContent);
    }

    // 2. 添加个性/价值观（可选）
    if (params.soulContent?.trim()) {
      const soulContent = removeYamlFrontmatter(params.soulContent);
      sections.push(formatSection("个性与价值观", soulContent));
    }

    // 3. 添加用户偏好（可选，跳过空模板）
    if (params.userContent?.trim() && !isEmptyTemplate(params.userContent)) {
      const userContent = removeYamlFrontmatter(params.userContent);
      if (userContent.trim()) {
        sections.push(formatSection("用户偏好", userContent));
      }
    }

    // 4. 添加长期记忆（可选，跳过空模板）
    if (params.memoryContent?.trim() && !isEmptyTemplate(params.memoryContent)) {
      const memoryContent = removeYamlFrontmatter(params.memoryContent);
      if (memoryContent.trim()) {
        sections.push(formatSection("长期记忆", memoryContent));
      }
    }

    // 5. 添加核心工具摘要
    sections.push(getToolSummariesSection());

    // 5. 添加工具使用指南（可选）
    if (params.toolsContent?.trim()) {
      const toolsContent = removeYamlFrontmatter(params.toolsContent);
      sections.push(formatSection("工具使用指南", toolsContent));
    }

    // 7. 添加安全准则
    sections.push(getSafetySection());

    // 8. 添加平台策略
    sections.push(getPlatformPolicy());

    const prompt = sections.join("\n\n---\n\n");

    const result: BuiltSystemPrompt = {
      prompt,
      length: prompt.length,
      sections: sections.map((_, i) => `Section ${i + 1}`),
    };

    logMethodReturn(logger, {
      method: "buildSystemPrompt",
      module: "system-prompt",
      result: { length: result.length, sectionCount: result.sections.length },
      duration: timer(),
    });
    return result;
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "buildSystemPrompt",
      module: "system-prompt",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      },
      params: {},
      duration: timer(),
    });
    throw error;
  }
}

/**
 * 构建运行时上下文
 *
 * 此内容应注入用户消息，而非系统提示词
 * 以提高缓存命中率
 */
export function buildRuntimeContext(ctx: Partial<RuntimeContext>): string {
  const lines: string[] = ["[运行时上下文 — 仅元数据，非指令]"];

  // 时间信息
  const now = new Date();
  const dateStr = ctx.currentDate ?? now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const timezone = ctx.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  lines.push(`当前时间: ${dateStr} (${timezone})`);

  // 渠道信息
  if (ctx.channel) {
    lines.push(`渠道: ${ctx.channel}`);
  }
  if (ctx.chatId) {
    lines.push(`聊天 ID: ${ctx.chatId}`);
  }

  // 平台信息
  lines.push(`平台: ${ctx.platform ?? platform()}`);

  // 工作目录
  if (ctx.workspacePath) {
    lines.push(`工作目录: ${ctx.workspacePath}`);
  }

  return lines.join("\n");
}

/**
 * 构建简化版系统提示词
 *
 * 仅包含核心角色定义
 */
export function buildSimpleSystemPrompt(agentsContent: string): string {
  const timer = createTimer();
  logMethodCall(logger, {
    method: "buildSimpleSystemPrompt",
    module: "system-prompt",
    params: { contentLength: agentsContent.length },
  });

  try {
    const result = removeYamlFrontmatter(agentsContent);
    logMethodReturn(logger, {
      method: "buildSimpleSystemPrompt",
      module: "system-prompt",
      result: { length: result.length },
      duration: timer(),
    });
    return result;
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "buildSimpleSystemPrompt",
      module: "system-prompt",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      },
      params: { contentLength: agentsContent.length },
      duration: timer(),
    });
    throw error;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化提示词区块
 */
function formatSection(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}`;
}

/**
 * 获取当前日期时间字符串
 */
export function getCurrentDateString(): string {
  const timer = createTimer();
  logMethodCall(logger, { method: "getCurrentDateString", module: "system-prompt", params: {} });

  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    };
    const result = now.toLocaleDateString("zh-CN", options);
    logMethodReturn(logger, {
      method: "getCurrentDateString",
      module: "system-prompt",
      result,
      duration: timer(),
    });
    return result;
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "getCurrentDateString",
      module: "system-prompt",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      },
      params: {},
      duration: timer(),
    });
    throw error;
  }
}

/**
 * 估算提示词 token 数量
 */
export function estimateTokenCount(text: string): number {
  const timer = createTimer();
  logMethodCall(logger, {
    method: "estimateTokenCount",
    module: "system-prompt",
    params: { textLength: text.length },
  });

  try {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    const result = Math.ceil(chineseChars / 1.5 + otherChars / 4);
    logMethodReturn(logger, {
      method: "estimateTokenCount",
      module: "system-prompt",
      result: { tokenCount: result, chineseChars, otherChars },
      duration: timer(),
    });
    return result;
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "estimateTokenCount",
      module: "system-prompt",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      },
      params: { textLength: text.length },
      duration: timer(),
    });
    throw error;
  }
}