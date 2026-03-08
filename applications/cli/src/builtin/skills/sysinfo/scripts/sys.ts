/**
 * 系统信息模块
 */
import { platform, arch, hostname, uptime, type, release } from 'os';
import { formatUptime } from './shared';

export interface SysInfo {
  platform: string;
  arch: string;
  hostname: string;
  uptime: string;
  type: string;
  release: string;
}

export function getSysInfo(): SysInfo {
  return {
    platform: platform(),
    arch: arch(),
    hostname: hostname(),
    uptime: formatUptime(uptime()),
    type: type(),
    release: release()
  };
}

// 直接执行时输出系统信息
if (import.meta.main) {
  const info = getSysInfo();
  console.log('系统:');
  console.log(`  platform: ${info.platform}`);
  console.log(`  arch: ${info.arch}`);
  console.log(`  hostname: ${info.hostname}`);
  console.log(`  uptime: ${info.uptime}`);
  console.log(`  type: ${info.type}`);
  console.log(`  release: ${info.release}`);
}