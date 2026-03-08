/**
 * 内存信息模块
 */
import { totalmem, freemem } from 'os';
import { formatBytes } from './shared';

export interface MemInfo {
  total: string;
  used: string;
  free: string;
  usage: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export function getMemInfo(): MemInfo {
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;

  return {
    total: formatBytes(totalMem),
    used: formatBytes(usedMem),
    free: formatBytes(freeMem),
    usage: `${(usedMem / totalMem * 100).toFixed(1)}%`,
    totalBytes: totalMem,
    usedBytes: usedMem,
    freeBytes: freeMem
  };
}

// 直接执行时输出内存信息
if (import.meta.main) {
  const info = getMemInfo();
  console.log('内存:');
  console.log(`  total: ${info.total}`);
  console.log(`  used: ${info.used}`);
  console.log(`  free: ${info.free}`);
  console.log(`  usage: ${info.usage}`);
}