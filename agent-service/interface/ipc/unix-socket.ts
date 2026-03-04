/**
 * Unix Socket IPC 服务
 * 
 * 用于 Linux/macOS 系统的进程间通信。
 */

import type { EventBus } from '../../runtime/infrastructure/event-bus';
import type { IPCConfig, IPCServer } from './index';

export class UnixSocketServer implements IPCServer {
  private config: IPCConfig;
  private eventBus: EventBus;
  private socket: Bun.Socket | null = null;
  private clients = new Set<Bun.Socket>();

  constructor(config: IPCConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  async start(): Promise<void> {
    const path = this.config.path ?? '/tmp/micro-agent.sock';

    this.socket = Bun.listen({
      unix: path,
      socket: {
        data: (socket, data) => {
          this.handleMessage(socket, data);
        },
        open: (socket) => {
          this.clients.add(socket);
        },
        close: (socket) => {
          this.clients.delete(socket);
        },
        error: (socket, error) => {
          console.error('Unix Socket 错误:', error);
        },
      },
    });

    console.log(`Unix Socket 服务启动: ${path}`);
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();

    if (this.socket) {
      this.socket.stop();
      this.socket = null;
    }
  }

  send(message: unknown): void {
    const data = JSON.stringify(message) + '\n';
    for (const client of this.clients) {
      client.write(data);
    }
  }

  broadcast(message: unknown): void {
    this.send(message);
  }

  private handleMessage(socket: Bun.Socket, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      this.eventBus.emit('ipc:message', {
        socket,
        message,
        reply: (response: unknown) => {
          socket.write(JSON.stringify(response) + '\n');
        },
      });
    } catch (error) {
      console.error('解析消息失败:', error);
    }
  }
}
