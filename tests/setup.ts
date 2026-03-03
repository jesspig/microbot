/**
 * 测试环境设置
 */

import { beforeAll, afterAll, afterEach } from 'bun:test';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** 测试临时目录 */
export const TEST_TMP_DIR = join(tmpdir(), 'micro-agent-test');

/** 清理测试临时目录 */
export function cleanupTestDir(): void {
  try {
    rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

/** 确保测试目录存在 */
export function ensureTestDir(): void {
  try {
    mkdirSync(TEST_TMP_DIR, { recursive: true });
  } catch {
    // 忽略创建失败
  }
}

// 全局测试配置
beforeAll(() => {
  // 设置测试环境变量
  process.env.NODE_ENV = 'test';
  process.env.MICRO_AGENT_TEST = 'true';
  
  // 确保测试目录存在
  ensureTestDir();
});

afterEach(() => {
  // 每个测试后的清理（可根据需要扩展）
});

afterAll(() => {
  // 全局清理
  cleanupTestDir();
});

export {};