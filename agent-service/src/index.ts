#!/usr/bin/env bun

/**
 * Agent Service 入口
 *
 * 纯 Agent 运行时服务，支持两种通信模式：
 * 1. IPC 模式：作为 CLI 子进程运行，通过 process.send/on('message') 通信
 * 2. 独立模式：作为独立服务运行，通过 TCP/Unix Socket 通信
 */

import { loadConfig, type Config } from '@micro-agent/config';
import { OpenAICompatibleProvider, type LLMProvider } from '../runtime/provider/llm/openai';
import { ToolRegistry, type ToolContext } from '../runtime/capability/tool-system/registry';
import { getLogger, initLogging, getTracer, subscribeToLogs, type ServiceLifecycleLog, type SessionLifecycleLog, type LLMCallLog, type ToolCallLog, type IPCMessageLog } from '../runtime/infrastructure/logging/logger';

const log = getLogger(['agent-service']);
const tracer = getTracer();

/** Agent Service 配置 */
interface AgentServiceConfig {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  workspace?: string;
}

/** 默认配置 */
const DEFAULT_CONFIG: AgentServiceConfig = {
  logLevel: 'info',
  workspace: process.cwd(),
};

/**
 * 记录服务生命周期日志
 */
function logServiceLifecycle(
  event: ServiceLifecycleLog['event'],
  options?: { error?: string; mode?: 'ipc' | 'standalone' }
): void {
  const entry: ServiceLifecycleLog = {
    _type: 'service_lifecycle',
    timestamp: new Date().toISOString(),
    level: event === 'error' ? 'error' : 'info',
    category: 'agent-service',
    message: event === 'start' ? 'Agent Service 启动中...'
      : event === 'ready' ? 'Agent Service 已就绪'
      : event === 'stop' ? 'Agent Service 已停止'
      : `Agent Service 错误: ${options?.error}`,
    event,
    service: {
      version: '1.0.0',
      mode: options?.mode,
      pid: process.pid,
    },
    error: options?.error,
  };
  
  log.info('📢 服务生命周期', entry);
}

/**
 * 记录会话生命周期日志
 */
function logSessionLifecycle(
  event: SessionLifecycleLog['event'],
  sessionId: string,
  user?: { id?: string; channel?: string }
): void {
  const entry: SessionLifecycleLog = {
    _type: 'session_lifecycle',
    timestamp: new Date().toISOString(),
    level: 'info',
    category: 'session',
    message: event === 'create' ? `会话创建: ${sessionId.slice(0, 8)}`
      : event === 'destroy' ? `会话销毁: ${sessionId.slice(0, 8)}`
      : `会话${event}: ${sessionId.slice(0, 8)}`,
    event,
    sessionId,
    user,
  };
  
  log.info('📱 会话生命周期', entry);
}

/**
 * 记录 IPC 消息日志
 */
function logIPCMessage(
  direction: 'in' | 'out',
  method: string,
  options?: { requestId?: string; sessionId?: string; size?: number }
): void {
  const entry: IPCMessageLog = {
    _type: 'ipc_message',
    timestamp: new Date().toISOString(),
    level: 'debug',
    category: 'ipc',
    message: direction === 'in' ? `收到请求: ${method}` : `发送响应: ${method}`,
    direction,
    method,
    requestId: options?.requestId,
    sessionId: options?.sessionId,
    size: options?.size,
  };
  
  log.debug('📨 IPC 消息', entry);
}

/**
 * Agent Service 实现
 */
class AgentServiceImpl {
  private config: AgentServiceConfig;
  private appConfig: Config | null = null;
  private running = false;
  private sessions = new Map<string, { messages: Array<{ role: string; content: string }> }>();
  private isIPCMode = false;
  
  // 核心组件
  private llmProvider: LLMProvider | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private defaultModel: string = 'gpt-4';
  private systemPrompt: string = '你是一个有帮助的 AI 助手。';

  constructor(config: Partial<AgentServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isIPCMode = process.env.BUN_IPC === '1' || !!process.send;
  }

  async start(): Promise<void> {
    if (this.running) {
      log.info('Agent Service 已在运行');
      return;
    }

    // 初始化日志系统
    await initLogging({
      console: true,
      file: true,
      level: this.config.logLevel ?? 'info',
    });

    logServiceLifecycle('start', { mode: this.isIPCMode ? 'ipc' : 'standalone' });

    // 加载配置
    await this.loadAppConfig();

    // 初始化组件
    this.initializeComponents();

    if (this.isIPCMode) {
      this.startIPCMode();
    } else {
      await this.startStandaloneMode();
    }

    this.running = true;
    logServiceLifecycle('ready', { mode: this.isIPCMode ? 'ipc' : 'standalone' });
  }

  /**
   * 加载应用配置
   */
  private async loadAppConfig(): Promise<void> {
    try {
      this.appConfig = loadConfig({
        workspace: this.config.workspace,
      });
      log.info('配置加载成功');
    } catch (error) {
      log.error('配置加载失败，使用默认配置', { error: (error as Error).message });
      this.appConfig = {
        agents: {
          workspace: this.config.workspace ?? '~/.micro-agent/workspace',
          maxTokens: 512,
          temperature: 0.7,
          topK: 50,
          topP: 0.7,
          frequencyPenalty: 0.5,
        },
        providers: {},
        channels: {},
        workspaces: [],
      };
    }
  }

  /**
   * 初始化组件
   */
  private initializeComponents(): void {
    if (!this.appConfig) return;
    this.initializeLLMProvider();
    this.initializeToolRegistry();
    this.systemPrompt = this.buildSystemPrompt();
  }

  /**
   * 初始化 LLM Provider
   */
  private initializeLLMProvider(): void {
    const providers = this.appConfig?.providers || {};
    const agentConfig = this.appConfig?.agents;

    const chatModelConfig = agentConfig?.models?.chat || '';
    const slashIndex = chatModelConfig.indexOf('/');
    const defaultProviderName = slashIndex > 0 ? chatModelConfig.slice(0, slashIndex) : null;
    const defaultModelId = slashIndex > 0 ? chatModelConfig.slice(slashIndex + 1) : chatModelConfig;

    if (defaultProviderName) {
      const providerConfig = providers[defaultProviderName];
      if (providerConfig?.baseUrl) {
        this.defaultModel = defaultModelId;
        
        this.llmProvider = new OpenAICompatibleProvider({
          baseUrl: providerConfig.baseUrl,
          apiKey: providerConfig.apiKey,
          defaultModel: defaultModelId,
          defaultGenerationConfig: {
            maxTokens: agentConfig?.maxTokens ?? 512,
            temperature: agentConfig?.temperature ?? 0.7,
            topK: agentConfig?.topK ?? 50,
            topP: agentConfig?.topP ?? 0.7,
            frequencyPenalty: agentConfig?.frequencyPenalty ?? 0.5,
          },
        }, defaultProviderName);

        log.info('LLM Provider 已初始化', { 
          _type: 'llm_call',
          provider: defaultProviderName, 
          model: defaultModelId,
          success: true,
        });
        return;
      }
    }

    // 回退：查找第一个可用的 provider
    for (const [name, providerConfig] of Object.entries(providers)) {
      if (providerConfig.baseUrl) {
        const models = providerConfig.models || [];
        let modelId: string;
        if (models.length > 0) {
          const firstModel = models[0];
          const modelSlashIndex = firstModel.indexOf('/');
          modelId = modelSlashIndex > 0 ? firstModel.slice(modelSlashIndex + 1) : firstModel;
        } else {
          modelId = defaultModelId || 'gpt-4';
        }
        
        this.defaultModel = modelId;

        this.llmProvider = new OpenAICompatibleProvider({
          baseUrl: providerConfig.baseUrl,
          apiKey: providerConfig.apiKey,
          defaultModel: modelId,
          defaultGenerationConfig: {
            maxTokens: agentConfig?.maxTokens ?? 512,
            temperature: agentConfig?.temperature ?? 0.7,
            topK: agentConfig?.topK ?? 50,
            topP: agentConfig?.topP ?? 0.7,
            frequencyPenalty: agentConfig?.frequencyPenalty ?? 0.5,
          },
        }, name);

        log.info('LLM Provider 已初始化（回退）', { provider: name, model: modelId });
        return;
      }
    }

    log.info('未配置 LLM Provider，使用模拟响应模式');
  }

  /**
   * 初始化 Tool Registry
   */
  private initializeToolRegistry(): void {
    this.toolRegistry = new ToolRegistry({
      workspace: this.config.workspace,
    });

    this.registerBuiltinTools();

    log.info('Tool Registry 已初始化', { toolCount: this.toolRegistry.size });
  }

  /**
   * 注册内置工具
   */
  private registerBuiltinTools(): void {
    if (!this.toolRegistry) return;
    // TODO: 注册更多内置工具
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    return `你是一个有帮助的 AI 助手。请用中文回复用户的问题。

当前工作目录: ${this.config.workspace}

你可以帮助用户：
- 回答问题
- 编写代码
- 分析问题
- 提供建议

请用简洁、清晰的方式回复。`;
  }

  /**
   * IPC 模式启动
   */
  private startIPCMode(): void {
    process.on('message', (message: unknown) => {
      this.handleIPCMessage(message);
    });

    process.on('disconnect', () => {
      log.info('父进程断开连接');
      this.stop();
    });

    // 发送就绪信号
    process.send?.({ type: 'ready', jsonrpc: '2.0' });
  }

  /**
   * 处理 IPC 消息
   */
  private handleIPCMessage(message: unknown): void {
    const request = typeof message === 'string' ? JSON.parse(message) : message;
    const { id, method, params } = request;

    logIPCMessage('in', method, { requestId: id });

    try {
      switch (method) {
        case 'ping':
          process.send?.({ jsonrpc: '2.0', id, result: { pong: true } });
          break;

        case 'status':
          process.send?.({
            jsonrpc: '2.0',
            id,
            result: this.getStatus(),
          });
          break;

        case 'execute':
          this.execute(params).then((result) => {
            process.send?.({ jsonrpc: '2.0', id, result });
            logIPCMessage('out', 'execute', { requestId: id });
          }).catch((error) => {
            process.send?.({
              jsonrpc: '2.0',
              id,
              error: { code: -32001, message: error.message },
            });
          });
          break;

        case 'chat':
          this.handleChatStream(params, id);
          break;

        default:
          process.send?.({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Method not found' },
          });
      }
    } catch (error) {
      process.send?.({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error' },
      });
    }
  }

  /**
   * 独立模式启动
   */
  private async startStandaloneMode(): Promise<void> {
    const { createIPCServer } = await import('../interface/ipc');

    const ipcConfig = {
      type: process.platform === 'win32' ? 'tcp-loopback' : 'unix-socket' as const,
      path: '/tmp/micro-agent.sock',
      port: 3927,
    };

    const ipcServer = await createIPCServer(ipcConfig, {
      emit: () => {},
      on: () => {},
    } as any);

    if ('registerMethod' in ipcServer) {
      ipcServer.registerMethod('ping', async () => ({ pong: true }));
      ipcServer.registerMethod('status', async () => this.getStatus());
      ipcServer.registerMethod('execute', async (params) => this.execute(params));
    }

    if ('registerStreamMethod' in ipcServer) {
      ipcServer.registerStreamMethod('chat', async (params, context) => {
        await this.handleChatStreamToCallback(params, context.sendChunk);
      });
    }

    await ipcServer.start();

    const shutdown = async () => {
      logServiceLifecycle('stop');
      await ipcServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * 获取状态
   */
  private getStatus(): Record<string, unknown> {
    return {
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      activeSessions: this.sessions.size,
      provider: this.llmProvider ? {
        name: this.llmProvider.name,
        model: this.defaultModel,
      } : null,
      tools: this.toolRegistry?.size ?? 0,
    };
  }

  /**
   * 执行任务
   */
  private async execute(params: unknown): Promise<unknown> {
    const { sessionId, content } = params as {
      sessionId: string;
      content: { type: string; text: string };
    };

    if (this.llmProvider) {
      const messages = [
        { role: 'system' as const, content: this.systemPrompt },
        { role: 'user' as const, content: content.text },
      ];

      const response = await this.llmProvider.chat(messages);
      return {
        sessionId,
        content: response.content,
        done: true,
      };
    }

    return {
      sessionId,
      content: `执行结果: ${content.text}`,
      done: true,
    };
  }

  /**
   * 处理流式聊天（IPC 模式）
   */
  private async handleChatStream(params: unknown, requestId: string): Promise<void> {
    const { sessionId, content } = params as {
      sessionId: string;
      content: { type: string; text: string };
    };

    logSessionLifecycle('create', sessionId);

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { messages: [] });
    }
    const session = this.sessions.get(sessionId)!;
    session.messages.push({ role: 'user', content: content.text });

    if (this.llmProvider) {
      try {
        await this.streamFromLLM(session, content.text, requestId);
        return;
      } catch (error) {
        log.error('LLM 调用失败', { error: (error as Error).message });
      }
    }

    await this.streamMockResponse(content.text, requestId);
  }

  /**
   * 从 LLM 获取流式响应
   */
  private async streamFromLLM(
    session: { messages: Array<{ role: string; content: string }> },
    userMessage: string,
    requestId: string
  ): Promise<void> {
    if (!this.llmProvider) return;

    const startTime = Date.now();

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: this.systemPrompt },
    ];

    const recentMessages = session.messages.slice(-10);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    const tools = this.toolRegistry?.getDefinitions() || [];

    try {
      const response = await this.llmProvider.chat(messages, tools.length > 0 ? tools : undefined);
      const elapsed = Date.now() - startTime;

      // 记录 LLM 调用
      tracer.logLLMCall(
        this.defaultModel,
        this.llmProvider.name,
        messages.length,
        tools.length,
        elapsed,
        true,
        undefined,
        undefined,
        response.content?.slice(0, 100),
        response.hasToolCalls
      );

      if (response.hasToolCalls && response.toolCalls && this.toolRegistry) {
        await this.handleToolCalls(response.toolCalls, messages, requestId);
        return;
      }

      const fullContent = response.content || '';
      
      for (let i = 0; i < fullContent.length; i += 20) {
        const chunk = fullContent.slice(i, i + 20);
        process.send?.({
          jsonrpc: '2.0',
          id: requestId,
          method: 'stream',
          params: { delta: chunk, done: false },
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      process.send?.({
        jsonrpc: '2.0',
        id: requestId,
        method: 'stream',
        params: { done: true },
      });

      session.messages.push({ role: 'assistant', content: fullContent });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      tracer.logLLMCall(
        this.defaultModel,
        this.llmProvider.name,
        messages.length,
        tools.length,
        elapsed,
        false,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    requestId: string
  ): Promise<void> {
    if (!this.toolRegistry || !this.llmProvider) return;

    messages.push({
      role: 'assistant',
      content: '',
    });

    for (const tc of toolCalls) {
      const startTime = Date.now();
      
      try {
        const toolContext: ToolContext = {
          channel: 'ipc',
          chatId: requestId,
          workspace: this.config.workspace ?? process.cwd(),
          currentDir: this.config.workspace ?? process.cwd(),
          sendToBus: async () => {},
        };

        const result = await this.toolRegistry.execute(tc.name, tc.arguments, toolContext);
        const resultContent = typeof result.content === 'string' 
          ? result.content 
          : JSON.stringify(result.content);
        const elapsed = Date.now() - startTime;

        tracer.logToolCall(tc.name, tc.arguments, resultContent, elapsed, true);

        messages.push({
          role: 'user' as const,
          content: `工具 ${tc.name} 结果: ${resultContent}`,
        });
      } catch (error) {
        const elapsed = Date.now() - startTime;
        tracer.logToolCall(
          tc.name, 
          tc.arguments, 
          '', 
          elapsed, 
          false, 
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    }

    const finalResponse = await this.llmProvider.chat(messages);
    const fullContent = finalResponse.content || '';

    for (let i = 0; i < fullContent.length; i += 20) {
      const chunk = fullContent.slice(i, i + 20);
      process.send?.({
        jsonrpc: '2.0',
        id: requestId,
        method: 'stream',
        params: { delta: chunk, done: false },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    process.send?.({
      jsonrpc: '2.0',
      id: requestId,
      method: 'stream',
      params: { done: true },
    });
  }

  /**
   * 模拟流式响应
   */
  private async streamMockResponse(userMessage: string, requestId: string): Promise<void> {
    const response = `收到消息: "${userMessage}"。Agent Service 正在运行。`;

    for (let i = 0; i < response.length; i += 10) {
      const chunk = response.slice(i, i + 10);
      process.send?.({
        jsonrpc: '2.0',
        id: requestId,
        method: 'stream',
        params: { delta: chunk, done: false },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    process.send?.({
      jsonrpc: '2.0',
      id: requestId,
      method: 'stream',
      params: { done: true },
    });
  }

  /**
   * 处理流式聊天（独立模式回调）
   */
  private async handleChatStreamToCallback(
    params: unknown,
    sendChunk: (chunk: { delta?: string; done: boolean }) => void
  ): Promise<void> {
    const { sessionId, content } = params as {
      sessionId: string;
      content: { type: string; text: string };
    };

    logSessionLifecycle('create', sessionId);

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { messages: [] });
    }
    const session = this.sessions.get(sessionId)!;
    session.messages.push({ role: 'user', content: content.text });

    if (this.llmProvider) {
      try {
        const messages = [
          { role: 'system' as const, content: this.systemPrompt },
          { role: 'user' as const, content: content.text },
        ];
        const response = await this.llmProvider.chat(messages);
        
        sendChunk({ delta: response.content || '', done: false });
        sendChunk({ done: true });
        session.messages.push({ role: 'assistant', content: response.content || '' });
        return;
      } catch (error) {
        log.error('LLM 调用失败', { error: (error as Error).message });
      }
    }

    const response = `收到消息: "${content.text}"。Agent Service 正在运行。`;
    sendChunk({ delta: response, done: false });
    sendChunk({ done: true });
    session.messages.push({ role: 'assistant', content: response });
  }

  stop(): void {
    this.running = false;
    this.sessions.clear();
    logServiceLifecycle('stop');
  }
}

// 启动服务
async function main(): Promise<void> {
  const service = new AgentServiceImpl({
    logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | undefined,
  });

  try {
    await service.start();

    if (!process.env.BUN_IPC) {
      await new Promise(() => {});
    }
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

export { AgentServiceImpl };