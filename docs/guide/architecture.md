# 架构概述

## 设计原则

### 1. 代码即文档

类型系统自解释，命名语义化，避免隐式逻辑。

```typescript
// ✅ 类型即文档
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodSchema;
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}
```

### 2. 组合优于继承

通过接口 + 事件总线解耦，避免继承链导致的循环依赖。

```typescript
// ✅ 组合 + 事件总线解耦
class FeishuChannel implements Channel {
  constructor(private eventBus: EventBus) {
    this.eventBus.on('message:outbound', this.send.bind(this));
  }
}
```

### 3. 开放封闭原则

对扩展开放，对修改封闭。使用注册表模式实现插件式扩展。

```typescript
class ToolRegistry {
  private tools = new Map<string, Tool>();
  
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
}
```

### 4. 轻量化设计

最小依赖，最小抽象，无过度工程。

| 约束 | 阈值 |
|------|------|
| 单文件行数 | ≤ 300 行 |
| 单方法行数 | ≤ 25 行 |
| 方法嵌套层级 | ≤ 3 层 |
| 方法参数 | ≤ 4 个 |

### 5. 本地优先

默认本地存储和隐私保护，无云存储依赖。

| 数据 | 存储 |
|------|------|
| 会话 | JSONL |
| 记忆 | SQLite |
| 定时任务 | SQLite |

## 模块架构

```
packages/core/src/
├── container.ts        # 依赖注入容器
├── event-bus.ts        # 事件总线
├── hook-system.ts      # 钩子系统
├── pipeline.ts         # 中间件管道
├── agent/              # Agent 模块
│   ├── loop.ts        # ReAct 循环
│   ├── context.ts     # 上下文构建
│   └── subagent.ts    # 子代理管理
├── providers/          # LLM 提供商
│   ├── base.ts        # Provider 接口
│   ├── gateway.ts     # 模型网关
│   └── router.ts      # 智能路由
├── tool/               # 工具系统
│   ├── registry.ts    # 工具注册表
│   └── base.ts        # 工具基类
├── channel/            # 消息通道
│   ├── base.ts        # 通道接口
│   └── manager.ts     # 通道管理器
├── storage/            # 存储层
│   ├── session/       # 会话存储
│   ├── memory/        # 记忆存储
│   └── cron/          # 定时任务存储
├── skill/              # 技能系统
│   └── loader.ts      # 技能加载器
└── service/            # 服务
    ├── cron/          # 定时任务服务
    └── heartbeat/    # 心跳服务
```

## 扩展机制

| 机制 | 用途 | 示例 |
|------|------|------|
| 依赖注入 | 解耦组件 | `container.resolve<ToolRegistry>()` |
| 事件系统 | 松耦合通信 | `eventBus.on('tool:beforeExecute')` |
| 注册表模式 | 动态注册扩展 | `toolRegistry.register(new MyTool())` |
