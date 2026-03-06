#!/usr/bin/env bun

/**
 * Agent Service 入口
 *
 * 纯 Agent 运行时服务，支持两种通信模式：
 * 1. IPC 模式：作为 CLI 子进程运行，通过 process.send/on('message') 通信
 * 2. 独立模式：作为独立服务运行，通过 TCP/Unix Socket 通信
 */

const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[AgentService] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg: string, error?: Error) =>
    console.error(`[AgentService] ${msg}`, error?.message ?? ''),
};

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
 * Agent Service 实现
 */
class AgentServiceImpl {
  private config: AgentServiceConfig;
  private running = false;
  private sessions = new Map<string, { messages: Array<{ role: string; content: string }> }>();
  private isIPCMode = false;

  constructor(config: Partial<AgentServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isIPCMode = process.env.BUN_IPC === '1' || !!process.send;
  }

  async start(): Promise<void> {
    if (this.running) {
      log.info('Agent Service 已在运行');
      return;
    }

    log.info('Agent Service 启动中...', {
      workspace: this.config.workspace,
      mode: this.isIPCMode ? 'IPC' : '独立'
    });

    if (this.isIPCMode) {
      this.startIPCMode();
    } else {
      await this.startStandaloneMode();
    }

    this.running = true;
    log.info('Agent Service 已启动');
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

    // 注册方法处理器
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

    // 信号处理
    const shutdown = async () => {
      console.log('\n正在关闭...');
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

    // 存储会话
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { messages: [] });
    }
    const session = this.sessions.get(sessionId)!;
    session.messages.push({ role: 'user', content: content.text });

    // 模拟流式响应
    const response = `收到消息: "${content.text}"。Agent Service 正在运行。`;

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

    session.messages.push({ role: 'assistant', content: response });
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

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { messages: [] });
    }
    const session = this.sessions.get(sessionId)!;
    session.messages.push({ role: 'user', content: content.text });

    const response = `收到消息: "${content.text}"。Agent Service 正在运行。`;

    for (let i = 0; i < response.length; i += 10) {
      const chunk = response.slice(i, i + 10);
      sendChunk({ delta: chunk, done: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    sendChunk({ done: true });
    session.messages.push({ role: 'assistant', content: response });
  }

  stop(): void {
    this.running = false;
    this.sessions.clear();
    log.info('Agent Service 已停止');
  }
}

// 启动服务
async function main(): Promise<void> {
  const service = new AgentServiceImpl({
    logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | undefined,
  });

  try {
    await service.start();

    // IPC 模式不需要保持运行，等待父进程消息
    // 独立模式需要保持运行
    if (!process.env.BUN_IPC) {
      await new Promise(() => {});
    }
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}

// 入口
if (import.meta.main) {
  main();
}

export { AgentServiceImpl };