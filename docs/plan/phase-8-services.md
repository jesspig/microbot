# 阶段 8：服务层

**依赖**: 阶段 7（通道系统）  
**预计文件数**: 5  
**预计代码行数**: ~300 行

## 目标

实现 Cron 服务、Heartbeat 服务和技能加载器。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| IV. 轻量化设计 | ✅ | 服务职责单一 |

## 文件清单

### 1. src/cron/service.ts

**职责**: Cron 服务

```typescript
import { CronJob, CronStore } from './store';
import { parseCronExpression } from 'cron-schedule';

interface CronServiceConfig {
  defaultChannel?: string;
  defaultTo?: string;
}

/**
 * Cron 服务
 * 
 * 管理定时任务的调度和执行。
 */
export class CronService {
  private timerId: Timer | null = null;
  private running = false;

  constructor(
    private store: CronStore,
    private onJob: (job: CronJob) => Promise<string | null>,
    private config: CronServiceConfig = {}
  ) {}

  /** 启动服务 */
  async start(): Promise<void> {
    this.running = true;
    this.scheduleNextTick();
  }

  /** 停止服务 */
  stop(): void {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /** 调度下一次检查 */
  private scheduleNextTick(): void {
    const now = Date.now();
    const dueJobs = this.store.getDueJobs(now);

    if (dueJobs.length > 0) {
      this.executeJobs(dueJobs);
    }

    // 每 1 秒检查一次
    this.timerId = setTimeout(() => {
      if (this.running) this.scheduleNextTick();
    }, 1000);
  }

  /** 执行到期任务 */
  private async executeJobs(jobs: CronJob[]): Promise<void> {
    for (const job of jobs) {
      try {
        const result = await this.onJob(job);
        job.lastRunAt = Date.now();
        job.lastStatus = 'ok';
      } catch (error) {
        job.lastStatus = 'error';
      }

      // 计算下次执行时间
      job.nextRunAt = this.computeNextRun(job);
      this.store.update(job);
    }
  }

  /** 计算下次执行时间 */
  private computeNextRun(job: CronJob): number | undefined {
    const now = Date.now();

    switch (job.scheduleKind) {
      case 'at':
        // 一次性任务，不再执行
        return undefined;
      case 'every':
        const intervalMs = parseInt(job.scheduleValue ?? '3600000');
        return now + intervalMs;
      case 'cron':
        try {
          const cron = parseCronExpression(job.scheduleValue ?? '');
          return cron.getNextDate().getTime();
        } catch {
          return undefined;
        }
    }
  }

  /** 添加任务 */
  addJob(
    name: string,
    scheduleKind: 'at' | 'every' | 'cron',
    scheduleValue: string,
    message: string,
    channel?: string,
    toAddress?: string
  ): CronJob {
    const job: CronJob = {
      id: crypto.randomUUID().slice(0, 8),
      name,
      enabled: true,
      scheduleKind,
      scheduleValue,
      message,
      channel: channel ?? this.config.defaultChannel,
      toAddress: toAddress ?? this.config.defaultTo,
      nextRunAt: this.computeNextRunFromNow(scheduleKind, scheduleValue),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.store.add(job);
    return job;
  }

  private computeNextRunFromNow(kind: string, value: string): number | undefined {
    return this.computeNextRun({
      scheduleKind: kind as any,
      scheduleValue: value,
    } as CronJob);
  }

  /** 列出任务 */
  listJobs(includeDisabled: boolean = false): CronJob[] {
    return this.store.list(includeDisabled);
  }

  /** 删除任务 */
  removeJob(id: string): boolean {
    return this.store.delete(id);
  }
}
```

**行数**: ~110 行

---

### 2. src/heartbeat/service.ts

**职责**: Heartbeat 服务

```typescript
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your workspace (if it exists).
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: HEARTBEAT_OK`;
const OK_TOKEN = 'HEARTBEAT_OK';

interface HeartbeatConfig {
  intervalMs: number;
  workspace: string;
}

/**
 * Heartbeat 服务
 * 
 * 定期唤醒 Agent 检查 HEARTBEAT.md 中的任务。
 */
export class HeartbeatService {
  private timerId: Timer | null = null;
  private running = false;

  constructor(
    private onHeartbeat: (prompt: string) => Promise<string>,
    private config: HeartbeatConfig
  ) {}

  /** 启动服务 */
  start(): void {
    this.running = true;
    this.scheduleNext();
  }

  /** 停止服务 */
  stop(): void {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /** 调度下一次心跳 */
  private scheduleNext(): void {
    this.timerId = setTimeout(() => {
      if (this.running) {
        this.tick();
        this.scheduleNext();
      }
    }, this.config.intervalMs);
  }

  /** 执行心跳 */
  private async tick(): Promise<void> {
    const heartbeatPath = join(this.config.workspace, 'HEARTBEAT.md');

    // 检查是否有待处理任务
    if (!existsSync(heartbeatPath)) {
      return;
    }

    const content = readFileSync(heartbeatPath, 'utf-8');
    if (this.isEmpty(content)) {
      return;
    }

    // 调用 Agent 处理
    const response = await this.onHeartbeat(HEARTBEAT_PROMPT);

    if (response.trim() !== OK_TOKEN) {
      // Agent 执行了任务
    }
  }

  /** 检查 HEARTBEAT.md 是否为空 */
  private isEmpty(content: string): boolean {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('<!--')) continue;
      if (trimmed.startsWith('- [ ]')) continue; // 空复选框
      return false; // 有实际内容
    }
    return true;
  }
}
```

**行数**: ~90 行

---

### 3. src/skills/loader.ts

**职责**: 技能加载器

```typescript
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

/** 技能定义 */
export interface Skill {
  name: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * 技能加载器
 * 
 * 从 skills 目录加载 SKILL.md 文件。
 */
export class SkillsLoader {
  private skills = new Map<string, Skill>();

  constructor(
    private workspacePath: string,
    private builtinPath: string
  ) {}

  /** 加载所有技能 */
  load(): void {
    this.skills.clear();

    // 加载内置技能
    this.loadFromDir(this.builtinPath);

    // 加载用户技能（优先级更高）
    const userSkillsPath = join(this.workspacePath, 'skills');
    if (existsSync(userSkillsPath)) {
      this.loadFromDir(userSkillsPath);
    }
  }

  /** 从目录加载技能 */
  private loadFromDir(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      try {
        const skill = this.parseSkill(skillPath);
        this.skills.set(skill.name, skill);
      } catch (error) {
        console.error(`加载技能失败: ${entry.name}`, error);
      }
    }
  }

  /** 解析技能文件 */
  private parseSkill(path: string): Skill {
    const content = readFileSync(path, 'utf-8');
    const { data, content: body } = matter(content);

    return {
      name: data.name ?? path.split('/').slice(-2)[0],
      description: data.description ?? '',
      content: body,
      metadata: data.metadata ?? {},
    };
  }

  /** 获取技能 */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** 获取所有技能 */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 获取技能摘要（用于注入上下文） */
  getSummaries(): string {
    const summaries = this.getAll().map(s => `- ${s.name}: ${s.description}`);
    return `# 可用技能\n\n${summaries.join('\n')}`;
  }
}
```

**行数**: ~85 行

---

### 4. src/skills/time.ts

**职责**: 时间技能

```typescript
import { Skill } from './loader';

export const timeSkill: Skill = {
  name: 'time',
  description: '获取当前时间（系统时间/UTC时间/指定时区时间）',
  content: `# 时间获取

获取系统时间、UTC 时间或指定时区时间。

## 用法

- "现在几点" → 返回系统时间
- "UTC 时间" → 返回 UTC 时间
- "东京时间" → 返回东京时区时间
- "纽约时间" → 返回纽约时区时间

## 实现

使用 JavaScript Date 对象和 Intl.DateTimeFormat 实现时区转换。
`,
  metadata: {},
};
```

**行数**: ~25 行

---

### 5. src/skills/sysinfo.ts

**职责**: 系统信息技能

```typescript
import { Skill } from './loader';

export const sysinfoSkill: Skill = {
  name: 'sysinfo',
  description: '获取系统资源信息（CPU/内存/硬盘）',
  content: `# 系统资源监视器

获取 CPU、内存、硬盘等系统资源使用情况。

## 用法

- "CPU 使用率" → 返回 CPU 使用详情
- "内存情况" → 返回内存使用详情
- "硬盘空间" → 返回磁盘使用详情
- "系统状态" → 返回完整系统状态

## 返回信息

- CPU: 使用率、核心数、负载
- 内存: 总量、已用、可用、使用率
- 磁盘: 总量、已用、可用、使用率
- 系统: 运行时间、平台信息
`,
  metadata: {},
};
```

**行数**: ~25 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 实现 Cron 服务 | `src/cron/service.ts` | ~110 |
| 2 | 实现 Heartbeat 服务 | `src/heartbeat/service.ts` | ~90 |
| 3 | 实现技能加载器 | `src/skills/loader.ts` | ~85 |
| 4 | 实现时间技能 | `src/skills/time.ts` | ~25 |
| 5 | 实现系统信息技能 | `src/skills/sysinfo.ts` | ~25 |

## 验收标准

- [ ] Cron 服务支持 at/every/cron 三种调度
- [ ] Heartbeat 服务每 30 分钟检查一次
- [ ] 技能加载器可以加载 SKILL.md
- [ ] 用户技能优先级高于内置技能

## 下一步

完成本阶段后，进入 [阶段 9：入口 & CLI](./phase-9-cli.md)
