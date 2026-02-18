import type { LLMProvider, LLMMessage, LLMToolDefinition } from '../providers/base';
import type { MessageBus } from '../bus/queue';
import type { SessionStore } from '../storage/session/store';
import type { MemoryStore } from '../storage/memory/store';
import type { ToolRegistry, ToolContext } from '../tool/registry';
import type { InboundMessage, OutboundMessage, SessionKey } from '../bus/events';
import type { SkillsLoader } from '../skill/loader';
import { ContextBuilder } from './context';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['agent']);

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
    private provider: LLMProvider,
    private sessionStore: SessionStore,
    private memoryStore: MemoryStore,
    private toolRegistry: ToolRegistry,
    private skillsLoader: SkillsLoader,
    private config: AgentConfig = DEFAULT_CONFIG
  ) {}

  /**
   * 运行 Agent 循环
   */
  async run(): Promise<void> {
    this.running = true;
    log.info('Agent 循环已启动，加载 {count} 个技能', { count: this.skillsLoader.count });

    while (this.running) {
      try {
        log.debug('等待消息...');
        const msg = await this.bus.consumeInbound();
        const preview = msg.content.slice(0, 30).replace(/\n/g, ' ');
        log.info('收到消息: {preview}', { preview: preview + (msg.content.length > 30 ? '...' : '') });
        const response = await this.processMessage(msg);
        if (response) {
          await this.bus.publishOutbound(response);
          log.info('回复已发送');
        }
      } catch (error) {
        log.error('处理消息失败: {error}', { error: error instanceof Error ? error.message : String(error) });
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
    
    // 设置当前目录（用于目录级配置查找）
    const currentDir = msg.currentDir || this.config.workspace;
    contextBuilder.setCurrentDir(currentDir);
    
    // 注入 Always 技能（自动加载完整内容）
    const alwaysSkills = this.skillsLoader.getAlwaysSkills();
    if (alwaysSkills.length > 0) {
      contextBuilder.setAlwaysSkills(alwaysSkills);
      log.debug('Always 技能: {skills}', { skills: alwaysSkills.map(s => s.name).join(', ') });
    }
    
    // 注入技能摘要（渐进式披露）
    contextBuilder.setSkillSummaries(this.skillsLoader.getSummaries());
    
    const history = this.getHistory(sessionKey);
    let messages = await contextBuilder.buildMessages(history, msg.content, msg.media);
    log.debug('上下文: {messages} 条消息, {history} 条历史, skills: {skills}, currentDir: {dir}', { 
      messages: messages.length, 
      history: history.length,
      skills: this.skillsLoader.count,
      dir: currentDir 
    });

    // ReAct 循环
    let iteration = 0;
    let finalContent = '';

    while (iteration < this.config.maxIterations) {
      iteration++;
      log.debug('[{iteration}/{max}] 调用 LLM...', { iteration, max: this.config.maxIterations });

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
          // 格式化参数显示（截断过长的值）
          const argsPreview = this.formatToolArgs(tc.arguments);
          log.info('[Tool] 调用: {name}({args})', { name: tc.name, args: argsPreview });
          
          const startTime = Date.now();
          const result = await this.toolRegistry.execute(
            tc.name,
            tc.arguments,
            this.createToolContext(msg)
          );
          const elapsed = Date.now() - startTime;
          
          // 判断执行结果
          const isSuccess = !result.startsWith('错误') && !result.startsWith('参数错误') && !result.startsWith('执行错误');
          const resultPreview = this.formatToolResult(result);
          
          if (isSuccess) {
            log.info('[Tool] 成功: {name} ({ms}ms) → {result}', { name: tc.name, ms: elapsed, result: resultPreview });
          } else {
            log.error('[Tool] 失败: {name} ({ms}ms) → {result}', { name: tc.name, ms: elapsed, result: resultPreview });
          }
          
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

    const replyPreview = finalContent.slice(0, 100).replace(/\n/g, ' ');
    log.info('回复: {content}', { content: replyPreview + (finalContent.length > 100 ? '...' : '') });
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
      currentDir: msg.currentDir || this.config.workspace,
      sendToBus: async (m) => this.bus.publishOutbound(m as OutboundMessage),
    };
  }

  /**
   * 格式化工具参数（用于日志显示）
   */
  private formatToolArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';

    const parts = entries.map(([key, value]) => {
      const valueStr = this.truncateString(JSON.stringify(value), 50);
      return `${key}=${valueStr}`;
    });

    const result = parts.join(', ');
    return result.length > 200 ? result.slice(0, 200) + '...' : result;
  }

  /**
   * 格式化工具结果（用于日志显示）
   */
  private formatToolResult(result: string): string {
    return this.truncateString(result.replace(/\n/g, ' '), 150);
  }

  /**
   * 截断字符串
   */
  private truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength) + '...';
  }
}
