import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ContextBuilder } from '../../src/agent/context';
import type { MemoryStore } from '../../src/memory/store';

const testWorkspace = join(process.cwd(), 'test-agent-workspace');

// Mock MemoryStore
const mockMemoryStore: MemoryStore = {
  readLongTerm: () => '',
  writeLongTerm: () => {},
  appendToday: () => {},
  readToday: () => '',
  getRecent: () => [],
} as MemoryStore;

describe('ContextBuilder', () => {
  let builder: ContextBuilder;

  beforeEach(() => {
    if (!existsSync(testWorkspace)) {
      mkdirSync(testWorkspace, { recursive: true });
    }
    builder = new ContextBuilder(testWorkspace, mockMemoryStore);
  });

  afterEach(() => {
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  describe('buildMessages', () => {
    it('should build basic message list', async () => {
      const messages = await builder.buildMessages([], 'Hello');
      
      expect(messages.length).toBeGreaterThan(0);
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toBe('Hello');
    });

    it('should include media attachments', async () => {
      const messages = await builder.buildMessages([], 'Check this', ['image.png']);
      
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.content).toContain('[附件: image.png]');
    });

    it('should include history messages', async () => {
      const history = [
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: 'Hello!' },
      ];
      
      const messages = await builder.buildMessages(history, 'How are you?');
      
      expect(messages.some(m => m.content === 'Hi')).toBe(true);
      expect(messages.some(m => m.content === 'Hello!')).toBe(true);
    });

    it('should load bootstrap files', async () => {
      writeFileSync(join(testWorkspace, 'AGENTS.md'), 'You are a helpful assistant.');
      writeFileSync(join(testWorkspace, 'IDENTITY.md'), 'Your name is Microbot.');
      
      const messages = await builder.buildMessages([], 'Hello');
      
      const systemMsg = messages.find(m => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg!.content).toContain('You are a helpful assistant');
      expect(systemMsg!.content).toContain('Your name is Microbot');
    });
  });

  describe('addAssistantMessage', () => {
    it('should add assistant message', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const result = builder.addAssistantMessage(messages, 'Hello!');
      
      expect(result).toHaveLength(2);
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toBe('Hello!');
    });

    it('should add tool calls', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const toolCalls = [{ id: '1', name: 'test', arguments: { a: 1 } }];
      
      const result = builder.addAssistantMessage(messages, '', toolCalls);
      
      expect(result[1].toolCalls).toEqual(toolCalls);
    });
  });

  describe('addToolResult', () => {
    it('should add tool result', () => {
      const messages = [{ role: 'assistant' as const, content: '' }];
      const result = builder.addToolResult(messages, 'call_1', 'Success');
      
      expect(result).toHaveLength(2);
      expect(result[1].role).toBe('tool');
      expect(result[1].toolCallId).toBe('call_1');
      expect(result[1].content).toBe('Success');
    });
  });
});
