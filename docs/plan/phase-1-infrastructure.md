# 阶段 1：基础设施

**依赖**: 无  
**预计文件数**: 6  
**预计代码行数**: ~300 行

## 目标

搭建项目基础框架，包括日志、配置、依赖注入容器和数据库管理器。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 代码即文档 | ✅ | 接口定义清晰，类型自解释 |
| II. 组合优于继承 | ✅ | DI 容器支持组合 |
| IV. 轻量化设计 | ✅ | 单文件 ≤100 行 |

## 文件清单

### 1. src/types/interfaces.ts

**职责**: 核心接口定义（零依赖）

```typescript
// 核心容器接口
export interface IContainer {
  register<T>(token: string, factory: () => T): void;
  singleton<T>(token: string, factory: () => T): void;
  resolve<T>(token: string): T;
  has(token: string): boolean;
}

// 日志接口
export interface ILogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

// 数据库配置接口
export interface IDatabaseConfig {
  dataDir: string;
  sessionsDb: string;
  cronDb: string;
  memoryDb: string;
}
```

**行数**: ~40 行

---

### 2. src/container.ts

**职责**: 轻量级 DI 容器实现

```typescript
import type { IContainer } from './types/interfaces';

type Factory<T> = () => T;

/**
 * 轻量级依赖注入容器
 * 
 * 支持瞬态（每次创建新实例）和单例（全局唯一实例）两种模式。
 */
export class Container implements IContainer {
  /** 已注册的工厂函数 */
  private factories = new Map<string, Factory<unknown>>();
  
  /** 单例实例缓存 */
  private instances = new Map<string, unknown>();

  /**
   * 注册瞬态工厂
   * @param token - 依赖标识
   * @param factory - 工厂函数
   */
  register<T>(token: string, factory: Factory<T>): void {
    this.factories.set(token, factory);
  }

  /**
   * 注册单例工厂
   * @param token - 依赖标识
   * @param factory - 工厂函数
   */
  singleton<T>(token: string, factory: Factory<T>): void {
    this.factories.set(token, () => {
      if (!this.instances.has(token)) {
        this.instances.set(token, factory());
      }
      return this.instances.get(token);
    });
  }

  /**
   * 解析依赖
   * @param token - 依赖标识
   * @returns 依赖实例
   * @throws 未注册时抛出错误
   */
  resolve<T>(token: string): T {
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`未注册依赖: ${token}`);
    }
    return factory() as T;
  }

  /**
   * 检查依赖是否已注册
   */
  has(token: string): boolean {
    return this.factories.has(token);
  }
}
```

**行数**: ~55 行

---

### 3. src/utils/logger.ts

**职责**: 基于 pino 的日志工具

```typescript
import pino from 'pino';
import type { ILogger } from '../types/interfaces';

/**
 * 创建日志实例
 * @param name - 日志名称
 * @param level - 日志级别，默认 'info'
 */
export function createLogger(name: string, level: string = 'info'): ILogger {
  return pino({
    name,
    level,
    transport: level === 'debug' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined,
  });
}

/** 默认日志实例 */
export const logger = createLogger('microbot');
```

**行数**: ~20 行

---

### 4. src/config/schema.ts

**职责**: 配置 Schema 定义（Zod）

```typescript
import { z } from 'zod';

/** Agent 配置 Schema */
export const AgentConfigSchema = z.object({
  workspace: z.string().default('~/.microbot/workspace'),
  model: z.string().default('qwen3'),
  maxTokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  maxToolIterations: z.number().default(20),
});

/** LLM Provider 配置 Schema */
export const ProviderConfigSchema = z.object({
  ollama: z.object({
    baseUrl: z.string().default('http://localhost:11434/v1'),
    models: z.array(z.string()).optional(),
  }).optional(),
  lmStudio: z.object({
    baseUrl: z.string().default('http://localhost:1234/v1'),
    models: z.array(z.string()).optional(),
  }).optional(),
  vllm: z.object({
    baseUrl: z.string(),
    models: z.array(z.string()).optional(),
  }).optional(),
  openaiCompatible: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    models: z.array(z.string()).optional(),
  }).optional(),
});

/** 通道配置 Schema */
export const ChannelConfigSchema = z.object({
  feishu: z.object({
    enabled: z.boolean().default(false),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    allowFrom: z.array(z.string()).default([]),
  }).optional(),
  // ... 其他通道
});

/** 完整配置 Schema */
export const ConfigSchema = z.object({
  agents: z.object({
    defaults: AgentConfigSchema,
  }),
  providers: ProviderConfigSchema,
  channels: ChannelConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
```

**行数**: ~60 行

---

### 5. src/config/loader.ts

**职责**: 配置加载器

```typescript
import { readFileSync, existsSync } from 'fs';
import { parse } from 'js-yaml';
import { resolve, homedir } from 'path';
import { ConfigSchema, type Config } from './schema';

const CONFIG_FILES = ['config.yaml', 'config.yml', '.microbot/config.yaml'];

/**
 * 加载配置文件
 * @param configPath - 配置文件路径，默认自动查找
 */
export function loadConfig(configPath?: string): Config {
  // 查找配置文件
  const filePath = configPath ?? findConfigFile();
  
  if (!filePath || !existsSync(filePath)) {
    return ConfigSchema.parse({ agents: { defaults: {} } });
  }

  // 读取并解析 YAML
  const content = readFileSync(filePath, 'utf-8');
  const rawConfig = parse(content) as Record<string, unknown>;
  
  // 替换环境变量
  const resolvedConfig = resolveEnvVars(rawConfig);
  
  // 验证并返回
  return ConfigSchema.parse(resolvedConfig);
}

/** 查找配置文件 */
function findConfigFile(): string | null {
  for (const file of CONFIG_FILES) {
    const path = resolve(file);
    if (existsSync(path)) return path;
  }
  return null;
}

/** 递归替换环境变量 */
function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolveEnvVars(v)])
    );
  }
  return obj;
}

/** 展开路径（支持 ~） */
export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}
```

**行数**: ~60 行

---

### 6. src/db/manager.ts

**职责**: 数据库管理器

```typescript
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { resolve, homedir } from 'path';
import type { IDatabaseConfig } from '../types/interfaces';

/** 默认数据库配置 */
export const DEFAULT_DB_CONFIG: IDatabaseConfig = {
  dataDir: '~/.microbot/data',
  sessionsDb: '~/.microbot/data/sessions.db',
  cronDb: '~/.microbot/data/cron.db',
  memoryDb: '~/.microbot/data/memory.db',
};

/**
 * 数据库管理器
 * 
 * 管理三个 SQLite 数据库：sessions、cron、memory
 */
export class DatabaseManager {
  private sessions: Database | null = null;
  private cron: Database | null = null;
  private memory: Database | null = null;

  constructor(private config: IDatabaseConfig = DEFAULT_DB_CONFIG) {}

  /** 初始化所有数据库 */
  init(): void {
    const dataDir = this.expandPath(this.config.dataDir);
    mkdirSync(dataDir, { recursive: true });

    this.sessions = new Database(this.expandPath(this.config.sessionsDb));
    this.cron = new Database(this.expandPath(this.config.cronDb));
    this.memory = new Database(this.expandPath(this.config.memoryDb));

    this.createTables();
  }

  /** 创建表结构 */
  private createTables(): void {
    // 会话表
    this.sessions?.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      )
    `);
    this.sessions?.run(`CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at)`);

    // Cron 任务表
    this.cron?.run(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        schedule_kind TEXT NOT NULL,
        schedule_value TEXT,
        message TEXT NOT NULL,
        channel TEXT,
        to_address TEXT,
        next_run_at INTEGER,
        last_run_at INTEGER,
        last_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 记忆索引表
    this.memory?.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        date TEXT,
        title TEXT,
        summary TEXT,
        file_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.memory?.run(`CREATE INDEX IF NOT EXISTS idx_memories_date ON memories(date)`);
    this.memory?.run(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`);
  }

  private expandPath(path: string): string {
    if (path.startsWith('~/')) {
      return resolve(homedir(), path.slice(2));
    }
    return resolve(path);
  }

  getSessionsDb(): Database { return this._getDb('sessions'); }
  getCronDb(): Database { return this._getDb('cron'); }
  getMemoryDb(): Database { return this._getDb('memory'); }

  private _getDb(name: 'sessions' | 'cron' | 'memory'): Database {
    const db = this[name];
    if (!db) throw new Error(`数据库未初始化: ${name}`);
    return db;
  }

  /** 关闭所有数据库连接 */
  close(): void {
    this.sessions?.close();
    this.cron?.close();
    this.memory?.close();
  }
}
```

**行数**: ~100 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 创建核心接口定义 | `src/types/interfaces.ts` | ~40 |
| 2 | 实现 DI 容器 | `src/container.ts` | ~55 |
| 3 | 实现日志工具 | `src/utils/logger.ts` | ~20 |
| 4 | 定义配置 Schema | `src/config/schema.ts` | ~60 |
| 5 | 实现配置加载器 | `src/config/loader.ts` | ~60 |
| 6 | 实现数据库管理器 | `src/db/manager.ts` | ~100 |

## 验收标准

- [ ] DI 容器可以注册和解析依赖
- [ ] 配置加载器可以读取 YAML 文件
- [ ] 环境变量可以被正确替换
- [ ] 数据库管理器可以创建表结构
- [ ] 所有文件行数 ≤ 100 行

## 测试计划

```typescript
// tests/unit/container.test.ts
describe('Container', () => {
  it('should register and resolve transient', () => {
    const container = new Container();
    let count = 0;
    container.register('counter', () => ++count);
    expect(container.resolve('counter')).toBe(1);
    expect(container.resolve('counter')).toBe(2);
  });

  it('should register and resolve singleton', () => {
    const container = new Container();
    const obj = { value: 1 };
    container.singleton('obj', () => obj);
    expect(container.resolve('obj')).toBe(obj);
    expect(container.resolve('obj')).toBe(obj);
  });
});
```

## 下一步

完成本阶段后，进入 [阶段 2：事件系统](./phase-2-events.md)
