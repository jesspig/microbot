# Agent 开发指南

## 设计原则

### I. 代码即文档

**核心理念**：类型系统自解释，命名语义化，避免隐式逻辑。

```typescript
// ✅ 类型即文档
interface Tool {
  readonly name: string;           // 工具名称
  readonly description: string;    // 工具描述（供 LLM 理解）
  readonly inputSchema: ZodSchema; // 输入验证
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}

// ❌ 需要额外注释说明
interface Tool {
  n: string;    // name
  d: string;    // description
  schema: any;  // input schema
  run(i: any, c: any): Promise<any>;
}
```

**实践要点**：
- 接口字段使用完整语义化命名
- 避免缩写，除非是业界共识（如 `LLM`、`API`）
- 类型定义即是最准确的文档

---

### II. 组合优于继承

**核心理念**：通过接口 + 事件总线解耦，避免继承链导致的循环依赖。

```typescript
// ❌ 继承导致循环依赖
class BaseChannel {
  protected agent: Agent;  // 引用 Agent
}
class Agent {
  channels: BaseChannel[]; // 引用 Channel → 循环!
}

// ✅ 组合 + 事件总线解耦
class FeishuChannel implements Channel {
  constructor(private eventBus: EventBus) {
    // 监听出站消息
    this.eventBus.on('message:outbound', this.send.bind(this));
    // 发送入站消息
    this.eventBus.emit('message:received', inbound);
  }
}

class AgentLoop {
  constructor(private eventBus: EventBus) {
    this.eventBus.on('message:received', this.process.bind(this));
    this.eventBus.emit('message:outbound', outbound);
  }
}
```

**实践要点**：
- 模块间通过 `EventBus` 通信，不直接引用
- 依赖注入通过 `Container` 获取实例
- 接口定义契约，实现类可替换

---

### III. 开放封闭原则

**核心理念**：对扩展开放，对修改封闭。使用注册表模式实现插件式扩展。

```typescript
// 工具注册表
class ToolRegistry {
  private tools = new Map<string, Tool>();
  
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
  
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  
  getAll(): Tool[] {
    return [...this.tools.values()];
  }
}

// 通道注册表
class ChannelRegistry {
  private channels = new Map<ChannelType, Channel>();
  
  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }
}
```

**扩展机制**：

| 机制 | 用途 | 示例 |
|------|------|------|
| 依赖注入 | 解耦组件 | `container.resolve<ToolRegistry>()` |
| 事件系统 | 松耦合通信 | `eventBus.on('tool:beforeExecute')` |
| 钩子系统 | 注入前置/后置逻辑 | `hookSystem.register('pre:llm', hook)` |
| 注册表模式 | 动态注册扩展 | `toolRegistry.register(new MyTool())` |

---

### IV. 轻量化设计

**核心理念**：最小依赖，最小抽象，无过度工程。

**代码约束**：

| 约束 | 阈值 | 原因 |
|------|------|------|
| 单文件行数 | ≤ 300 行 | 保持可读性，便于审查 |
| 单方法行数 | ≤ 25 行 | 单一职责，易于测试 |
| 方法嵌套层级 | ≤ 3 层 | 避免复杂度爆炸 |
| 方法参数 | ≤ 4 个 | 过多应封装为对象 |
| 抽象层 | ≤ 2 层 | 不创建不必要的基类/接口 |

```typescript
// ❌ 过度抽象
interface IBaseHandler { handle(): void; }
interface IMessageHandler extends IBaseHandler { parse(): void; }
abstract class AbstractHandler implements IMessageHandler { ... }
class HandlerImpl extends AbstractHandler { ... }

// ✅ 最小抽象
interface Handler { handle(msg: Message): void; }
class MessageHandler implements Handler { handle(msg) { ... } }
```

---

### V. 本地优先

**核心理念**：默认本地存储和隐私保护，无云存储依赖。

**存储策略**：

| 数据 | 存储 | 位置 |
|------|------|------|
| 会话 | SQLite | `~/.microbot/data/sessions.db` |
| 定时任务 | SQLite | `~/.microbot/data/cron.db` |
| 记忆 | SQLite + Markdown | `~/.microbot/data/memory.db` + `workspace/memory/` |

**LLM 优先级**：

```yaml
llm:
  gateway:
    defaultProvider: ollama  # 本地优先
    providers:
      ollama:
        baseUrl: http://localhost:11434/v1
        priority: 1          # 最高优先级
      deepseek:
        baseUrl: https://api.deepseek.com/v1
        priority: 2          # 故障转移备用
```

---

## 核心接口

```typescript
// 依赖注入容器
interface Container {
  register<T>(token: string, factory: () => T): void;   // 瞬态
  singleton<T>(token: string, factory: () => T): void;  // 单例
  resolve<T>(token: string): T;
}

// 事件总线
interface EventBus {
  on(event: EventType, handler: EventHandler): void;
  off(event: EventType, handler: EventHandler): void;
  emit(event: EventType, payload: unknown): Promise<void>;
}

// 通道
interface Channel {
  readonly name: ChannelType;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
}

// 工具
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodSchema;
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}

// LLM Provider
interface LLMProvider {
  readonly name: string;
  chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse>;
  getDefaultModel(): string;
  isAvailable(): Promise<boolean>;
}
```

---

## 事件类型

```typescript
type EventType =
  // 消息流
  | 'message:received'      // 收到消息
  | 'message:beforeProcess' // 处理前
  | 'message:afterProcess'  // 处理后
  | 'message:sent'          // 发送完成
  // 工具执行
  | 'tool:beforeExecute'
  | 'tool:afterExecute'
  // LLM 调用
  | 'llm:beforeCall'
  | 'llm:afterCall'
  // 通道状态
  | 'channel:connected'
  | 'channel:disconnected'
  // 错误
  | 'error';
```

---

## 扩展开发

### 新增 Channel

```typescript
// src/channels/my-channel.ts
import { BaseChannel, ChannelType } from './base';
import { OutboundMessage } from '../bus/events';

export class MyChannel extends BaseChannel {
  readonly name: ChannelType = 'mychannel';
  
  async start(): Promise<void> {
    this._running = true;
    // 启动连接，监听消息
    this.eventBus.emit('message:received', inboundMessage);
  }
  
  async stop(): Promise<void> {
    this._running = false;
  }
  
  async send(msg: OutboundMessage): Promise<void> {
    // 发送消息到平台
  }
}
```

### 新增 Tool

```typescript
// src/tools/my-tool.ts
import { z } from 'zod';
import { Tool, ToolContext } from './base';

export class MyTool implements Tool {
  readonly name = 'my_tool';
  readonly description = '工具描述，供 LLM 理解用途';
  readonly inputSchema = z.object({
    param: z.string().describe('参数说明'),
  });
  
  async execute(input: z.infer<typeof this.inputSchema>, ctx: ToolContext) {
    return { result: input.param };
  }
}

// 注册
// src/tools/index.ts
registry.register(new MyTool());
```

### 新增 Provider

```typescript
// src/providers/my-provider.ts
import { LLMProvider, LLMMessage, LLMResponse } from './base';

export class MyProvider implements LLMProvider {
  readonly name = 'my-provider';
  
  async chat(messages: LLMMessage[], tools?, model?): Promise<LLMResponse> {
    // 调用 LLM API
    return { content: 'response', toolCalls: [] };
  }
  
  getDefaultModel(): string {
    return 'default-model';
  }
  
  async isAvailable(): Promise<boolean> {
    // 检查服务可用性
    return true;
  }
}
```

---

## 提交规范

```
<type>(<scope>): <subject>

<body>
```

**类型**: `feat` | `fix` | `refactor` | `docs` | `chore`

**示例**:
```
feat(tools): 新增 web_search 工具

- 支持 Google 搜索 API
- 返回结构化搜索结果
```
