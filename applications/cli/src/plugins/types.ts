/**
 * 用户插件类型定义
 *
 * 功能性扩展插件，不是 tool/channel/skills 组件
 */

/**
 * 用户插件定义
 */
export interface UserPlugin {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 插件入口函数 */
  activate: (context: PluginContext) => Promise<void> | void;
  /** 插件销毁函数 */
  deactivate?: () => Promise<void> | void;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  /** 插件所在目录 */
  pluginDir: string;
  /** 用户主目录 */
  homeDir: string;
  /** 工作区目录 */
  workspace: string;
  /** 注册命令 */
  registerCommand: (command: PluginCommand) => void;
  /** 注册钩子 */
  registerHook: (hook: PluginHook) => void;
  /** 日志输出 */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * 插件命令
 */
export interface PluginCommand {
  id: string;
  name: string;
  description?: string;
  handler: (args: string[]) => Promise<void> | void;
}

/**
 * 插件钩子
 */
export interface PluginHook {
  event: string;
  handler: (data: unknown) => Promise<void> | void;
}

/**
 * 插件清单
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  main: string;
  commands?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  hooks?: string[];
}
