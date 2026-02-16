# 阶段 6：Agent 核心

**依赖**: 阶段 4（工具系统）、阶段 5（Provider）  
**预计文件数**: 4  
**预计代码行数**: ~300 行

## 目标

实现 Agent 循环（ReAct 模式）、上下文构建器和子代理管理器。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| II. 组合优于继承 | ✅ | 通过 DI 注入依赖 |

## 文件清单

### 1. src/agent/context.ts

**职责**: 上下文构建器

```typescript
import type { LLMMessage } from '../providers/base';
import type { MemoryStore } from '../memory/store';
import type { InboundMessage } from '../bus/events';

/** Bootstrap 文件 */
const BOOTSTRAP_FILES = ['AGENTS.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'SOUL.md'];

/**
 * 上下文构建器
 * 
 * 构建发送给 LLM 的消息上下文，包括：
 * - 系统消息（bootstrap 文件）
 * - 记忆上下文
 * - 历史消息
 * - 当前消息
 */
export class ContextBuilder {
  constructor(
    private workspace: string,
    private memoryStore: MemoryStore
  ) {}

  /**
   * 构建消息列表
   */
  async buildMessages(
    history: LLMMessage[],
    currentMessage: string,
    media?: string[],
    channel?: string,
    chatId?: string
  ): Promise<LLMMessage[]> {
    const messages: LLMMessage[] = [];

    // 系统消息
    const systemContent = await this.buildSystemContent();
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }

    // 记忆上下文
    const memoryContent = await this.buildMemoryContent();
    if (memoryContent) {
      messages.push({ role: 'system', content: `# 记忆上下文\n\n${memoryContent}` });
    }

    // 历史消息
    messages.push(...history);

    // 当前消息
    const userContent = media?.length
      ? `${currentMessage}\n\n[附件: ${media.join(', ')}]`
      : currentMessage;
    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  /** 构建系统消息 */
  private async buildSystemContent(): Promise<string> {
    const parts: string[] = [];

    for (const file of BOOTSTRAP_FILES) {
      const path = `${this.workspace}/${file}`;
      try {
        const content = await Bun.file(path).text();
        if (content.trim()) {
          parts.push(`## ${file.replace('.md', '')}\n\n${content}`);
        }
      } catch {
        // 文件不存在，跳过
      }
    }

    return parts.join('\n\n');
  }

  /** 构建记忆上下文 */
  private async buildMemoryContent(): Promise<string> {
    const parts: string[] = [];

    // 长期记忆
    const longTerm = this.memoryStore.readLongTerm();
    if (longTerm.trim()) {
      parts.push(`### 长期记忆\n${longTerm}`);
    }

    // 最近日记
    const recent = this.memoryStore.getRecent(7);
    for (const entry of recent) {
      if (entry.summary) {
        parts.push(`### ${entry.date}\n${entry.summary}`);
      }
    }

    return parts.join('\n\n');
  }

  /** 添加助手消息 */
  addAssistantMessage(
    messages: LLMMessage[],
    content: string,
    toolCalls?: Array<{ id: string; name: string; arguments: string }>
  ): LLMMessage[] {
    const msg: LLMMessage = { role: 'assistant', content };
    if (toolCalls) {
      msg.toolCalls = toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.parse(tc.arguments),
      }));
    }
    return [...messages, msg];
  }

  /** 添加工具结果 */
  addToolResult(
    messages: LLMMessage[],
    toolCallId: string,
    toolName: string,
    result: string
  ): LLMMessage[] {
    return [...messages, {
      role: 'tool',
      toolCallId,
      content: result,
    }];
  }
}
```

**行数**: ~100 行

---

### 2. src/agent/loop.ts

**职责**: Agent 循环（ReAct 模式）

```typescript
import type { LLMMessage, LLMResponse } from '../providers/base';
import type { ILLMProvider } from '../providers/base';
import type { MessageBus } from '../bus/queue';
import type { SessionStore } from '../session/store';
import type { MemoryStore } from '../memory/store';
import type { ToolRegistry, ToolContext } from '../tools/registry';
import type { InboundMessage, OutboundMessage } from '../bus/events';
import { ContextBuilder } from './context';
import { logger } from '../utils/logger';

/** Agent 配置 */
interface AgentConfig {
  workspace: string;
  model: string;
  maxIterations: number;
}

/**
 * Agent 循环
 * 
 * 核心 ReAct 模式实现：
 * 1. 接收消息
 * 2. 构建上下文
 * 3. 调用 LLM
 * 4. 执行工具
 * 5. 返回响应
 */
export class AgentLoop {
  private running = false;

  constructor(
    private bus: MessageBus,
    private provider: ILLMProvider,
    private sessionStore: SessionStore,
    private memoryStore: MemoryStore,
    private toolRegistry: ToolRegistry,
    private config: AgentConfig
  ) {}

  /** 运行 Agent 循环 */
  async run(): Promise<void> {
    this.running = true;
    logger.info('Agent 循环启动');

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        const response = await this.processMessage(msg);
        if (response) {
          await this.bus.publishOutbound(response);
        }
      } catch (error) {
        logger.error('处理消息失败:', error);
      }
    }
  }

  /** 停止循环 */
  stop(): void {
    this.running = false;
    logger.info('Agent 循环停止');
  }

  /** 处理单条消息 */
  private async processMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    const sessionKey = `${msg.channel}:${msg.chatId}` as const;

    // 构建上下文
    const contextBuilder = new ContextBuilder(this.config.workspace, this.memoryStore);
    const history = this.getHistory(sessionKey);
    const messages = await contextBuilder.buildMessages(
      history,
      msg.content,
      msg.media,
      msg.channel,
      msg.chatId
    );

    // ReAct 循环
    let iteration = 0;
    let finalContent = '';

    while (iteration < this.config.maxIterations) {
      iteration++;

      const response = await this.provider.chat(
        messages,
        this.toolRegistry.getDefinitions() as any,
        this.config.model
      );

      if (response.hasToolCalls && response.toolCalls) {
        // 添加助手消息
        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // 执行工具
        for (const tc of response.toolCalls) {
          logger.info(`执行工具: ${tc.name}`);
          const result = await this.toolRegistry.execute(
            tc.name,
            tc.arguments,
            this.createToolContext(msg)
          );
          messages.push({ role: 'tool', toolCallId: tc.id, content: result });
        }
      } else {
        finalContent = response.content;
        break;
      }
    }

    if (!finalContent) {
      finalContent = '处理完成，但无响应内容。';
    }

    // 保存会话
    this.sessionStore.addMessage(sessionKey, 'user', msg.content);
    this.sessionStore.addMessage(sessionKey, 'assistant', finalContent);

    return {
      channel: msg.channel,
      chatId: msg.chatId,
      content: finalContent,
      media: [],
      metadata: msg.metadata,
    };
  }

  /** 获取历史消息 */
  private getHistory(sessionKey: string): LLMMessage[] {
    const session = this.sessionStore.get(sessionKey);
    if (!session) return [];

    return session.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  }

  /** 创建工具上下文 */
  private createToolContext(msg: InboundMessage): ToolContext {
    return {
      channel: msg.channel,
      chatId: msg.chatId,
      workspace: this.config.workspace,
      sendToBus: async (m) => this.bus.publishOutbound(m as OutboundMessage),
    };
  }
}
```

**行数**: ~130 行

---

### 3. src/agent/subagent.ts

**职责**: 子代理管理器

```typescript
import type { ILLMProvider, LLMMessage } from '../providers/base';
import type { MessageBus } from '../bus/queue';
import type { InboundMessage } from '../bus/events';
import { v4 as uuid } from 'uuid';

/**
 * 子代理管理器
 * 
 * 创建后台子代理执行独立任务，完成后通过系统消息通知主代理。
 */
export class SubagentManager {
  private runningTasks = new Map<string, Promise<void>>();

  constructor(
    private provider: ILLMProvider,
    private workspace: string,
    private bus: MessageBus,
    private model: string
  ) {}

  /**
   * 生成子代理
   * @param task - 任务描述
   * @param label - 任务标签
   * @param originChannel - 来源通道
   * @param originChatId - 来源聊天 ID
   */
  async spawn(
    task: string,
    label: string | undefined,
    originChannel: string,
    originChatId: string
  ): Promise<string> {
    const taskId = uuid().slice(0, 8);
    const taskName = label ?? `task-${taskId}`;

    const taskPromise = this.executeTask(taskId, taskName, task, originChannel, originChatId);
    this.runningTasks.set(taskId, taskPromise);

    return `已启动子代理 [${taskName}] (${taskId})，完成后将通知您。`;
  }

  /** 执行任务 */
  private async executeTask(
    taskId: string,
    taskName: string,
    task: string,
    originChannel: string,
    originChatId: string
  ): Promise<void> {
    try {
      const messages: LLMMessage[] = [
        { role: 'system', content: '你是一个独立的后台任务执行者。完成指定任务后报告结果。' },
        { role: 'user', content: task },
      ];

      const response = await this.provider.chat(messages, undefined, this.model);

      // 发送完成通知
      await this.bus.publishInbound({
        channel: 'system',
        senderId: `subagent:${taskId}`,
        chatId: `${originChannel}:${originChatId}`,
        content: `[${taskName}] 任务完成:\n\n${response.content}`,
        timestamp: new Date(),
        media: [],
        metadata: { taskId, taskName },
      });
    } catch (error) {
      await this.bus.publishInbound({
        channel: 'system',
        senderId: `subagent:${taskId}`,
        chatId: `${originChannel}:${originChatId}`,
        content: `[${taskName}] 任务失败: ${error}`,
        timestamp: new Date(),
        media: [],
        metadata: { taskId, taskName, error: true },
      });
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  /** 获取运行中的任务数 */
  get runningCount(): number {
    return this.runningTasks.size;
  }
}
```

**行数**: ~80 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 实现上下文构建器 | `src/agent/context.ts` | ~100 |
| 2 | 实现 Agent 循环 | `src/agent/loop.ts` | ~130 |
| 3 | 实现子代理管理器 | `src/agent/subagent.ts` | ~80 |

## 验收标准

- [ ] Agent 循环支持 ReAct 模式
- [ ] 上下文构建器加载 bootstrap 文件
- [ ] 工具调用正确执行
- [ ] 会话正确保存
- [ ] 子代理可以独立执行任务

## 下一步

完成本阶段后，进入 [阶段 7：通道系统](./phase-7-channels.md)
