/**
 * Storage Provider 模块入口
 *
 * 存储提供者接口和实现
 */

/** 存储提供者接口 */
export interface StorageProvider {
  /** Provider 名称 */
  readonly name: string;
  
  /** 获取数据 */
  get<T>(key: string): Promise<T | null>;
  
  /** 设置数据 */
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  
  /** 删除数据 */
  delete(key: string): Promise<void>;
  
  /** 检查键是否存在 */
  has(key: string): Promise<boolean>;
  
  /** 清空所有数据 */
  clear(): Promise<void>;
}

/** 存储配置 */
export interface StorageConfig {
  /** 存储路径 */
  path?: string;
  /** 默认 TTL (毫秒) */
  defaultTtl?: number;
}

/**
 * 文件存储提供者
 */
export class FileStorageProvider implements StorageProvider {
  readonly name = 'file-storage';
  private data: Map<string, { value: unknown; expiresAt?: number }> = new Map();
  private initialized = false;

  constructor(private config: StorageConfig = {}) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    // TODO: 从文件加载数据
    this.initialized = true;
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureInitialized();
    const entry = this.data.get(key);
    if (!entry) return null;
    
    // 检查是否过期
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.ensureInitialized();
    const effectiveTtl = ttl ?? this.config.defaultTtl;
    this.data.set(key, {
      value,
      expiresAt: effectiveTtl ? Date.now() + effectiveTtl : undefined,
    });
    // TODO: 持久化到文件
  }

  async delete(key: string): Promise<void> {
    await this.ensureInitialized();
    this.data.delete(key);
    // TODO: 持久化到文件
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const entry = this.data.get(key);
    if (!entry) return false;
    
    // 检查是否过期
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return false;
    }
    
    return true;
  }

  async clear(): Promise<void> {
    this.data.clear();
    // TODO: 清空文件
  }
}

/**
 * 创建文件存储提供者
 */
export function createFileStorageProvider(config?: StorageConfig): StorageProvider {
  return new FileStorageProvider(config);
}

/**
 * 内存存储提供者
 */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = 'memory-storage';
  private data: Map<string, { value: unknown; expiresAt?: number }> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttl ? Date.now() + ttl : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.data.get(key);
    if (!entry) return false;
    
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return false;
    }
    
    return true;
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/**
 * 创建内存存储提供者
 */
export function createMemoryStorageProvider(): StorageProvider {
  return new MemoryStorageProvider();
}
