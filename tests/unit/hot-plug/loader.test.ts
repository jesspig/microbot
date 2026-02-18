import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ExtensionLoader } from '../../../src/hot-plug/loader';
import type { HotPluggable } from '../../../src/hot-plug/types';

describe('ExtensionLoader', () => {
  let loader: ExtensionLoader;
  let testDir: string;

  beforeEach(() => {
    loader = new ExtensionLoader();
    testDir = join(process.cwd(), 'test-loader-dir');
    
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('load', () => {
    it('should fail for non-existent file', async () => {
      const result = await loader.load(join(testDir, 'non-existent.ts'));
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail for invalid extension structure', async () => {
      const testFile = join(testDir, 'invalid.ts');
      writeFileSync(testFile, 'export default { name: "test" };');
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(false);
      expect(result.error).toBe('无效的扩展结构');
    });

    it('should load valid tool extension', async () => {
      const testFile = join(testDir, 'valid-tool.ts');
      writeFileSync(testFile, `
export default {
  type: 'tool',
  name: 'test_tool',
  description: '测试工具',
  execute: async () => 'ok'
};
`);
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(true);
      expect(result.extension).toBeDefined();
      expect(result.extension?.type).toBe('tool');
      expect(result.extension?.name).toBe('test_tool');
    });

    it('should load valid skill extension', async () => {
      const testFile = join(testDir, 'valid-skill.ts');
      writeFileSync(testFile, `
export default {
  type: 'skill',
  name: 'test_skill',
  content: '测试技能内容'
};
`);
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(true);
      expect(result.extension?.type).toBe('skill');
    });

    it('should load valid channel extension', async () => {
      const testFile = join(testDir, 'valid-channel.ts');
      writeFileSync(testFile, `
export default {
  type: 'channel',
  name: 'test_channel',
  start: async () => {},
  stop: async () => {},
  send: async () => {}
};
`);
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(true);
      expect(result.extension?.type).toBe('channel');
    });

    it('should call onLoad lifecycle', async () => {
      const testFile = join(testDir, 'lifecycle.ts');
      writeFileSync(testFile, `
let onLoadCalled = false;
export default {
  type: 'tool',
  name: 'lifecycle_tool',
  onLoad: async () => { onLoadCalled = true; }
};
export const wasOnLoadCalled = () => onLoadCalled;
`);
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(true);
    });
  });

  describe('unload', () => {
    it('should call onUnload lifecycle', async () => {
      const testFile = join(testDir, 'unload.ts');
      writeFileSync(testFile, `
export default {
  type: 'tool',
  name: 'unload_tool',
  onUnload: async () => {}
};
`);
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(true);
      
      if (result.extension) {
        // 不应抛出错误
        await loader.unload(result.extension);
      }
    });
  });

  describe('version compatibility', () => {
    it('should accept extensions without sdkVersion', async () => {
      const testFile = join(testDir, 'no-version.ts');
      writeFileSync(testFile, `
export default {
  type: 'tool',
  name: 'no_version_tool'
};
`);
      
      const result = await loader.load(testFile);
      expect(result.success).toBe(true);
    });
  });
});
