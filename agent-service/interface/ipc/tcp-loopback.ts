/**
 * TCP Loopback IPC 服务
 * 
 * 通过本地回环地址进行进程间通信。
 */

import type { EventBus } from '../../runtime/infrastructure/event-bus';
import type { IPCConfig, IPCServer } from './index';

export class TCPLoopbackServer implements IPCServer {
  private config: IPCConfig;
  private eventBus: EventBus;
  private server: Bun.Server | null = null;

  constructor(config: IPCConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  async start(): Promise<void> {
    const port = this.config.port ?? 0; // 0 表示随机端口

    this.server = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        const body = await request.text();
        return this.handleRequest(body);
      },
    });

    console.log(`TCP Loopback 服务启动: 127.0.0.1:${this.server.port}`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  send(message: unknown): void {
    // TCP 服务通过 HTTP 请求触发，不支持主动推送
    // 客户端应使用 WebSocket 或轮询
    console.log('TCP Loopback 不支持主动推送');
  }

  broadcast(message: unknown): void {
    this.send(message);
  }

  private handleRequest(body: string): Response {
    try {
      const message = JSON.parse(body);

      // 同步处理请求
      let response: unknown;
      this.eventBus.emit('ipc:message', {
        message,
        reply: (res: unknown) => {
          response = res;
        },
      });

      return Response.json({ success: true, data: response });
    } catch (error) {
      return Response.json(
        { success: false, error: '解析消息失败' },
        { status: 400 }
      );
    }
  }

  /** 获取实际端口 */
  get port(): number {
    return this.server?.port ?? 0;
  }
}
