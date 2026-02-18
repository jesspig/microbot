import type { ExtensionMeta, ExtensionType, ExtensionStatus } from './types';

/**
 * 扩展注册表
 * 
 * 管理扩展元数据和状态跟踪。
 */
export class ExtensionRegistry {
  private extensions = new Map<string, ExtensionMeta>();

  /**
   * 注册扩展
   * @param meta - 扩展元数据
   */
  register(meta: ExtensionMeta): void {
    this.extensions.set(meta.name, meta);
  }

  /**
   * 注销扩展
   * @param name - 扩展名称
   */
  unregister(name: string): void {
    this.extensions.delete(name);
  }

  /**
   * 获取扩展
   * @param name - 扩展名称
   */
  get(name: string): ExtensionMeta | undefined {
    return this.extensions.get(name);
  }

  /**
   * 获取所有扩展
   */
  getAll(): ExtensionMeta[] {
    return Array.from(this.extensions.values());
  }

  /**
   * 按类型获取扩展
   * @param type - 扩展类型
   */
  getByType(type: ExtensionType): ExtensionMeta[] {
    return this.getAll().filter(meta => meta.type === type);
  }

  /**
   * 更新扩展状态
   * @param name - 扩展名称
   * @param status - 新状态
   * @param error - 错误信息（可选）
   */
  updateStatus(name: string, status: ExtensionStatus, error?: string): void {
    const meta = this.extensions.get(name);
    if (meta) {
      meta.status = status;
      meta.error = error;
      if (status === 'loaded') {
        meta.loadedAt = new Date();
      }
    }
  }

  /**
   * 检查扩展是否存在
   * @param name - 扩展名称
   */
  has(name: string): boolean {
    return this.extensions.has(name);
  }

  /**
   * 清空所有扩展
   */
  clear(): void {
    this.extensions.clear();
  }
}
