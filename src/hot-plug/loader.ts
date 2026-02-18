import { join } from 'path';
import type { HotPluggable, ExtensionMeta, ExtensionType, ExtensionStatus } from './types';
import { SDK_VERSION } from './types';

/** 加载结果 */
export interface LoadResult {
  success: boolean;
  extension?: HotPluggable;
  error?: string;
}

/**
 * 扩展加载器
 * 
 * 动态加载扩展模块，支持版本兼容性检查和重试机制。
 */
export class ExtensionLoader {
  private maxRetries = 3;
  private retryDelayMs = 1000;

  /**
   * 加载扩展
   * @param path - 扩展文件路径
   * @returns 加载结果
   */
  async load(path: string): Promise<LoadResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // 使用查询参数绕过模块缓存
        const module = await import(`${path}?t=${Date.now()}`);
        const extension = module.default as HotPluggable;

        // 验证扩展结构
        if (!this.validateExtension(extension)) {
          return { success: false, error: '无效的扩展结构' };
        }

        // 版本兼容性检查
        if (!this.checkCompatibility(extension)) {
          return { success: false, error: `版本不兼容: 扩展声明 ${extension.sdkVersion}，SDK ${SDK_VERSION}` };
        }

        // 调用 onLoad 生命周期
        if (extension.onLoad) {
          await extension.onLoad();
        }

        return { success: true, extension };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        // 指数退避重试
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    return { success: false, error: `加载失败 (重试 ${this.maxRetries} 次): ${lastError}` };
  }

  /**
   * 卸载扩展
   * @param extension - 扩展实例
   */
  async unload(extension: HotPluggable): Promise<void> {
    if (extension.onUnload) {
      await extension.onUnload();
    }
  }

  /**
   * 验证扩展结构
   */
  private validateExtension(extension: unknown): extension is HotPluggable {
    if (!extension || typeof extension !== 'object') return false;

    const ext = extension as Record<string, unknown>;
    return (
      typeof ext.type === 'string' &&
      typeof ext.name === 'string' &&
      ['tool', 'skill', 'channel'].includes(ext.type as string)
    );
  }

  /**
   * 版本兼容性检查
   */
  private checkCompatibility(extension: HotPluggable): boolean {
    if (!extension.sdkVersion) return true;

    const [extMajor] = extension.sdkVersion.split('.').map(Number);
    const [sdkMajor] = SDK_VERSION.split('.').map(Number);

    return extMajor === sdkMajor;
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
