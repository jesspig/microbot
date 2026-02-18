import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { HotPlugManager } from '../../../src/hot-plug/manager';

describe('HotPlugManager', () => {
  let manager: HotPlugManager;
  let testDir: string;
  let registeredTools: Map<string, unknown>;
  let registeredChannels: Map<string, unknown>;

  beforeEach(() => {
    registeredTools = new Map();
    registeredChannels = new Map();
    
    // Mock registries
    const mockToolRegistry = {
      register: (tool: unknown) => {
        const t = tool as { name: string };
        registeredTools.set(t.name, tool);
      },
      remove: (name: string) => {
        registeredTools.delete(name);
      }
    };
    
    const mockChannelRegistry = {
      register: (channel: unknown) => {
        const c = channel as { name: string };
        registeredChannels.set(c.name, channel);
      },
      remove: (name: string) => {
        registeredChannels.delete(name);
      }
    };
    
    manager = new HotPlugManager(mockToolRegistry, mockChannelRegistry);
    testDir = join(process.cwd(), 'test-manager-dir');
    
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    manager.stop();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('start/stop', () => {
    it('should start watching directories', () => {
      manager.start([testDir]);
      expect(manager.isRunning).toBe(true);
    });

    it('should stop watching', () => {
      manager.start([testDir]);
      manager.stop();
      expect(manager.isRunning).toBe(false);
    });

    it('should not start twice', () => {
      manager.start([testDir]);
      manager.start([testDir]); // 第二次不应有副作用
      expect(manager.isRunning).toBe(true);
    });

    it('should not stop when not running', () => {
      manager.stop(); // 不应抛出错误
      expect(manager.isRunning).toBe(false);
    });
  });

  describe('load', () => {
    it('should load valid tool extension', async () => {
      const testFile = join(testDir, 'tool.ts');
      writeFileSync(testFile, `
export default {
  type: 'tool',
  name: 'test_tool',
  execute: async () => 'ok'
};
`);
      
      const meta = await manager.load(testFile);
      
      expect(meta).toBeDefined();
      expect(meta?.name).toBe('test_tool');
      expect(meta?.type).toBe('tool');
      expect(meta?.status).toBe('loaded');
      expect(registeredTools.has('test_tool')).toBe(true);
    });

    it('should load valid channel extension', async () => {
      const testFile = join(testDir, 'channel.ts');
      writeFileSync(testFile, `
export default {
  type: 'channel',
  name: 'test_channel',
  start: async () => {},
  stop: async () => {},
  send: async () => {}
};
`);
      
      const meta = await manager.load(testFile);
      
      expect(meta?.name).toBe('test_channel');
      expect(meta?.type).toBe('channel');
      expect(registeredChannels.has('test_channel')).toBe(true);
    });

    it('should handle invalid extension', async () => {
      const testFile = join(testDir, 'invalid.ts');
      writeFileSync(testFile, 'export default { name: "invalid" };');
      
      const meta = await manager.load(testFile);
      
      expect(meta?.status).toBe('failed');
      expect(meta?.error).toBeDefined();
    });

    it('should handle non-existent file', async () => {
      const meta = await manager.load(join(testDir, 'non-existent.ts'));
      
      expect(meta?.status).toBe('failed');
    });
  });

  describe('unload', () => {
    it('should unload extension', async () => {
      const testFile = join(testDir, 'unload-tool.ts');
      writeFileSync(testFile, `
export default {
  type: 'tool',
  name: 'unload_tool',
  execute: async () => 'ok'
};
`);
      
      await manager.load(testFile);
      expect(registeredTools.has('unload_tool')).toBe(true);
      
      await manager.unload('unload_tool');
      expect(registeredTools.has('unload_tool')).toBe(false);
    });

    it('should handle non-existent extension', async () => {
      // 不应抛出错误
      await manager.unload('non_existent');
    });
  });

  describe('reload', () => {
    it('should reload extension', async () => {
      const testFile = join(testDir, 'reload-tool.ts');
      writeFileSync(testFile, `
export default {
  type: 'tool',
  name: 'reload_tool',
  execute: async () => 'ok'
};
`);
      
      await manager.load(testFile);
      
      const meta = await manager.reload('reload_tool');
      expect(meta?.name).toBe('reload_tool');
      expect(meta?.status).toBe('loaded');
    });

    it('should return null for non-existent extension', async () => {
      const meta = await manager.reload('non_existent');
      expect(meta).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return all registered extensions', async () => {
      const toolFile = join(testDir, 'tool1.ts');
      writeFileSync(toolFile, `
export default {
  type: 'tool',
  name: 'tool1',
  execute: async () => 'ok'
};
`);
      
      await manager.load(toolFile);
      
      const all = manager.getAll();
      expect(all.length).toBeGreaterThanOrEqual(1);
      expect(all.find(e => e.name === 'tool1')).toBeDefined();
    });

    it('should return empty array when no extensions', () => {
      const all = manager.getAll();
      expect(all).toEqual([]);
    });
  });
});
