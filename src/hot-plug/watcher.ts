import { watch, type FSWatcher } from 'fs';
import { dirname, join } from 'path';

/** 文件变更事件 */
export interface FileChangeEvent {
  /** 事件类型 */
  event: 'rename' | 'change';
  /** 文件名 */
  filename: string;
  /** 目录路径 */
  dir: string;
}

/** 文件变更回调 */
export type FileChangeCallback = (event: FileChangeEvent) => void;

/**
 * 扩展监听器
 * 
 * 使用 fs.watch 实现递归目录监听。
 */
export class ExtensionWatcher {
  private watcher: FSWatcher | null = null;
  private callbacks = new Set<FileChangeCallback>();

  /**
   * 启动监听
   * @param dir - 监听目录
   */
  start(dir: string): void {
    if (this.watcher) {
      this.stop();
    }

    this.watcher = watch(dir, { recursive: true }, (event, filename) => {
      if (!filename) return;

      // 只关注特定文件类型
      if (!this.isRelevantFile(filename)) return;

      const changeEvent: FileChangeEvent = {
        event,
        filename,
        dir,
      };

      for (const callback of this.callbacks) {
        try {
          callback(changeEvent);
        } catch (error) {
          console.error('Watcher callback error:', error);
        }
      }
    });
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.callbacks.clear();
  }

  /**
   * 注册变更回调
   * @param callback - 回调函数
   */
  onChange(callback: FileChangeCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * 移除变更回调
   * @param callback - 回调函数
   */
  offChange(callback: FileChangeCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * 检查是否为相关文件
   */
  private isRelevantFile(filename: string): boolean {
    // 只关注 .js、.ts、.mjs 文件
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext === 'js' || ext === 'ts' || ext === 'mjs';
  }
}
