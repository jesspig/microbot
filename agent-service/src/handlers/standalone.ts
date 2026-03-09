/**
 * 独立模式启动器
 *
 * 处理 Agent Service 作为独立服务运行的启动逻辑
 */

import { getLogger } from '../../runtime/infrastructure/logging/logger';
import type { ServiceComponents } from '../types';
import type { SessionManager } from './session';
import { handleStatus, handleExecute, handleChatStreamToCallback } from './index';

const log = getLogger(['agent-service', 'standalone']);

/**
 * 独立模式配置
 */
export interface StandaloneConfig {
  type: 'tcp-loopback' | 'unix-socket';
  path: string;
  port: number;
}

/**
 * 启动独立模式服务
 */
export async function startStandaloneMode(
  components: ServiceComponents,
  sessionManager: SessionManager,
  config: StandaloneConfig,
  workspace?: string
): Promise<{ stop: () => Promise<void> }> {
  const { createIPCServer } = await import('../../interface/ipc');

  const ipcServer = await createIPCServer(config, {
    emit: () => {},
    on: () => {},
  } as any);

  // 注册方法处理器
  if ('registerMethod' in ipcServer && ipcServer.registerMethod) {
    ipcServer.registerMethod('ping', async () => ({ pong: true }));
    ipcServer.registerMethod('status', async () => handleStatus(components, sessionManager));
    ipcServer.registerMethod('execute', async (params: unknown) =>
      handleExecute(params, components, { workspace } as any)
    );
  }

  // 注册流式方法处理器
  if ('registerStreamMethod' in ipcServer && ipcServer.registerStreamMethod) {
    ipcServer.registerStreamMethod('chat', async (params: unknown, context: unknown) => {
      const ctx = context as { sendChunk: (chunk: { delta?: string; done: boolean }) => void };
      await handleChatStreamToCallback(params, ctx.sendChunk, components, sessionManager.sessions);
    });
  }

  await ipcServer.start();

  log.info('独立模式服务已启动', { type: config.type, port: config.port });

  return {
    stop: async () => {
      await ipcServer.stop();
      log.info('独立模式服务已停止');
    },
  };
}
