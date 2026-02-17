import type { ILLMProvider, LLMMessage, LLMToolDefinition } from '../providers/base';
import type { MessageBus } from '../bus/queue';
import type { SessionStore } from '../session/store';
import type { MemoryStore } from '../memory/store';
import type { ToolRegistry, ToolContext } from '../tools/registry';
import type { InboundMessage, OutboundMessage, SessionKey } from '../bus/events';
import { ContextBuilder } from './context';

/** Agent 配置 */
export interface AgentConfig {
  /** 工作目录 */
  workspace: string;
  /** 默认模型 */
  model: string;
  /** 最大迭代次数 */
  maxIterations: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  workspace: './workspace',
  model: 'qwen3',
  maxIterations: 20,
};

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
    private config: AgentConfig = DEFAULT_CONFIG
  ) {}

  /**
   * 运行 Agent 循环
   */
  async run(): Promise<void> {
    this.running = true;

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        const response = await this.processMessage(msg);
        if (response) {
          await this.bus.publishOutbound(response);
        }
      } catch (error) {
        // 继续处理下一条消息
        console.error('处理消息失败:', error);
      }
    }
  }

  /**
   * 停止循环
   */
  stop(): void {
    this.running = false;
  }

  /**
   * 处理单条消息
   */
  async processMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    const sessionKey = `${msg.channel}:${msg.chatId}` as SessionKey;

    // 构建上下文
    const contextBuilder = new ContextBuilder(this.config.workspace, this.memoryStore);
    const history = this.getHistory(sessionKey);
    let messages = await contextBuilder.buildMessages(history, msg.content, msg.media);

    // ReAct 循环
    let iteration = 0;
    let finalContent = '';

    while (iteration < this.config.maxIterations) {
      iteration++;

      const tools = this.getToolDefinitions();
      const response = await this.provider.chat(messages, tools, this.config.model);

      if (response.hasToolCalls && response.toolCalls) {
        // 添加助手消息
        messages = contextBuilder.addAssistantMessage(
          messages,
          response.content,
          response.toolCalls
        );

        // 执行工具
        for (const tc of response.toolCalls) {
          const result = await this.toolRegistry.execute(
            tc.name,
            tc.arguments,
            this.createToolContext(msg)
          );
          messages = contextBuilder.addToolResult(messages, tc.id, result);
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

  /**
   * 获取历史消息
   */
  private getHistory(sessionKey: SessionKey): LLMMessage[] {
    const session = this.sessionStore.get(sessionKey);
    if (!session) return [];

    return session.messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  }

  /**
   * 获取工具定义
   */
  private getToolDefinitions(): LLMToolDefinition[] | undefined {
    const defs = this.toolRegistry.getDefinitions();
    if (!defs || defs.length === 0) return undefined;

    return defs.map(d => ({
      type: 'function' as const,
      function: {
        name: d.name,
        description: d.description,
        parameters: d.inputSchema as Record<string, unknown>,
      },
    }));
  }

  /**
   * 创建工具上下文
   */
  private createToolContext(msg: InboundMessage): ToolContext {
    return {
      channel: msg.channel,
      chatId: msg.chatId,
      workspace: this.config.workspace,
      sendToBus: async (m) => this.bus.publishOutbound(m as OutboundMessage),
    };
  }
}
