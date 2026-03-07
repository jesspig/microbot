/**
 * 热重载支持
 *
 * 监听扩展目录变化，实现优雅重载
 */

import { resolve } from 'path';
import { getLogger } from '@logtape/logtape';
import type { ExtensionType } from './types';
import { ExtensionLoader } from './loader';

const log = getLogger(['extension', 'hot-reload']);

/** 热重载配置 */
export interface HotReloadConfig {
  /** 是否启用热重载 */
  enabled: boolean;
  /** 防抖延迟（毫秒） */
  debounceMs: number;
  /** 等待当前调用完成的超时时间（毫秒） */
  gracefulTimeout: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: HotReloadConfig = {
  enabled: true,
  debounceMs: 1000,
  gracefulTimeout: 30000,
};

/** 变更队列项 */
interface PendingChange {
  type: 'add' | 'change' | 'delete';
  path: string;
  timestamp: number;
}

/**
 * 热重载管理器
 */
export class HotReloadManager {
  private config: HotReloadConfig;
  private loader: ExtensionLoader;
  private watchers: { path: string; watcher: ReturnType<typeof Bun.file> }[] = [];
  private pendingChanges = new Map<string, PendingChange>();
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private activeCalls = 0;
  private isReloading = false;

  constructor(loader: ExtensionLoader, config?: Partial<HotReloadConfig>) {
    this.loader = loader;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动监听
   */
  start(paths: string[]): void {
    if (!this.config.enabled) {
      log.debug('热重载未启用');
      return;
    }

    for (const path of paths) {
      this.watchPath(path);
    }

    log.info('热重载已启动，监听 {count} 个路径', { count: paths.length });
  }

  /**
   * 停止监听
   */
  stop(): void {
    this.watchers = [];

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    log.info('热重载已停止');
  }

  /**
   * 标记调用开始
   */
  beginCall(): void {
    this.activeCalls++;
  }

  /**
   * 标记调用结束
   */
  endCall(): void {
    this.activeCalls--;

    if (this.pendingChanges.size > 0 && this.activeCalls === 0 && !this.isReloading) {
      this.processPendingChanges();
    }
  }

  /**
   * 监听路径
   */
  private watchPath(path: string): void {
    const absolutePath = resolve(path);
    
    // 使用 Bun 的文件监听
    // 注意：Bun 没有内置的文件监听 API，这里使用轮询作为替代
    // 在生产环境中，可以考虑使用 fs.watch 或其他库
    this.watchers.push({ path: absolutePath, watcher: Bun.file(absolutePath) });
    
    // 简单实现：定期检查文件变更
    const checkInterval = setInterval(() => {
      this.checkForChanges(absolutePath);
    }, this.config.debounceMs);

    // 存储定时器引用以便清理
    (this.watchers[this.watchers.length - 1] as { path: string; watcher: ReturnType<typeof Bun.file>; interval?: ReturnType<typeof setInterval> }).interval = checkInterval;
  }

  /**
   * 检查文件变更
   */
  private async checkForChanges(path: string): Promise<void> {
    // 简单实现：实际项目中应该使用更精确的文件监听机制
    // 这里只是占位符，真正的实现需要比较文件的 mtime 或 hash
    log.debug('检查路径变更: {path}', { path });
  }

  /**
   * 处理文件变更
   */
  private handleChange(event: 'add' | 'change' | 'delete', path: string): void {
    this.pendingChanges.set(path, {
      type: event,
      path,
      timestamp: Date.now(),
    });

    this.scheduleProcess();
  }

  /**
   * 调度变更处理
   */
  private scheduleProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, this.config.debounceMs);
  }

  /**
   * 处理待处理的变更
   */
  private async processPendingChanges(): Promise<void> {
    if (this.pendingChanges.size === 0 || this.isReloading) return;

    if (this.activeCalls > 0) {
      log.debug('等待 {count} 个活动调用完成', { count: this.activeCalls });
      await this.waitForGracefulShutdown();
    }

    this.isReloading = true;

    try {
      const changesByExtension = this.groupChangesByExtension();

      for (const [extensionId, changes] of changesByExtension) {
        const latestChange = changes.sort((a, b) => b.timestamp - a.timestamp)[0];

        log.info('热重载扩展: {id} ({type})', {
          id: extensionId,
          type: latestChange.type,
        });

        if (latestChange.type === 'delete') {
          await this.loader.unloadExtension(extensionId);
        } else {
          await this.loader.reloadExtension(extensionId);
        }
      }

      this.pendingChanges.clear();
    } finally {
      this.isReloading = false;
    }
  }

  /**
   * 等待优雅关闭
   */
  private async waitForGracefulShutdown(): Promise<void> {
    const startTime = Date.now();

    while (this.activeCalls > 0) {
      if (Date.now() - startTime > this.config.gracefulTimeout) {
        log.warn('等待超时，强制重载');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 按扩展分组变更
   */
  private groupChangesByExtension(): Map<string, PendingChange[]> {
    const groups = new Map<string, PendingChange[]>();

    for (const change of this.pendingChanges.values()) {
      const extensionId = this.extractExtensionId(change.path);

      if (!groups.has(extensionId)) {
        groups.set(extensionId, []);
      }
      groups.get(extensionId)!.push(change);
    }

    return groups;
  }

  /**
   * 提取扩展 ID
   */
  private extractExtensionId(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 2] ?? parts[parts.length - 1];
  }
}

/**
 * 创建热重载管理器
 */
export function createHotReloadManager(loader: ExtensionLoader, config?: Partial<HotReloadConfig>): HotReloadManager {
  return new HotReloadManager(loader, config);
}
