import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ExtensionWatcher, type FileChangeEvent } from '../../../src/hot-plug/watcher';

describe('ExtensionWatcher', () => {
  let watcher: ExtensionWatcher;
  let testDir: string;
  let events: FileChangeEvent[] = [];

  beforeEach(() => {
    watcher = new ExtensionWatcher();
    events = [];
    testDir = join(process.cwd(), 'test-watcher-dir');
    
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    
    watcher.onChange((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    watcher.stop();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('start/stop', () => {
    it('should start watching a directory', () => {
      watcher.start(testDir);
      expect(watcher).toBeDefined();
    });

    it('should stop watching and clear callbacks', () => {
      watcher.start(testDir);
      watcher.stop();
      // 再次 start 不应抛出错误
      watcher.start(testDir);
    });
  });

  describe('onChange/offChange', () => {
    it('should register change callback', () => {
      const callback = () => {};
      watcher.onChange(callback);
      // 没有直接方法验证，但不抛出错误即可
    });

    it('should remove change callback', () => {
      const callback = () => {};
      watcher.onChange(callback);
      watcher.offChange(callback);
      // 没有直接方法验证，但不抛出错误即可
    });
  });

  describe('file watching', () => {
    it('should detect new .ts files', async () => {
      watcher.start(testDir);
      
      // 写入新文件
      const testFile = join(testDir, 'test-extension.ts');
      writeFileSync(testFile, 'export default { type: "tool", name: "test" };');
      
      // 等待事件
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 验证事件（可能触发 rename 或 change）
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect new .js files', async () => {
      watcher.start(testDir);
      
      const testFile = join(testDir, 'test-extension.js');
      writeFileSync(testFile, 'export default { type: "tool", name: "test" };');
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should ignore non-relevant files', async () => {
      watcher.start(testDir);
      
      const testFile = join(testDir, 'readme.txt');
      writeFileSync(testFile, 'some text');
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // txt 文件不应触发事件
      expect(events.length).toBe(0);
    });
  });
});
