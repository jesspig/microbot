import { join, basename } from 'path';
import { ExtensionWatcher, type FileChangeEvent } from './watcher';
import { ExtensionLoader } from './loader';
import { ExtensionRegistry } from './registry';
import type { HotPluggable, ExtensionMeta, ExtensionType } from './types';

/**
 * 热插拔管理器
 * 
 * 整合 Watcher、Loader、Registry，提供统一的热插拔管理接口。
 */
export class HotPlugManager {
  private watcher = new ExtensionWatcher();
  private loader = new ExtensionLoader();
  private registry = new ExtensionRegistry();
  private _running = false;

  constructor(
    private toolRegistry?: { register(tool: unknown): void; remove?(name: string): void },
    private channelRegistry?: { register(channel: unknown): void; remove?(name: string): void }
  ) {}

  /**
   * 启动监听
   * @param dirs - 监听目录列表
   */
  start(dirs: string[]): void {
    if (this._running) return;
    this._running = true;

    for (const dir of dirs) {
      this.watcher.start(dir);
    }

    this.watcher.onChange(this.handleChange.bind(this));
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    this.watcher.stop();
  }

  /**
   * 是否运行中
   */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * 手动加载扩展
   * @param path - 扩展文件路径
   */
  async load(path: string): Promise<ExtensionMeta | null> {
    const result = await this.loader.load(path);

    if (!result.success || !result.extension) {
      const meta: ExtensionMeta = {
        name: basename(path),
        type: 'tool',
        path,
        status: 'failed',
        error: result.error,
      };
      this.registry.register(meta);
      return meta;
    }

    const extension = result.extension;
    const meta: ExtensionMeta = {
      name: extension.name,
      type: extension.type,
      path,
      status: 'loaded',
      sdkVersion: extension.sdkVersion,
      loadedAt: new Date(),
    };

    this.registry.register(meta);
    this.registerExtension(extension);

    return meta;
  }

  /**
   * 卸载扩展
   * @param name - 扩展名称
   */
  async unload(name: string): Promise<void> {
    const meta = this.registry.get(name);
    if (!meta || meta.status !== 'loaded') return;

    // 从对应注册表移除
    this.unregisterExtension(meta.type, name);

    // 更新状态
    this.registry.updateStatus(name, 'unloaded');
  }

  /**
   * 重载扩展
   * @param name - 扩展名称
   */
  async reload(name: string): Promise<ExtensionMeta | null> {
    const meta = this.registry.get(name);
    if (!meta) return null;

    await this.unload(name);
    return this.load(meta.path);
  }

  /**
   * 获取所有扩展
   */
  getAll(): ExtensionMeta[] {
    return this.registry.getAll();
  }

  /**
   * 处理文件变更
   */
  private async handleChange(event: FileChangeEvent): Promise<void> {
    const fullPath = join(event.dir, event.filename);

    // 根据事件类型处理
    if (event.event === 'rename') {
      // 文件创建或删除
      await this.load(fullPath);
    } else if (event.event === 'change') {
      // 文件修改
      const meta = this.registry.getAll().find(m => m.path === fullPath);
      if (meta) {
        await this.reload(meta.name);
      }
    }
  }

  /**
   * 注册扩展到对应注册表
   */
  private registerExtension(extension: HotPluggable): void {
    switch (extension.type) {
      case 'tool':
        this.toolRegistry?.register(extension);
        break;
      case 'channel':
        this.channelRegistry?.register(extension);
        break;
      // skill 不需要注册，由 SkillsLoader 管理
    }
  }

  /**
   * 从对应注册表移除扩展
   */
  private unregisterExtension(type: ExtensionType, name: string): void {
    switch (type) {
      case 'tool':
        this.toolRegistry?.remove?.(name);
        break;
      case 'channel':
        this.channelRegistry?.remove?.(name);
        break;
    }
  }
}
