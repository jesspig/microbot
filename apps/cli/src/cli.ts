#!/usr/bin/env bun

/**
 * MicroBot CLI 入口
 *
 * 命令:
 * - start: 启动服务
 * - status: 显示状态
 * - ext: 扩展管理
 */

import { parseArgs } from 'util';
import { initLogger } from '@microbot/config';
import { createApp } from './app';
import { loadConfig, getConfigStatus } from '@microbot/config';
import type { App } from '@microbot/types';

const VERSION = '0.2.0';

/** 显示帮助信息 */
function showHelp(): void {
  console.log(`
MicroBot - 轻量级 AI 助手框架

用法:
  microbot [命令] [选项]

命令:
  start       启动服务
  status      显示状态
  ext         扩展管理

选项:
  -c, --config <path>   配置文件路径
  -v, --verbose         显示详细日志
  -h, --help            显示帮助
      --version         显示版本

示例:
  microbot start
  microbot start -v
  microbot start -c ./config.yaml
  microbot status
  microbot ext list
`);
}

/** 显示版本 */
function showVersion(): void {
  console.log(`MicroBot v${VERSION}`);
}

/** 显示状态 */
function showStatus(app: App): void {
  const channels = app.getRunningChannels();
  const provider = app.getProviderStatus();

  console.log();
  console.log('\x1b[1m\x1b[36mMicroBot 状态\x1b[0m');
  console.log('─'.repeat(50));
  console.log(`  \x1b[2m通道:\x1b[0m ${channels.length > 0 ? channels.join(', ') : '无'}`);
  console.log(`  \x1b[2mProvider:\x1b[0m ${provider}`);
  console.log();
}

/** 启动服务 */
async function startService(configPath?: string): Promise<void> {
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
    console.log();
    console.log('按 Ctrl+C 停止');
    console.log('─'.repeat(50));
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}

/** CLI 主入口 */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  // 解析全局选项
  const parsed = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', short: 'c' },
      verbose: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  const { help, version, config, verbose } = parsed.values;
  const positionals = parsed.positionals;

  // 初始化日志（必须在所有日志调用之前）
  await initLogger({ verbose });

  // 全局选项
  if (help && positionals.length === 0) {
    showHelp();
    return;
  }

  if (version) {
    showVersion();
    return;
  }

  const command = positionals[0];
  const configPath = typeof config === 'string' ? config : undefined;

  switch (command) {
    case 'start':
      await startService(configPath);
      break;

    case 'status': {
      const app = await createApp(configPath);
      showStatus(app);
      break;
    }

    case 'ext': {
      const { runExtCommand } = await import('./commands/ext');
      await runExtCommand(positionals.slice(1));
      break;
    }

    case undefined:
      showHelp();
      break;

    default:
      console.log(`未知命令: ${command}`);
      console.log('运行 microbot --help 查看帮助');
  }
}

// 直接运行时执行
if (import.meta.main) {
  runCli();
}
