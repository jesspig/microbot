/**
 * start 命令实现
 *
 * 启动 MicroBot 服务。
 */

import { createApp } from '../app';
import { loadConfig, getConfigStatus } from '@microbot/config';
import { configure, getConsoleSink } from '@logtape/logtape';
import { prettyFormatter } from '@logtape/pretty';

/** 初始化 LogTape */
async function initLogTape(verbose: boolean = false): Promise<void> {
  await configure({
    sinks: {
      console: getConsoleSink({ formatter: prettyFormatter }),
    },
    loggers: [
      { category: [], sinks: ['console'], lowestLevel: verbose ? 'debug' : 'info' },
      { category: ['logtape', 'meta'], lowestLevel: 'warning' },
    ],
    reset: true,
  });
}

/**
 * 启动服务
 * @param configPath - 可选的配置文件路径
 * @param verbose - 是否显示详细日志
 */
export async function runStartCommand(configPath?: string, verbose: boolean = false): Promise<void> {
  // 初始化日志
  await initLogTape(verbose);
  
  console.log('\x1b[2J\x1b[H'); // 清屏
  console.log();
  console.log('\x1b[1m\x1b[36mMicroBot\x1b[0m');
  console.log('─'.repeat(50));

  // 检查配置状态
  const baseConfig = loadConfig(configPath ? { configPath } : {});
  const configStatus = getConfigStatus(baseConfig);

  if (configStatus.needsSetup) {
    console.log();
    console.log('\x1b[33m  ⚠ 未检测到用户配置\x1b[0m');
    console.log();
    console.log('  请编辑 ~/.microbot/settings.yaml 配置：');
    console.log('    1. 在 providers 中添加模型提供商');
    console.log('    2. 在 channels 中启用消息通道');
    console.log();
    console.log('  示例配置：');
    console.log('    \x1b[2mproviders:\x1b[0m');
    console.log('    \x1b[2m  ollama:\x1b[2m');
    console.log('    \x1b[2m    baseUrl: http://localhost:11434/v1\x1b[0m');
    console.log('    \x1b[2m    models: [qwen3]\x1b[0m');
    console.log();
  }

  const app = await createApp(configPath);

  // 信号处理
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log();
    console.log('正在关闭...');
    try {
      await app.stop();
      console.log('已停止');
      process.exit(0);
    } catch (error) {
      console.error('关闭失败:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 启动
  try {
    await app.start();
    const routerStatus = app.getRouterStatus();
    console.log('─'.repeat(50));
    console.log(`  \x1b[2m通道:\x1b[0m ${app.getRunningChannels().join(', ') || '无'}`);
    console.log(`  \x1b[2m模型:\x1b[0m ${routerStatus.chatModel}`);
    if (routerStatus.auto) {
      const mode = routerStatus.max ? '性能优先' : '速度优先';
      console.log(`  \x1b[2m路由:\x1b[0m 自动 (${mode})`);
    } else {
      console.log(`  \x1b[2m路由:\x1b[0m 固定`);
    }
    if (verbose) {
      console.log(`  \x1b[2m日志:\x1b[0m 详细模式`);
    }
    console.log();
    console.log('按 Ctrl+C 停止');
    console.log('─'.repeat(50));
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}
