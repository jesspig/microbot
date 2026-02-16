# 阶段 3：存储层

**依赖**: 阶段 2（事件系统）  
**预计文件数**: 3  
**预计代码行数**: ~250 行

## 目标

基于 SQLite 实现会话存储、记忆存储和 Cron 任务存储。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 代码即文档 | ✅ | 接口定义清晰 |
| IV. 轻量化设计 | ✅ | 使用 Bun 内置 SQLite |

## 文件清单

### 1. src/session/store.ts

**职责**: 会话存储实现

```typescript
import type { Database } from 'bun:sqlite';
import type { SessionKey } from '../bus/events';

/** 会话消息 */
interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** 会话数据 */
export interface Session {
  key: SessionKey;
  channel: string;
  chatId: string;
  messages: SessionMessage[];
  createdAt: number;
  lastActiveAt: number;
}

/** 会话存储配置 */
interface SessionStoreConfig {
  maxMessages: number;    // 最大消息数，默认 50
  maxAge: number;         // 过期时间（毫秒），默认 24h
}

const DEFAULT_CONFIG: SessionStoreConfig = {
  maxMessages: 50,
  maxAge: 24 * 60 * 60 * 1000,
};

/**
 * 会话存储
 * 
 * 基于 SQLite 的会话管理，支持消息限制和自动过期。
 */
export class SessionStore {
  constructor(
    private db: Database,
    private config: SessionStoreConfig = DEFAULT_CONFIG
  ) {}

  /**
   * 获取会话
   * @param key - 会话键
   */
  get(key: SessionKey): Session | null {
    const row = this.db.query<{ messages: string }, [string]>(
      'SELECT messages FROM sessions WHERE key = ?'
    ).get(key);

    if (!row) return null;

    return {
      key,
      channel: key.split(':')[0],
      chatId: key.split(':')[1],
      messages: JSON.parse(row.messages),
      createdAt: 0,  // 从数据库获取
      lastActiveAt: 0,
    };
  }

  /**
   * 保存会话
   * @param session - 会话数据
   */
  set(session: Session): void {
    const now = Date.now();
    
    // 限制消息数量
    const messages = session.messages.slice(-this.config.maxMessages);

    this.db.run(`
      INSERT INTO sessions (key, channel, chat_id, messages, created_at, last_active_at)
      VALUES ($key, $channel, $chatId, $messages, $createdAt, $lastActiveAt)
      ON CONFLICT(key) DO UPDATE SET
        messages = $messages,
        last_active_at = $lastActiveAt
    `, {
      $key: session.key,
      $channel: session.channel,
      $chatId: session.chatId,
      $messages: JSON.stringify(messages),
      $createdAt: session.createdAt || now,
      $lastActiveAt: now,
    });
  }

  /**
   * 添加消息到会话
   */
  addMessage(key: SessionKey, role: 'user' | 'assistant' | 'system', content: string): void {
    const session = this.get(key) || this.createSession(key);
    session.messages.push({ role, content, timestamp: Date.now() });
    this.set(session);
  }

  /**
   * 删除会话
   */
  delete(key: SessionKey): void {
    this.db.run('DELETE FROM sessions WHERE key = ?', [key]);
  }

  /**
   * 清理过期会话
   */
  cleanup(): number {
    const threshold = Date.now() - this.config.maxAge;
    const result = this.db.run('DELETE FROM sessions WHERE last_active_at < ?', [threshold]);
    return result.changes;
  }

  /** 创建新会话 */
  private createSession(key: SessionKey): Session {
    const [channel, chatId] = key.split(':');
    return {
      key,
      channel,
      chatId,
      messages: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
  }
}
```

**行数**: ~100 行

---

### 2. src/memory/store.ts

**职责**: 记忆存储实现（SQLite 索引 + Markdown 文件）

```typescript
import type { Database } from 'bun:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

/** 记忆类型 */
type MemoryType = 'diary' | 'longterm';

/** 记忆条目 */
export interface MemoryEntry {
  id?: number;
  type: MemoryType;
  date?: string;      // YYYY-MM-DD
  title?: string;
  summary?: string;
  filePath?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 记忆存储
 * 
 * 使用 SQLite 存储索引，Markdown 文件存储内容。
 */
export class MemoryStore {
  constructor(
    private db: Database,
    private workspacePath: string
  ) {
    this.ensureMemoryDir();
  }

  /** 确保记忆目录存在 */
  private ensureMemoryDir(): void {
    const memoryDir = join(this.workspacePath, 'memory');
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }
  }

  /**
   * 读取今日日记
   */
  readToday(): string {
    const date = this.formatDate(new Date());
    const filePath = this.getDiaryPath(date);
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  }

  /**
   * 追加到今日日记
   */
  appendToday(content: string): void {
    const date = this.formatDate(new Date());
    const filePath = this.getDiaryPath(date);
    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
    writeFileSync(filePath, existing + content + '\n');
    this.updateIndex('diary', date, content.slice(0, 100));
  }

  /**
   * 读取长期记忆
   */
  readLongTerm(): string {
    const filePath = join(this.workspacePath, 'memory', 'MEMORY.md');
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  }

  /**
   * 写入长期记忆
   */
  writeLongTerm(content: string): void {
    const filePath = join(this.workspacePath, 'memory', 'MEMORY.md');
    writeFileSync(filePath, content);
    this.updateIndex('longterm', undefined, content.slice(0, 100));
  }

  /**
   * 获取最近 N 天记忆
   */
  getRecent(days: number): MemoryEntry[] {
    const rows = this.db.query<MemoryEntry, [number]>(`
      SELECT * FROM memories 
      WHERE type = 'diary' AND date >= date('now', '-' || $days || ' days')
      ORDER BY date DESC
    `).all(days);

    return rows;
  }

  /** 格式化日期 */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /** 获取日记路径 */
  private getDiaryPath(date: string): string {
    return join(this.workspacePath, 'memory', `${date}.md`);
  }

  /** 更新索引 */
  private updateIndex(type: MemoryType, date?: string, summary?: string): void {
    const now = Date.now();
    this.db.run(`
      INSERT INTO memories (type, date, summary, file_path, created_at, updated_at)
      VALUES ($type, $date, $summary, $filePath, $now, $now)
    `, {
      $type: type,
      $date: date,
      $summary: summary,
      $filePath: date ? this.getDiaryPath(date) : undefined,
      $now: now,
    });
  }
}
```

**行数**: ~95 行

---

### 3. src/cron/store.ts

**职责**: Cron 任务存储实现

```typescript
import type { Database } from 'bun:sqlite';

/** 调度类型 */
type ScheduleKind = 'at' | 'every' | 'cron';

/** Cron 任务 */
export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  scheduleKind: ScheduleKind;
  scheduleValue?: string;
  message: string;
  channel?: string;
  toAddress?: string;
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatus?: 'ok' | 'error';
  createdAt: number;
  updatedAt: number;
}

/**
 * Cron 任务存储
 */
export class CronStore {
  constructor(private db: Database) {}

  /**
   * 列出所有任务
   */
  list(includeDisabled: boolean = false): CronJob[] {
    const query = includeDisabled
      ? 'SELECT * FROM cron_jobs ORDER BY next_run_at'
      : 'SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY next_run_at';
    return this.db.query<CronJob, []>(query).all();
  }

  /**
   * 获取单个任务
   */
  get(id: string): CronJob | null {
    return this.db.query<CronJob, [string]>('SELECT * FROM cron_jobs WHERE id = ?').get(id) ?? null;
  }

  /**
   * 添加任务
   */
  add(job: CronJob): void {
    this.db.run(`
      INSERT INTO cron_jobs (
        id, name, enabled, schedule_kind, schedule_value, message,
        channel, to_address, next_run_at, created_at, updated_at
      ) VALUES (
        $id, $name, $enabled, $scheduleKind, $scheduleValue, $message,
        $channel, $toAddress, $nextRunAt, $createdAt, $updatedAt
      )
    `, {
      $id: job.id,
      $name: job.name,
      $enabled: job.enabled ? 1 : 0,
      $scheduleKind: job.scheduleKind,
      $scheduleValue: job.scheduleValue,
      $message: job.message,
      $channel: job.channel,
      $toAddress: job.toAddress,
      $nextRunAt: job.nextRunAt,
      $createdAt: job.createdAt,
      $updatedAt: job.updatedAt,
    });
  }

  /**
   * 更新任务
   */
  update(job: CronJob): void {
    job.updatedAt = Date.now();
    this.db.run(`
      UPDATE cron_jobs SET
        name = $name, enabled = $enabled, schedule_kind = $scheduleKind,
        schedule_value = $scheduleValue, message = $message,
        channel = $channel, to_address = $toAddress,
        next_run_at = $nextRunAt, last_run_at = $lastRunAt,
        last_status = $lastStatus, updated_at = $updatedAt
      WHERE id = $id
    `, {
      $id: job.id,
      $name: job.name,
      $enabled: job.enabled ? 1 : 0,
      $scheduleKind: job.scheduleKind,
      $scheduleValue: job.scheduleValue,
      $message: job.message,
      $channel: job.channel,
      $toAddress: job.toAddress,
      $nextRunAt: job.nextRunAt,
      $lastRunAt: job.lastRunAt,
      $lastStatus: job.lastStatus,
      $updatedAt: job.updatedAt,
    });
  }

  /**
   * 删除任务
   */
  delete(id: string): boolean {
    const result = this.db.run('DELETE FROM cron_jobs WHERE id = ?', [id]);
    return result.changes > 0;
  }

  /**
   * 获取到期任务
   */
  getDueJobs(now: number): CronJob[] {
    return this.db.query<CronJob, [number]>(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= ?'
    ).all(now);
  }
}
```

**行数**: ~95 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 实现会话存储 | `src/session/store.ts` | ~100 |
| 2 | 实现记忆存储 | `src/memory/store.ts` | ~95 |
| 3 | 实现 Cron 存储 | `src/cron/store.ts` | ~95 |

## 验收标准

- [ ] 会话存储支持 CRUD 操作
- [ ] 消息数量限制为 50 条
- [ ] 会话自动过期（24 小时）
- [ ] 记忆存储支持日记和长期记忆
- [ ] Cron 任务支持三种调度类型

## 测试计划

```typescript
// tests/unit/session-store.test.ts
describe('SessionStore', () => {
  it('should store and retrieve session', () => {
    const store = new SessionStore(db);
    store.addMessage('feishu:123', 'user', 'Hello');
    const session = store.get('feishu:123');
    expect(session?.messages).toHaveLength(1);
  });

  it('should limit messages to 50', () => {
    const store = new SessionStore(db);
    for (let i = 0; i < 60; i++) {
      store.addMessage('feishu:123', 'user', `msg ${i}`);
    }
    const session = store.get('feishu:123');
    expect(session?.messages).toHaveLength(50);
  });
});
```

## 下一步

完成本阶段后，进入 [阶段 4：工具系统](./phase-4-tools.md)
