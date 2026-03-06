/**
 * 启动信息显示
 */

import { platform, arch, hostname } from 'os';
import { version as bunVersion } from 'bun';

/**
 * 显示启动信息
 */
export function displayStartupInfo(options: {
  verbose?: boolean;
  configPath?: string;
  channels: string[];
  ipcPath?: string;
}): void {
  const { verbose, configPath, channels, ipcPath } = options;

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║        Micro Agent CLI v1.0.0         ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');

  // 基本信息
  console.log('  系统信息:');
  console.log(`    平台: ${platform()} ${arch()}`);
  console.log(`    主机: ${hostname()}`);
  console.log(`    Bun: ${bunVersion}`);
  console.log('');

  // 配置信息
  if (verbose) {
    console.log('  配置:');
    console.log(`    配置文件: ${configPath ?? '默认'}`);
    console.log(`    IPC 路径: ${ipcPath ?? '默认'}`);
    console.log(`    启用通道: ${channels.join(', ') || '无'}`);
    console.log('');
  }

  // 启动状态
  console.log('  启动中...');
}

/**
 * 显示启动成功信息
 */
export function displaySuccessInfo(options: {
  channels: { type: string; connected: boolean }[];
  sessions: number;
  ipcPath: string;
}): void {
  const { channels, sessions, ipcPath } = options;

  console.log('');
  console.log('  ✅ 启动成功!');
  console.log('');
  console.log('  连接状态:');

  for (const channel of channels) {
    const status = channel.connected ? '✓' : '✗';
    console.log(`    ${status} ${channel.type}: ${channel.connected ? '已连接' : '未连接'}`);
  }

  console.log(`    IPC: ${ipcPath}`);
  console.log('');
  console.log(`  活跃会话: ${sessions}`);
  console.log('');
  console.log('  按 Ctrl+C 退出');
  console.log('');
}

/**
 * 显示启动失败信息
 */
export function displayErrorInfo(error: Error): void {
  console.log('');
  console.log('  ❌ 启动失败!');
  console.log('');
  console.log(`  错误: ${error.message}`);
  console.log('');
}

/**
 * 显示关闭信息
 */
export function displayShutdownInfo(): void {
  console.log('');
  console.log('  正在关闭...');
  console.log('');
}
