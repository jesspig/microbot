/**
 * 插件注册表
 *
 * 管理已加载的插件、命令和钩子
 */

import type { UserPlugin, PluginCommand, PluginHook } from './types';

/**
 * 插件注册表
 */
class PluginRegistry {
  private plugins = new Map<string, UserPlugin>();
  private commands = new Map<string, PluginCommand>();
  private hooks = new Map<string, PluginHook[]>();

  /**
   * 注册插件
   */
  register(plugin: UserPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * 注销插件
   */
  unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  /**
   * 获取插件
   */
  get(pluginId: string): UserPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有插件
   */
  getAll(): UserPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 注册命令
   */
  registerCommand(command: PluginCommand): void {
    this.commands.set(command.id, command);
  }

  /**
   * 获取命令
   */
  getCommand(commandId: string): PluginCommand | undefined {
    return this.commands.get(commandId);
  }

  /**
   * 获取所有命令
   */
  getCommands(): PluginCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * 注册钩子
   */
  registerHook(hook: PluginHook): void {
    const hooks = this.hooks.get(hook.event) || [];
    hooks.push(hook);
    this.hooks.set(hook.event, hooks);
  }

  /**
   * 触发事件
   */
  async emit(event: string, data: unknown): Promise<void> {
    const hooks = this.hooks.get(event) || [];
    for (const hook of hooks) {
      await hook.handler(data);
    }
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.plugins.clear();
    this.commands.clear();
    this.hooks.clear();
  }
}

/** 全局插件注册表实例 */
export const pluginRegistry = new PluginRegistry();
