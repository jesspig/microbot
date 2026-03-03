/**
 * ReAct 类型定义和解析器
 */

import { z } from 'zod';

/**
 * 动作别名配置
 */
export interface ActionAliasConfig {
  /** 标准动作名称 */
  action: string;
  /** 别名列表 */
  aliases: string[];
}

/**
 * ReAct 动作注册表
 *
 * 管理动作别名和工具映射，支持动态注册
 */
export class ReActRegistry {
  /** 动作别名映射（别名 -> 标准动作） */
  private actionAliases = new Map<string, string>();

  /** 工具名称到 ReAct 动作的映射 */
  private toolToAction = new Map<string, string>();

  /** ReAct 动作到工具名称的映射 */
  private actionToTool = new Map<string, string | null>();

  /**
   * 注册动作别名
   * @param config - 别名配置
   */
  registerAlias(config: ActionAliasConfig): void {
    // 注册标准动作自身
    this.actionAliases.set(config.action.toLowerCase(), config.action);
    // 注册所有别名
    for (const alias of config.aliases) {
      this.actionAliases.set(alias.toLowerCase(), config.action);
    }
  }

  /**
   * 注册工具与动作的映射
   * @param toolName - 工具名称
   * @param action - ReAct 动作名称
   */
  registerToolMapping(toolName: string, action: string): void {
    this.toolToAction.set(toolName, action);
    this.actionToTool.set(action, toolName);
  }

  /**
   * 注册完成动作（无对应工具）
   * @param action - 完成动作名称
   * @param aliases - 别名列表
   */
  registerFinishAction(action: string, aliases: string[] = []): void {
    this.registerAlias({ action, aliases });
    this.actionToTool.set(action, null);
  }

  /**
   * 标准化动作名称
   * @param action - 原始动作名称
   * @returns 标准化的动作名称
   */
  normalizeAction(action: string): string {
    const lowerAction = action.toLowerCase().trim();
    return this.actionAliases.get(lowerAction) ?? action;
  }

  /**
   * 获取工具名称
   * @param action - ReAct 动作
   * @returns 工具名称，完成动作返回 null，未注册动作返回原值
   */
  getToolName(action: string): string | null {
    if (this.actionToTool.has(action)) {
      return this.actionToTool.get(action)!;
    }
    return action;
  }

  /**
   * 获取动作名称
   * @param toolName - 工具名称
   * @returns ReAct 动作名称
   */
  getActionName(toolName: string): string | undefined {
    return this.toolToAction.get(toolName);
  }

  /**
   * 检查是否为已注册的动作
   * @param action - 动作名称
   */
  isRegisteredAction(action: string): boolean {
    return this.actionAliases.has(action.toLowerCase());
  }

  /**
   * 获取所有已注册的动作
   */
  getRegisteredActions(): string[] {
    const actions = new Set(this.actionAliases.values());
    return Array.from(actions);
  }
}

/** 全局 ReAct 注册表实例 */
export const reactRegistry = new ReActRegistry();

/** 预定义动作类型（向后兼容） */
export type PredefinedAction = string;

/**
 * ReAct 动作类型（支持动态工具名称）
 */
export type ReActAction = string;

/**
 * ReAct 响应 Schema
 * action 支持任意字符串，允许动态工具调用
 */
export const ReActResponseSchema = z.object({
  /** 思考过程 */
  thought: z.string().describe('分析当前情况，思考下一步该做什么'),
  /** 动作类型（支持动态工具名称） */
  action: z.string().min(1).describe('要执行的动作或工具名称'),
  /** 动作参数 */
  action_input: z.union([
    z.string(),
    z.object({}).passthrough(),
    z.null(),
  ]).describe('动作的输入参数'),
});

/**
 * ReAct 响应类型
 */
export type ReActResponse = z.infer<typeof ReActResponseSchema>;

/**
 * 解析 LLM 响应为 ReAct 格式
 * 
 * 支持预定义动作和动态工具名称
 */
const MAX_RESPONSE_LENGTH = 10000; // 最大响应长度，超过则拒绝处理

export function parseReActResponse(content: string): ReActResponse | null {
  // 检查响应长度，防止 LLM 输出异常（大量重复文本）
  if (content.length > MAX_RESPONSE_LENGTH) {
    logDebug('响应过长，跳过解析', { length: content.length, preview: content.slice(0, 200) });
    return null;
  }

  // 尝试提取 JSON（可能被 markdown 代码块包裹）
  let jsonStr: string | null = null;

  // 尝试提取 ```json ... ``` 中的内容
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  } else {
    // 尝试直接匹配 JSON 对象
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
  }

  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    
    // 验证必需字段存在
    if (typeof parsed.thought !== 'string') {
      logDebug('缺少 thought 字段', parsed);
      return null;
    }
    if (parsed.action === undefined || parsed.action === null) {
      logDebug('缺少 action 字段', parsed);
      return null;
    }
    
    // 处理 action 字段异常格式
    let normalizedAction: string | null = null;
    const originalAction = parsed.action;
    
    // 如果 action 是对象（如 {"type": "read_file", "path": {...}}），提取 type
    if (typeof originalAction === 'object' && originalAction !== null && 'type' in originalAction) {
      normalizedAction = String((originalAction as Record<string, unknown>).type).toLowerCase().trim();
    } else if (typeof originalAction === 'string') {
      const actionStr = originalAction.toLowerCase().trim();
      // 如果是空字符串，尝试从 thought 推断
      if (!actionStr) {
        logDebug('action 为空，尝试从 thought 推断', parsed);
        // 简单推断：如果 thought 包含关键词
        normalizedAction = inferActionFromThought(parsed.thought);
        if (!normalizedAction) {
          logDebug('无法推断 action', parsed);
          return null;
        }
      } else {
        normalizedAction = actionStr;
      }
    } else {
      logDebug('action 字段类型异常', typeof originalAction);
      return null;
    }
    
    if (!normalizedAction) {
      logDebug('normalizedAction 为空', parsed);
      return null;
    }
    
    // 使用注册表标准化动作
    const finalAction = reactRegistry.normalizeAction(normalizedAction);
    
    // 处理 action_input 异常格式
    let normalizedInput: string | Record<string, unknown> | null = parsed.action_input ?? null;
    
    // 如果 action_input 是对象且包含 value 字段（如 {value: "路径"}），提取 value
    if (typeof normalizedInput === 'object' && normalizedInput !== null && 'value' in normalizedInput) {
      normalizedInput = (normalizedInput as Record<string, unknown>).value as string;
    }
    
    const normalized = {
      thought: parsed.thought,
      action: finalAction,
      action_input: normalizedInput,
    };
    
    const result = ReActResponseSchema.safeParse(normalized);
    if (result.success) {
      return result.data;
    }
    logDebug('ReAct 解析失败', result.error);
  } catch (e) {
    logDebug('JSON 解析失败', e);
  }

  return null;
}

/**
 * 从 thought 推断动作
 */
function inferActionFromThought(thought: string): string | null {
  const lowerThought = thought.toLowerCase();
  if (lowerThought.includes('read') || lowerThought.includes('读取')) {
    return 'read_file';
  } else if (lowerThought.includes('write') || lowerThought.includes('写入') || lowerThought.includes('创建')) {
    return 'write_file';
  } else if (lowerThought.includes('shell') || lowerThought.includes('命令') || lowerThought.includes('执行')) {
    return 'shell_exec';
  } else if (lowerThought.includes('finish') || lowerThought.includes('完成') || lowerThought.includes('回复')) {
    return 'finish';
  }
  return null;
}

/**
 * 调试日志（仅在开发环境输出）
 */
function logDebug(message: string, data: unknown): void {
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[ReAct] ${message}`, data);
  }
}

/**
 * 注册内置动作别名
 */
function registerBuiltinAliases(): void {
  // finish 动作
  reactRegistry.registerFinishAction('finish', ['done', 'complete', 'answer', 'reply']);
  
  // 文件操作
  reactRegistry.registerAlias({ action: 'read_file', aliases: ['read', 'cat', 'file_read'] });
  reactRegistry.registerAlias({ action: 'write_file', aliases: ['write', 'save', 'file_write'] });
  reactRegistry.registerAlias({ action: 'list_dir', aliases: ['ls', 'dir', 'list', 'list_directory'] });
  
  // Shell 执行
  reactRegistry.registerAlias({ action: 'shell_exec', aliases: ['shell', 'exec', 'execute', 'run', 'command', 'bash'] });
  
  // 网络
  reactRegistry.registerAlias({ action: 'web_fetch', aliases: ['fetch', 'http', 'get', 'curl'] });
  
  // 消息
  reactRegistry.registerAlias({ action: 'send_message', aliases: ['message', 'send', 'say'] });

  // 工具映射
  reactRegistry.registerToolMapping('read_file', 'read_file');
  reactRegistry.registerToolMapping('write_file', 'write_file');
  reactRegistry.registerToolMapping('list_dir', 'list_dir');
  reactRegistry.registerToolMapping('exec', 'shell_exec');
  reactRegistry.registerToolMapping('web_fetch', 'web_fetch');
  reactRegistry.registerToolMapping('message', 'send_message');
}

// 初始化内置别名
registerBuiltinAliases();

/**
 * 预定义动作列表（向后兼容，动态生成）
 */
export const PredefinedActions = reactRegistry.getRegisteredActions();

/**
 * 工具名称到 ReAct 动作的映射（向后兼容）
 */
export const ToolToReActAction: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_, prop: string) {
    return reactRegistry.getActionName(prop);
  },
});

/**
 * ReAct 动作到工具名称的映射（向后兼容）
 */
export const ReActActionToTool: Record<string, string | null> = new Proxy({} as Record<string, string | null>, {
  get(_, prop: string) {
    return reactRegistry.getToolName(prop);
  },
});
