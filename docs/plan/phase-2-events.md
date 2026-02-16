# 阶段 2：事件系统

**依赖**: 阶段 1（基础设施）  
**预计文件数**: 5  
**预计代码行数**: ~200 行

## 目标

实现事件总线、钩子系统、中间件管道和消息队列，为后续模块提供事件驱动能力。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 代码即文档 | ✅ | 类型定义清晰 |
| II. 组合优于继承 | ✅ | 事件驱动解耦 |
| IV. 轻量化设计 | ✅ | 使用 mitt（200b） |

## 文件清单

### 1. src/types/events.ts

**职责**: 事件类型定义

```typescript
/** 消息事件类型 */
export type MessageEventType =
  | 'message:received'      // 收到消息
  | 'message:beforeProcess' // 处理前
  | 'message:afterProcess'  // 处理后
  | 'message:sent';         // 已发送

/** 工具事件类型 */
export type ToolEventType =
  | 'tool:beforeExecute'    // 执行前
  | 'tool:afterExecute';    // 执行后

/** LLM 事件类型 */
export type LLMEventType =
  | 'llm:beforeCall'        // 调用前
  | 'llm:afterCall';        // 调用后

/** 通道事件类型 */
export type ChannelEventType =
  | 'channel:connected'     // 已连接
  | 'channel:disconnected'  // 已断开
  | 'channel:error';        // 错误

/** 系统事件类型 */
export type SystemEventType =
  | 'system:started'        // 已启动
  | 'system:stopping'       // 正在停止
  | 'error';                // 错误

/** 所有事件类型 */
export type EventType =
  | MessageEventType
  | ToolEventType
  | LLMEventType
  | ChannelEventType
  | SystemEventType;

/** 事件处理器 */
export type EventHandler = (payload: unknown) => void | Promise<void>;
```

**行数**: ~40 行

---

### 2. src/event-bus.ts

**职责**: 事件总线实现（基于 mitt）

```typescript
import mitt from 'mitt';
import type { EventType, EventHandler } from './types/events';

/** 事件映射类型 */
type EventMap = Record<EventType, unknown>;

/**
 * 事件总线
 * 
 * 基于 mitt 实现的轻量级事件总线，支持异步处理器。
 */
export class EventBus {
  private emitter = mitt<EventMap>();

  /**
   * 订阅事件
   * @param event - 事件类型
   * @param handler - 事件处理器
   */
  on(event: EventType, handler: EventHandler): void {
    this.emitter.on(event, handler as (payload: unknown) => void);
  }

  /**
   * 取消订阅
   * @param event - 事件类型
   * @param handler - 事件处理器
   */
  off(event: EventType, handler: EventHandler): void {
    this.emitter.off(event, handler as (payload: unknown) => void);
  }

  /**
   * 触发事件
   * @param event - 事件类型
   * @param payload - 事件数据
   */
  async emit(event: EventType, payload: unknown): Promise<void> {
    this.emitter.emit(event, payload);
  }

  /**
   * 订阅一次性事件
   * @param event - 事件类型
   * @param handler - 事件处理器
   */
  once(event: EventType, handler: EventHandler): void {
    const wrapper: EventHandler = (payload) => {
      this.off(event, wrapper);
      return handler(payload);
    };
    this.on(event, wrapper);
  }
}

/** 全局事件总线实例 */
export const eventBus = new EventBus();
```

**行数**: ~60 行

---

### 3. src/hook-system.ts

**职责**: 钩子系统实现

```typescript
/** 钩子类型 */
export type HookType =
  | 'pre:inbound'    // 入站消息预处理
  | 'post:inbound'   // 入站消息后处理
  | 'pre:outbound'   // 出站消息预处理
  | 'post:outbound'  // 出站消息后处理
  | 'pre:tool'       // 工具执行预处理
  | 'post:tool'      // 工具执行后处理
  | 'pre:llm'        // LLM 调用预处理
  | 'post:llm';      // LLM 调用后处理

/** 钩子函数 */
export type Hook<T> = (context: T) => T | Promise<T>;

/** 钩子注册项 */
interface HookEntry<T> {
  priority: number;
  hook: Hook<T>;
}

/**
 * 钩子系统
 * 
 * 支持优先级的钩子执行，用于在关键节点插入自定义逻辑。
 */
export class HookSystem {
  private hooks = new Map<HookType, HookEntry<unknown>[]>();

  /**
   * 注册钩子
   * @param type - 钩子类型
   * @param hook - 钩子函数
   * @param priority - 优先级（越小越先执行），默认 100
   */
  registerHook<T>(type: HookType, hook: Hook<T>, priority: number = 100): void {
    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }
    const entries = this.hooks.get(type)!;
    entries.push({ priority, hook: hook as Hook<unknown> });
    entries.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 执行钩子链
   * @param type - 钩子类型
   * @param context - 上下文对象
   * @returns 处理后的上下文
   */
  async executeHooks<T>(type: HookType, context: T): Promise<T> {
    const entries = this.hooks.get(type);
    if (!entries || entries.length === 0) {
      return context;
    }

    let result = context;
    for (const entry of entries) {
      result = await (entry.hook as Hook<T>)(result);
    }
    return result;
  }

  /** 清除指定类型的所有钩子 */
  clear(type: HookType): void {
    this.hooks.delete(type);
  }
}

/** 全局钩子系统实例 */
export const hookSystem = new HookSystem();
```

**行数**: ~70 行

---

### 4. src/pipeline.ts

**职责**: 中间件管道实现

```typescript
/** 中间件函数 */
export type Middleware<T> = (ctx: T, next: () => Promise<void>) => Promise<void>;

/**
 * 中间件管道
 * 
 * 支持按顺序执行中间件，每个中间件可以决定是否继续执行下一个。
 */
export class Pipeline<T> {
  private middlewares: Middleware<T>[] = [];

  /**
   * 添加中间件
   * @param middleware - 中间件函数
   */
  use(middleware: Middleware<T>): void {
    this.middlewares.push(middleware);
  }

  /**
   * 执行管道
   * @param ctx - 上下文对象
   */
  async execute(ctx: T): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index >= this.middlewares.length) return;
      const middleware = this.middlewares[index++];
      await middleware(ctx, next);
    };

    await next();
  }

  /** 清除所有中间件 */
  clear(): void {
    this.middlewares = [];
  }
}
```

**行数**: ~45 行

---

### 5. src/bus/events.ts

**职责**: 消息事件类型定义

```typescript
import type { ChannelType } from '../types/interfaces';

/** 入站消息 */
export interface InboundMessage {
  /** 通道类型 */
  channel: ChannelType;
  /** 发送者 ID */
  senderId: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: Date;
  /** 媒体文件 */
  media: string[];
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 出站消息 */
export interface OutboundMessage {
  /** 通道类型 */
  channel: ChannelType;
  /** 聊天 ID */
  chatId: string;
  /** 消息内容 */
  content: string;
  /** 回复消息 ID */
  replyTo?: string;
  /** 媒体文件 */
  media: string[];
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 会话键 */
export type SessionKey = `${string}:${string}`;
```

**行数**: ~40 行

---

### 6. src/bus/queue.ts

**职责**: 消息队列实现

```typescript
import type { InboundMessage, OutboundMessage } from './events';

/**
 * 消息总线
 * 
 * 管理入站和出站消息的异步队列。
 */
export class MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundResolvers: ((msg: InboundMessage) => void)[] = [];
  private outboundResolvers: ((msg: OutboundMessage) => void)[] = [];

  /**
   * 发布入站消息
   */
  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.inboundResolvers.length > 0) {
      const resolver = this.inboundResolvers.shift()!;
      resolver(msg);
    } else {
      this.inboundQueue.push(msg);
    }
  }

  /**
   * 消费入站消息
   */
  async consumeInbound(): Promise<InboundMessage> {
    if (this.inboundQueue.length > 0) {
      return this.inboundQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.inboundResolvers.push(resolve);
    });
  }

  /**
   * 发布出站消息
   */
  async publishOutbound(msg: OutboundMessage): Promise<void> {
    if (this.outboundResolvers.length > 0) {
      const resolver = this.outboundResolvers.shift()!;
      resolver(msg);
    } else {
      this.outboundQueue.push(msg);
    }
  }

  /**
   * 消费出站消息
   */
  async consumeOutbound(): Promise<OutboundMessage> {
    if (this.outboundQueue.length > 0) {
      return this.outboundQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.outboundResolvers.push(resolve);
    });
  }

  /** 获取入站队列长度 */
  get inboundLength(): number {
    return this.inboundQueue.length;
  }

  /** 获取出站队列长度 */
  get outboundLength(): number {
    return this.outboundQueue.length;
  }
}
```

**行数**: ~70 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 定义事件类型 | `src/types/events.ts` | ~40 |
| 2 | 实现事件总线 | `src/event-bus.ts` | ~60 |
| 3 | 实现钩子系统 | `src/hook-system.ts` | ~70 |
| 4 | 实现中间件管道 | `src/pipeline.ts` | ~45 |
| 5 | 定义消息事件 | `src/bus/events.ts` | ~40 |
| 6 | 实现消息队列 | `src/bus/queue.ts` | ~70 |

## 验收标准

- [ ] 事件总线可以订阅和触发事件
- [ ] 钩子系统支持优先级执行
- [ ] 中间件管道可以按顺序执行
- [ ] 消息队列支持异步消费
- [ ] 所有文件行数 ≤ 100 行

## 测试计划

```typescript
// tests/unit/event-bus.test.ts
describe('EventBus', () => {
  it('should emit and receive events', async () => {
    const bus = new EventBus();
    let received = false;
    bus.on('message:received', () => { received = true; });
    await bus.emit('message:received', {});
    expect(received).toBe(true);
  });

  it('should support once', async () => {
    const bus = new EventBus();
    let count = 0;
    bus.once('test', () => { count++; });
    await bus.emit('test', {});
    await bus.emit('test', {});
    expect(count).toBe(1);
  });
});
```

## 下一步

完成本阶段后，进入 [阶段 3：存储层](./phase-3-storage.md)
