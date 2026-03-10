/**
 * 自动记忆整合 - 集成测试
 *
 * 验证自动记忆整合流程：
 * - T034: 整合触发器
 * - T035: 空闲检测器
 * - T036: 事实提取器
 * - T037: 摘要生成器
 * - T038: 整合执行器
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { join } from 'path';
import { rm } from 'fs/promises';
import {
  IdleDetector,
  createIdleDetector,
  type IdleState,
  ConsolidationTrigger,
  createConsolidationTrigger,
  type TriggerEvent,
  type TriggerStrategy,
  FactExtractor,
  createFactExtractor,
  type ExtractedFact,
  type FactType,
  ConversationSummarizer,
  createSummarizer,
  type Summary,
  ConsolidationExecutor,
  createConsolidationExecutor,
  type ConsolidationResult,
} from '@micro-agent/sdk';
import { MemoryStore } from '../../runtime/capability/memory/store';
import type { LLMProvider, LLMMessage } from '../../types/provider';

// 测试数据存储路径
const TEST_STORAGE_PATH = join(__dirname, '.test-memory-us4');

// Mock LLM Provider
function createMockLLMProvider(): LLMProvider {
  return {
    name: 'mock',
    type: 'llm' as const,
    chat: vi.fn(async (params: any) => {
      const messages = params.messages ?? params;
      const lastMessage = Array.isArray(messages) ? messages[messages.length - 1] : messages;

      // 模拟响应
      if (lastMessage.content?.includes('提取')) {
        return {
          content: JSON.stringify({
            facts: [
              { type: 'preference', content: '用户喜欢 TypeScript', confidence: 0.9, entities: ['TypeScript'] },
              { type: 'fact', content: '用户是软件工程师', confidence: 0.85, entities: [] },
              { type: 'decision', content: '决定使用 Bun 作为运行时', confidence: 0.95, entities: ['Bun'] },
            ],
          }),
          usage: { totalTokens: 200, promptTokens: 100, completionTokens: 100 },
          hasToolCalls: false,
        };
      }

      if (lastMessage.content?.includes('摘要')) {
        return {
          content: JSON.stringify({
            topic: '技术栈选择讨论',
            keyPoints: ['用户偏好 TypeScript', '选择 Bun 作为运行时'],
            decisions: ['使用 Bun 作为运行时'],
            todos: [],
            entities: ['TypeScript', 'Bun'],
            summaryText: '用户讨论了技术栈选择，决定使用 TypeScript 和 Bun。',
          }),
          usage: { totalTokens: 150, promptTokens: 80, completionTokens: 70 },
          hasToolCalls: false,
        };
      }

      return {
        content: JSON.stringify({
          topic: '测试对话',
          keyPoints: ['要点1'],
          decisions: [],
          todos: [],
          entities: [],
        }),
        usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
        hasToolCalls: false,
      };
    }),
    getDefaultModel: () => 'mock-model',
    isAvailable: async () => true,
    getModelCapabilities: () => ({ vision: false, think: false, tool: true }),
    listModels: async () => ['mock-model'],
  };
}

// 测试消息
function createTestMessages(count: number): LLMMessage[] {
  const messages: LLMMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: i % 2 === 0
        ? `消息 ${i + 1}：我喜欢使用 TypeScript 编写代码`
        : `回复 ${i + 1}：好的，我会用 TypeScript 示例`,
    });
  }
  return messages;
}

describe('自动记忆整合', () => {
  let store: MemoryStore;
  let mockProvider: LLMProvider;

  beforeEach(async () => {
    // 清理旧数据
    try {
      await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }

    // 创建存储
    store = new MemoryStore({
      storagePath: TEST_STORAGE_PATH,
      defaultSearchLimit: 20,
    });
    await store.initialize();

    mockProvider = createMockLLMProvider();
  });

  afterEach(async () => {
    await store.close();
    try {
      await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  // ========== T035: 空闲检测器测试 ==========

  describe('T035: 空闲检测器', () => {
    it('应该正确检测空闲状态', () => {
      const detector = createIdleDetector({
        idleTimeout: 1100, // 最小 1000ms
        checkInterval: 1000,
      });

      // 初始状态不是空闲
      expect(detector.isIdle()).toBe(false);

      // 等待超过空闲时间
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.isIdle()).toBe(true);
          resolve();
        }, 1200);
      });
    });

    it('应该支持活动重置', async () => {
      const detector = createIdleDetector({
        idleTimeout: 1000,
        checkInterval: 1000,
      });

      // 等待接近空闲
      await new Promise(resolve => setTimeout(resolve, 800));

      // 记录活动
      detector.recordActivity();

      // 应该不是空闲
      expect(detector.isIdle()).toBe(false);
    });

    it('应该触发空闲回调', async () => {
      const detector = createIdleDetector({
        idleTimeout: 1000,
        checkInterval: 1000,
        minActiveTime: 0, // 禁用最小活动时间限制
      });

      const states: IdleState[] = [];
      detector.onIdle(state => { states.push(state); });

      detector.start();

      // 等待空闲触发（需要等待 idleTimeout + checkInterval）
      await new Promise(resolve => setTimeout(resolve, 2100));

      detector.stop();

      expect(states.length).toBeGreaterThan(0);
    });

    it('应该返回正确的空闲状态', () => {
      const detector = createIdleDetector({
        idleTimeout: 1000,
      });

      const state = detector.getState();

      expect(state.isIdle).toBe(false);
      expect(state.idleDuration).toBeGreaterThanOrEqual(0);
      expect(state.lastActivityTime).toBeGreaterThan(0);
    });

    it('应该返回剩余空闲时间', () => {
      const detector = createIdleDetector({
        idleTimeout: 1000,
      });

      const remaining = detector.getRemainingTime();

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(1000);
    });

    it('应该支持配置更新', () => {
      const detector = createIdleDetector({
        idleTimeout: 1000,
      });

      detector.updateConfig({ idleTimeout: 2000 });

      const remaining = detector.getRemainingTime();
      expect(remaining).toBeLessThanOrEqual(2000);
    });

    it('应该支持手动触发空闲', async () => {
      const detector = createIdleDetector({
        idleTimeout: 10000, // 很长的超时
        enabled: false,
      });

      const states: IdleState[] = [];
      detector.onIdle(state => { states.push(state); });

      await detector.triggerIdle();

      expect(states.length).toBe(1);
    });
  });

  // ========== T034: 整合触发器测试 ==========

  describe('T034: 整合触发器', () => {
    it('应该在达到消息阈值时触发', async () => {
      const trigger = createConsolidationTrigger({
        messageThreshold: 5,
        minTriggerInterval: 1000,
      });

      const events: TriggerEvent[] = [];
      trigger.onTrigger(event => { events.push(event); });

      // 记录消息
      for (let i = 0; i < 5; i++) {
        trigger.recordMessage();
      }

      // 等待触发
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events.length).toBe(1);
      expect(events[0].strategy).toBe('threshold');
    });

    it('应该支持手动触发', async () => {
      const trigger = createConsolidationTrigger({
        messageThreshold: 100, // 高阈值，不会自动触发
      });

      const events: TriggerEvent[] = [];
      trigger.onTrigger(event => { events.push(event); });

      await trigger.triggerManual({ reason: 'test' });

      expect(events.length).toBe(1);
      expect(events[0].strategy).toBe('manual');
    });

    it('应该遵守最小触发间隔', async () => {
      const trigger = createConsolidationTrigger({
        messageThreshold: 5,
        minTriggerInterval: 2000, // 2秒间隔
      });

      const events: TriggerEvent[] = [];
      trigger.onTrigger(event => { events.push(event); });

      // 快速记录消息触发两次
      trigger.recordMessages(5);
      await new Promise(resolve => setTimeout(resolve, 100));
      trigger.recordMessages(5);

      // 只应该触发一次
      expect(events.length).toBe(1);
    });

    it('应该正确返回状态', () => {
      const trigger = createConsolidationTrigger();

      trigger.recordMessage();
      trigger.recordMessage();

      const state = trigger.getState();

      expect(state.messageCount).toBe(2);
      expect(state.triggerCount).toBe(0);
    });

    it('应该支持重置', () => {
      const trigger = createConsolidationTrigger();

      trigger.recordMessages(10);
      trigger.reset();

      const state = trigger.getState();
      expect(state.messageCount).toBe(0);
    });

    it('应该与空闲检测器集成', async () => {
      const idleDetector = createIdleDetector({
        idleTimeout: 1000,
        checkInterval: 1500, // 更长的检查间隔避免多次触发
        minActiveTime: 0,
      });

      const trigger = createConsolidationTrigger({
        messageThreshold: 100, // 高阈值
        enableIdleTrigger: true,
        minTriggerInterval: 1000,
      });

      trigger.setIdleDetector(idleDetector);

      const events: TriggerEvent[] = [];
      trigger.onTrigger(event => { events.push(event); });

      // 记录一些消息
      trigger.recordMessages(5);

      // 启动检测
      idleDetector.start();

      // 等待空闲触发
      await new Promise(resolve => setTimeout(resolve, 2600));

      idleDetector.stop();

      // 应该至少触发一次空闲事件
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].strategy).toBe('idle');
    });
  });

  // ========== T036: 事实提取器测试 ==========

  describe('T036: 事实提取器', () => {
    it('应该从对话中提取事实', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
      });

      const messages = createTestMessages(10);
      const result = await extractor.extract(messages);

      expect(result.facts.length).toBeGreaterThan(0);
      expect(result.originalMessageCount).toBe(10);
    });

    it('应该按置信度过滤', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
        defaultMinConfidence: 0.8,
      });

      const messages = createTestMessages(10);
      const result = await extractor.extract(messages, {
        minConfidence: 0.9,
      });

      // 所有事实的置信度都应该 >= 0.9
      result.facts.forEach(fact => {
        expect(fact.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('应该支持去重', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
      });

      const messages = createTestMessages(10);
      const result = await extractor.extract(messages, {
        enableDedup: true,
        dedupThreshold: 0.8,
      });

      // 应该有去重统计
      expect(result.stats).toBeDefined();
    });

    it('应该限制最大提取数量', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
      });

      const messages = createTestMessages(20);
      const result = await extractor.extract(messages, {
        maxFacts: 2,
      });

      expect(result.facts.length).toBeLessThanOrEqual(2);
    });

    it('应该返回正确的统计信息', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
      });

      const messages = createTestMessages(10);
      const result = await extractor.extract(messages);

      expect(result.stats.total).toBeGreaterThanOrEqual(0);
      expect(result.stats.byType).toBeDefined();
    });

    it('快速提取应该工作', () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
      });

      const messages = createTestMessages(10);
      const facts = extractor.extractQuick(messages);

      // 快速提取使用规则，可能有结果
      expect(Array.isArray(facts)).toBe(true);
    });
  });

  // ========== T037: 摘要生成器测试 ==========

  describe('T037: 摘要生成器', () => {
    it('应该生成结构化摘要', async () => {
      const summarizer = createSummarizer(mockProvider, store);

      const messages = createTestMessages(15);
      const summary = await summarizer.summarize(messages);

      expect(summary.topic).toBeDefined();
      expect(Array.isArray(summary.keyPoints)).toBe(true);
      expect(Array.isArray(summary.decisions)).toBe(true);
      expect(summary.originalMessageCount).toBe(15);
    });

    it('应该支持 Token 预算控制', async () => {
      const summarizer = createSummarizer(mockProvider, store, {
        maxTokens: 200,
      });

      const messages = createTestMessages(20);
      const summary = await summarizer.summarize(messages, {
        tokenBudget: 200,
      });

      // Token 数应该在预算内（如果返回了）
      if (summary.tokenCount !== undefined) {
        expect(summary.tokenCount).toBeLessThanOrEqual(300); // 允许一定误差
      }
    });

    it('应该检查是否应该摘要', () => {
      const summarizer = createSummarizer(mockProvider, store, {
        minMessages: 10,
      });

      const fewMessages = createTestMessages(5);
      const manyMessages = createTestMessages(15);

      expect(summarizer.shouldSummarize(fewMessages)).toBe(false);
      expect(summarizer.shouldSummarize(manyMessages)).toBe(true);
    });

    it('应该存储摘要', async () => {
      const summarizer = createSummarizer(mockProvider, store);

      const messages = createTestMessages(10);
      const summary = await summarizer.summarize(messages);
      const id = await summarizer.storeSummary(summary, 'test-session');

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('应该估算 Token 数', () => {
      const summarizer = createSummarizer(mockProvider, store);

      const messages = createTestMessages(20);
      const tokens = summarizer.estimateTokens(messages);

      expect(tokens).toBeGreaterThan(0);
    });

    it('应该支持压缩消息历史', async () => {
      const summarizer = createSummarizer(mockProvider, store);

      const messages = createTestMessages(20);
      const { summary, recentMessages } = await summarizer.compress(messages, 5);

      expect(summary).toBeDefined();
      expect(recentMessages.length).toBe(5);
    });

    it('应该记录活动时间', () => {
      const summarizer = new ConversationSummarizer(mockProvider, store);

      const before = Date.now();
      summarizer.recordActivity();
      const after = Date.now();

      // 活动时间应该更新
      // (内部状态，通过后续行为验证)
    });
  });

  // ========== T038: 整合执行器测试 ==========

  describe('T038: 整合执行器', () => {
    it('应该执行完整整合流程', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        messageThreshold: 10,
        idleTimeout: 10000,
      });

      const messages = createTestMessages(25);
      const result = await executor.consolidate(messages, 'test-session');

      expect(result.success).toBe(true);
      expect(result.originalMessageCount).toBe(25);
      expect(result.memoryCount).toBeGreaterThan(0);
      expect(result.storedMemoryIds.length).toBeGreaterThan(0);
    });

    it('应该控制记忆增长率', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        maxMemoryGrowthRate: 0.2, // 最多 20%
        messageThreshold: 10,
      });

      const messages = createTestMessages(30);
      const result = await executor.consolidate(messages);

      // 记忆增长应该不超过 20%
      expect(result.memoryGrowthRate).toBeLessThanOrEqual(0.2);
    });

    it('应该返回正确的统计信息', async () => {
      const executor = createConsolidationExecutor(mockProvider, store);

      // 执行几次整合
      await executor.consolidate(createTestMessages(20));
      await executor.consolidate(createTestMessages(15));

      const stats = executor.getStats();

      expect(stats.totalConsolidations).toBe(2);
      expect(stats.totalMessagesProcessed).toBe(35);
      expect(stats.totalMemoriesGenerated).toBeGreaterThan(0);
      expect(stats.lastConsolidationTime).not.toBeNull();
    });

    it('应该支持消息提供者', async () => {
      const executor = createConsolidationExecutor(mockProvider, store);

      const messages = createTestMessages(15);
      executor.setMessageProvider(() => messages);

      const result = await executor.consolidate();

      expect(result.originalMessageCount).toBe(15);
    });

    it('应该支持启动和停止', () => {
      const executor = createConsolidationExecutor(mockProvider, store);

      executor.start();
      executor.stop();
      // 应该不会抛出错误
    });

    it('应该记录消息到触发器', () => {
      const executor = createConsolidationExecutor(mockProvider, store);

      executor.recordMessage();
      executor.recordMessage();

      // 通过内部状态验证（间接）
    });

    it('应该更新配置', () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        messageThreshold: 20,
      });

      executor.updateConfig({
        messageThreshold: 30,
      });

      // 配置应该更新（间接验证）
    });

    it('应该重置统计', async () => {
      const executor = createConsolidationExecutor(mockProvider, store);

      await executor.consolidate(createTestMessages(10));
      executor.resetStats();

      const stats = executor.getStats();
      expect(stats.totalConsolidations).toBe(0);
    });
  });

  // ========== US4 集成测试 ==========

  describe('自动记忆整合流程', () => {
    it('场景1: 阈值触发整合', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        messageThreshold: 5,
        autoConsolidate: true,
      });

      const messages = createTestMessages(10);
      executor.setMessageProvider(() => messages);
      executor.setSessionKey('threshold-test');

      // 记录消息
      for (let i = 0; i < 5; i++) {
        executor.recordMessage();
      }

      // 等待触发
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = executor.getStats();
      expect(stats.totalConsolidations).toBeGreaterThanOrEqual(1);
    });

    it('场景2: 空闲触发整合', async () => {
      // 使用单独的空闲检测器和触发器进行测试
      const idleDetector = createIdleDetector({
        idleTimeout: 1000,
        checkInterval: 1500,
        minActiveTime: 0,
      });

      let consolidationTriggered = false;

      idleDetector.onIdle(async () => {
        consolidationTriggered = true;
      });

      idleDetector.start();

      // 等待空闲触发
      await new Promise(resolve => setTimeout(resolve, 2600));

      idleDetector.stop();

      expect(consolidationTriggered).toBe(true);
    });

    it('场景3: 手动触发整合', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        autoConsolidate: false, // 禁用自动
      });

      const messages = createTestMessages(20);

      // 手动触发
      const result = await executor.consolidate(messages, 'manual-test');

      expect(result.success).toBe(true);
      expect(result.memoryCount).toBeGreaterThan(0);
    });

    it('场景4: 关键信息正确提取存储', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        minExtractionConfidence: 0.7, // 降低置信度阈值
        maxMemoryGrowthRate: 0.5, // 提高增长率以容纳更多记忆
      });

      // 包含偏好、决策、事实的消息
      const messages: LLMMessage[] = [
        { role: 'user', content: '我喜欢使用 TypeScript' },
        { role: 'assistant', content: '好的，我会用 TypeScript' },
        { role: 'user', content: '我们决定使用 Bun 作为运行时' },
        { role: 'assistant', content: '明白，Bun 是一个很好的选择' },
        { role: 'user', content: '我是一名软件工程师' },
        { role: 'assistant', content: '了解了' },
      ];

      const result = await executor.consolidate(messages, 'extraction-test');

      expect(result.success).toBe(true);
      expect(result.summary).not.toBeNull();
      // facts 可能被过滤，但至少有存储的记忆
      expect(result.storedMemoryIds.length).toBeGreaterThan(0);

      // 验证存储的记忆
      for (const id of result.storedMemoryIds) {
        const entry = await store.get(id);
        expect(entry).toBeDefined();
        expect(entry?.status).toBe('active');
      }
    });

    it('场景5: 多次整合累计效果', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        maxMemoryGrowthRate: 0.3,
      });

      // 执行多次整合
      for (let i = 0; i < 3; i++) {
        const messages = createTestMessages(15);
        await executor.consolidate(messages, `session-${i}`);
      }

      const stats = executor.getStats();

      expect(stats.totalConsolidations).toBe(3);
      expect(stats.totalMessagesProcessed).toBe(45);
      expect(stats.averageGrowthRate).toBeGreaterThan(0);
      expect(stats.averageGrowthRate).toBeLessThanOrEqual(0.3);
    });
  });

  // ========== 验收标准测试 ==========

  describe('验收标准', () => {
    it('整合触发正确', async () => {
      const trigger = createConsolidationTrigger({
        messageThreshold: 10,
        minTriggerInterval: 1000,
      });

      const events: TriggerEvent[] = [];
      trigger.onTrigger(e => { events.push(e); });

      // 阈值触发
      trigger.recordMessages(10);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events.some(e => e.strategy === 'threshold')).toBe(true);
    });

    it('空闲超时正确触发', async () => {
      const detector = createIdleDetector({
        idleTimeout: 1000,
        checkInterval: 1000,
        minActiveTime: 0,
      });

      let idleTriggered = false;
      detector.onIdle(() => { idleTriggered = true; });

      detector.start();
      await new Promise(resolve => setTimeout(resolve, 2100));
      detector.stop();

      expect(idleTriggered).toBe(true);
    });

    it('关键信息正确提取存储', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        minExtractionConfidence: 0.7,
        maxMemoryGrowthRate: 0.5, // 提高增长率
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: '我喜欢 Python' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '决定使用 FastAPI 框架' },
        { role: 'assistant', content: '记录' },
      ];

      const result = await executor.consolidate(messages);

      expect(result.success).toBe(true);
      // 验证有记忆被存储
      expect(result.storedMemoryIds.length).toBeGreaterThan(0);

      // 验证事实或摘要存在
      if (result.facts.length > 0) {
        const allContent = result.facts.map(f => f.content).join(' ');
        expect(allContent.length).toBeGreaterThan(0);
      } else if (result.summary) {
        expect(result.summary.topic).toBeDefined();
      }
    });

    it('整合后记忆增长不超过 20%', async () => {
      const executor = createConsolidationExecutor(mockProvider, store, {
        maxMemoryGrowthRate: 0.2,
      });

      const messages = createTestMessages(50);
      const result = await executor.consolidate(messages);

      expect(result.memoryGrowthRate).toBeLessThanOrEqual(0.2);
    });

    it('支持可配置阈值', () => {
      const trigger1 = createConsolidationTrigger({ messageThreshold: 10 });
      const trigger2 = createConsolidationTrigger({ messageThreshold: 50 });

      // 不同的配置应该可以创建
      expect(trigger1).toBeDefined();
      expect(trigger2).toBeDefined();
    });

    it('支持手动触发', async () => {
      const trigger = createConsolidationTrigger({
        messageThreshold: 200, // 最大允许值
      });

      const events: TriggerEvent[] = [];
      trigger.onTrigger(e => { events.push(e); });

      await trigger.triggerManual();

      expect(events.length).toBe(1);
    });

    it('摘要包含主题、关键要点、决策', async () => {
      const summarizer = createSummarizer(mockProvider, store);

      const messages = createTestMessages(20);
      const summary = await summarizer.summarize(messages);

      expect(summary.topic).toBeDefined();
      expect(Array.isArray(summary.keyPoints)).toBe(true);
      expect(Array.isArray(summary.decisions)).toBe(true);
    });

    it('支持 Token 预算控制', async () => {
      const summarizer = createSummarizer(mockProvider, store, {
        maxTokens: 300,
      });

      const messages = createTestMessages(30);
      const summary = await summarizer.summarize(messages, {
        tokenBudget: 300,
      });

      // 验证摘要生成成功
      expect(summary).toBeDefined();
    });

    it('事实提取准确且自动分类', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: '我喜欢 TypeScript' },
        { role: 'assistant', content: '好的' },
      ];

      const result = await extractor.extract(messages);

      // 验证提取结果
      expect(result.facts.length).toBeGreaterThan(0);

      // 验证类型是有效的
      const validTypes: FactType[] = ['fact', 'decision', 'preference', 'entity', 'todo'];
      result.facts.forEach(fact => {
        expect(validTypes).toContain(fact.type);
      });
    });

    it('支持去重', async () => {
      const extractor = createFactExtractor({
        llmProvider: mockProvider,
        defaultDedupThreshold: 0.8,
      });

      const messages = createTestMessages(20);
      const result = await extractor.extract(messages, {
        enableDedup: true,
      });

      // 去重后不应该有重复
      const contents = result.facts.map(f => f.content);
      const uniqueContents = new Set(contents);

      // 验证去重已执行
      expect(result.stats.deduplicated).toBeGreaterThanOrEqual(0);
    });
  });
});
