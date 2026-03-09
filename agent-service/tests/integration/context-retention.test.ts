/**
 * 智能对话上下文保持 - 集成测试
 *
 * 验证多轮对话中的偏好保持和引用：
 * - T017: 偏好检测器
 * - T018: 偏好存储流程
 * - T019: 偏好检索注入
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { rm } from 'fs/promises';
import { PreferenceClassifier, detectPreference, PreferenceHandler } from '@micro-agent/sdk';
import { PreferenceInjector, formatPreferences, mergeWithSystemPrompt } from '../../runtime/kernel/context-manager/preference-injector';
import { MemoryStore } from '../../runtime/capability/memory/store';
import { TokenBudget } from '../../runtime/kernel/context-manager/token-budget';

// 测试数据存储路径
const TEST_STORAGE_PATH = join(__dirname, '.test-memory-us1');

describe('智能对话上下文保持', () => {
  let store: MemoryStore;
  let classifier: PreferenceClassifier;
  let handler: PreferenceHandler;
  let injector: PreferenceInjector;

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

    // 创建组件
    classifier = new PreferenceClassifier({ minConfidence: 0.7 });
    handler = new PreferenceHandler(store, {
      minConfidence: 0.7,
      enableDedup: true,
    });
    await handler.initialize();

    injector = new PreferenceInjector({
      enabled: true,
      maxTokens: 500,
      maxPreferences: 10,
      minConfidence: 0.7,
    });
  });

  afterEach(async () => {
    await store.close();
    try {
      await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  // ========== T017: 偏好检测器测试 ==========

  describe('T017: 偏好检测器', () => {
    it('应该检测中文喜欢偏好', () => {
      const result = classifier.detect('我喜欢使用 TypeScript 编写代码');

      expect(result.detected).toBe(true);
      expect(result.type).toBe('like');
      expect(result.subject).toContain('TypeScript');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('应该检测中文不喜欢偏好', () => {
      const result = classifier.detect('我不喜欢使用 JavaScript');

      expect(result.detected).toBe(true);
      expect(result.type).toBe('dislike');
      expect(result.subject).toContain('JavaScript');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('应该检测英文偏好', () => {
      const result = classifier.detect('I prefer using dark mode');

      expect(result.detected).toBe(true);
      expect(result.type).toBe('like');
      expect(result.subject?.toLowerCase()).toContain('dark mode');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('应该检测风格偏好', () => {
      const result = classifier.detect('我喜欢简洁的回答风格');

      expect(result.detected).toBe(true);
      expect(result.type).toBe('style');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('应该检测习惯', () => {
      const result = classifier.detect('我通常在早上编写代码');

      expect(result.detected).toBe(true);
      expect(result.type).toBe('habit');
      expect(result.subject).toContain('编写代码');
    });

    it('应该检测避免行为', () => {
      const result = classifier.detect('请不要给我推荐付费内容');

      expect(result.detected).toBe(true);
      expect(result.type).toBe('avoid');
    });

    it('应该正确处理非偏好文本', () => {
      const result = classifier.detect('今天天气不错');

      expect(result.detected).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('应该在否定词存在时降低置信度', () => {
      const normalResult = classifier.detect('我喜欢 Python');
      const negatedResult = classifier.detect('我喜欢 Python，只是开玩笑');

      expect(normalResult.detected).toBe(true);
      if (negatedResult.detected) {
        expect(negatedResult.confidence).toBeLessThan(normalResult.confidence);
      }
    });

    it('应该批量检测偏好', () => {
      const texts = [
        '我喜欢简洁的回答',
        '今天天气很好',
        '我不喜欢冗长的解释',
        '请用中文回复',
        '这是一个普通问题',
      ];

      const batchResult = classifier.detectBatch(texts);

      // 至少检测到 2 条偏好（风格、不喜欢）
      expect(batchResult.detectedCount).toBeGreaterThanOrEqual(2);
      expect(batchResult.averageConfidence).toBeGreaterThan(0.7);
    });

    it('应该从对话消息中检测偏好', () => {
      const messages = [
        { role: 'user', content: '我喜欢 TypeScript' },
        { role: 'assistant', content: '好的，我会用 TypeScript 示例' },
        { role: 'user', content: '请不要用 JavaScript' },
      ];

      const results = classifier.detectFromMessages(messages);

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some(r => r.type === 'like')).toBe(true);
      expect(results.some(r => r.type === 'avoid')).toBe(true);
    });
  });

  // ========== T018: 偏好存储流程测试 ==========

  describe('T018: 偏好存储流程', () => {
    it('应该存储检测到的偏好', async () => {
      const detection = classifier.detect('我喜欢使用 VS Code 编辑器');

      const result = await handler.handle(detection, {
        sessionKey: 'test-session-1',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('created');
      expect(result.record).toBeDefined();
      expect(result.record?.subject).toContain('VS Code');
    });

    it('应该自动去重相似偏好', async () => {
      // 存储第一个偏好
      const detection1 = classifier.detect('我喜欢 TypeScript');
      await handler.handle(detection1, { sessionKey: 'test-session' });

      // 存储相似偏好（需要相同类型和足够相似的主题）
      const detection2 = classifier.detect('我喜欢 TypeScript');
      const result = await handler.handle(detection2, { sessionKey: 'test-session' });

      // 应该是更新而非创建（完全相同的主题）
      expect(result.action).toBe('updated');
    });

    it('应该更新现有偏好置信度', async () => {
      // 首次存储
      const detection1 = classifier.detect('我喜欢 Python 编程');
      const result1 = await handler.handle(detection1);
      const originalConfidence = result1.record?.confidence ?? 0;

      // 再次提及相同偏好（完全相同）
      const detection2 = classifier.detect('我喜欢 Python 编程');
      const result2 = await handler.handle(detection2);

      // 应该更新而非创建
      expect(result2.action).toBe('updated');
      expect(result2.record?.confidence).toBeGreaterThanOrEqual(originalConfidence);
      expect(result2.record?.accessCount).toBeGreaterThan(0);
    });

    it('应该正确检索存储的偏好', async () => {
      // 存储多个偏好
      await handler.handle(classifier.detect('我喜欢 TypeScript'));
      await handler.handle(classifier.detect('我不喜欢 JavaScript'));
      await handler.handle(classifier.detect('我通常在早上编程'));

      // 检索偏好
      const preferences = await handler.getPreferences();

      expect(preferences.length).toBeGreaterThanOrEqual(3);
    });

    it('应该按类型过滤偏好', async () => {
      // 存储不同类型偏好
      await handler.handle(classifier.detect('我喜欢 Python'));
      await handler.handle(classifier.detect('我不喜欢 Java'));
      await handler.handle(classifier.detect('我习惯在晚上工作'));

      // 只检索喜欢类型
      const likes = await handler.getPreferences(['like']);
      expect(likes.every(p => p.type === 'like')).toBe(true);

      // 只检索不喜欢类型
      const dislikes = await handler.getPreferences(['dislike']);
      expect(dislikes.every(p => p.type === 'dislike')).toBe(true);
    });

    it('应该跳过低置信度偏好', async () => {
      const handler = new PreferenceHandler(store, { minConfidence: 0.9 });

      const detection = {
        detected: true,
        type: 'like' as const,
        subject: '测试偏好',
        content: '喜欢测试偏好',
        confidence: 0.5, // 低置信度
        originalText: '我喜欢测试偏好',
      };

      const result = await handler.handle(detection);

      expect(result.action).toBe('skipped');
    });
  });

  // ========== T019: 偏好检索注入测试 ==========

  describe('T019: 偏好检索注入', () => {
    it('应该构建系统消息', async () => {
      // 存储偏好
      await handler.handle(classifier.detect('我喜欢简洁的回答'));
      await handler.handle(classifier.detect('请不要用专业术语'));

      // 设置偏好提供者
      injector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      // 注入偏好
      const messages: any[] = [];
      const result = await injector.inject(messages);

      expect(result.systemMessage).not.toBeNull();
      expect(result.systemMessage?.role).toBe('system');
      expect(result.injectedCount).toBeGreaterThan(0);
    });

    it('应该遵守 Token 预算', async () => {
      // 存储多个偏好
      for (let i = 0; i < 20; i++) {
        await handler.handle(classifier.detect(`我喜欢偏好项目 ${i}`));
      }

      injector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      // 小预算
      const smallBudget = new TokenBudget({
        total: 1000,
        system: 200,
        tools: 100,
        context: 300,
        rag: 200,
      });

      const result = await injector.inject([], smallBudget);

      expect(result.tokensUsed).toBeLessThanOrEqual(200);
    });

    it('应该按类型过滤偏好', async () => {
      await handler.handle(classifier.detect('我喜欢 TypeScript'));
      await handler.handle(classifier.detect('我不喜欢 JavaScript'));
      await handler.handle(classifier.detect('我习惯早上编程'));

      const filteredInjector = new PreferenceInjector({
        enabled: true,
        includedTypes: ['like'],
      });

      filteredInjector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      const result = await filteredInjector.inject([]);

      expect(result.injectedCount).toBeGreaterThanOrEqual(1);
      // 检查注入的内容应该只有喜欢类型
      const content = result.systemMessage?.content as string;
      expect(content).toContain('喜欢');
    });

    it('应该在禁用时返回空结果', async () => {
      const disabledInjector = new PreferenceInjector({ enabled: false });

      const result = await disabledInjector.inject([]);

      expect(result.systemMessage).toBeNull();
      expect(result.injectedCount).toBe(0);
    });

    it('应该格式化偏好列表', () => {
      const preferences = [
        { id: '1', type: 'like' as const, subject: 'TypeScript', content: '喜欢 TypeScript', confidence: 0.9 },
        { id: '2', type: 'avoid' as const, subject: 'JavaScript', content: '避免 JavaScript', confidence: 0.85 },
      ];

      const formatted = formatPreferences(preferences);

      expect(formatted).toContain('喜欢');
      expect(formatted).toContain('TypeScript');
      expect(formatted).toContain('避免');
    });

    it('应该合并偏好到现有系统提示', () => {
      const existingPrompt = '你是一个 AI 助手。';
      const preferences = [
        { id: '1', type: 'like' as const, subject: '简洁回答', content: '喜欢简洁的回答', confidence: 0.9 },
      ];

      const merged = mergeWithSystemPrompt(existingPrompt, preferences);

      expect(merged).toContain('AI 助手');
      expect(merged).toContain('用户偏好');
    });
  });

  // ========== US1 集成测试：多轮对话偏好保持 ==========

  describe('多轮对话偏好保持', () => {
    it('场景1: 首轮对话告知偏好，后续对话自动遵循', async () => {
      // 第一轮：用户告知偏好
      const firstUserMessage = '我喜欢简洁的回答，不要太长';
      const detection = classifier.detect(firstUserMessage);

      expect(detection.detected).toBe(true);

      // 存储偏好
      const storeResult = await handler.handle(detection, {
        sessionKey: 'conversation-1',
        sourceMessage: firstUserMessage,
      });
      expect(storeResult.success).toBe(true);

      // 第二轮：新对话开始时注入偏好
      injector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      const injectResult = await injector.inject([]);

      // 验证偏好被注入
      expect(injectResult.injectedCount).toBeGreaterThan(0);
      expect(injectResult.systemMessage?.content).toContain('简洁');
    });

    it('场景2: 多种类型偏好同时保持', async () => {
      // 用户告知多种偏好
      await handler.handle(classifier.detect('我喜欢 Python 编程语言'));
      await handler.handle(classifier.detect('我不喜欢 Java'));
      await handler.handle(classifier.detect('请用中文回复'));
      await handler.handle(classifier.detect('我习惯看代码示例'));

      // 检索所有偏好
      const preferences = await handler.getPreferences();
      expect(preferences.length).toBeGreaterThanOrEqual(4);

      // 验证类型多样性
      const types = new Set(preferences.map(p => p.type));
      expect(types.size).toBeGreaterThanOrEqual(3);
    });

    it('场景3: 偏好更新而非重复存储', async () => {
      // 多次提及相同偏好
      await handler.handle(classifier.detect('我喜欢 TypeScript'));
      await handler.handle(classifier.detect('我喜欢 TypeScript')); // 相同文本
      await handler.handle(classifier.detect('我喜欢 TypeScript'));

      // 应该只有一个偏好记录
      const preferences = await handler.getPreferences(['like']);
      const tsPrefs = preferences.filter(p =>
        p.subject.toLowerCase().includes('typescript')
      );

      // 去重后应该只有一条
      expect(tsPrefs.length).toBe(1);
      // 访问次数应该增加（两次更新）
      expect(tsPrefs[0].accessCount).toBeGreaterThanOrEqual(1);
    });

    it('场景4: 偏好跨会话持久化', async () => {
      // 会话1：存储偏好
      await handler.handle(classifier.detect('我喜欢简洁的代码'), {
        sessionKey: 'session-1',
      });

      // 模拟新会话：获取所有偏好
      const allPreferences = await handler.getPreferences();
      expect(allPreferences.length).toBeGreaterThan(0);

      // 新会话注入偏好
      injector.setPreferenceProvider(async () => {
        return allPreferences.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      const result = await injector.inject([]);
      expect(result.injectedCount).toBeGreaterThan(0);
    });

    it('场景5: 偏好置信度影响注入优先级', async () => {
      // 存储不同置信度的偏好
      const highConfidence = classifier.detect('我非常喜欢 Python');
      const lowConfidence = classifier.detect('我喜欢某种语言');

      await handler.handle(highConfidence);
      await handler.handle(lowConfidence);

      // 设置小预算
      const smallBudgetInjector = new PreferenceInjector({
        enabled: true,
        maxTokens: 100,
        maxPreferences: 1,
      });

      smallBudgetInjector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      const result = await smallBudgetInjector.inject([]);

      // 高置信度偏好应该被优先注入
      expect(result.injectedCount).toBe(1);
    });
  });

  // ========== 验收标准测试 ==========

  describe('验收标准', () => {
    it('偏好检测准确率 > 85%', () => {
      // 测试数据集
      const testCases = [
        { text: '我喜欢 Python', expected: true },
        { text: '我不喜欢 Java', expected: true },
        { text: '我想要一个简单的解决方案', expected: true },
        { text: '请使用中文回复', expected: true },
        { text: 'I prefer dark mode', expected: true },
        { text: 'I hate bugs', expected: true },
        { text: '今天天气不错', expected: false },
        { text: '帮我写一个函数', expected: false },
        { text: '这是一个测试', expected: false },
        { text: 'What time is it?', expected: false },
      ];

      let correct = 0;
      for (const { text, expected } of testCases) {
        const result = classifier.detect(text);
        if (result.detected === expected) {
          correct++;
        }
      }

      const accuracy = correct / testCases.length;
      expect(accuracy).toBeGreaterThan(0.85);
    });

    it('支持中文和英文偏好识别', () => {
      const zhResult = classifier.detect('我喜欢使用简洁的代码');
      const enResult = classifier.detect('I prefer using clean code');

      expect(zhResult.detected).toBe(true);
      expect(enResult.detected).toBe(true);
    });

    it('返回置信度分数', () => {
      const result = classifier.detect('我非常喜欢使用 TypeScript');

      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('偏好正确存储并可检索', async () => {
      await handler.handle(classifier.detect('我喜欢 TypeScript'));

      const preferences = await handler.getPreferences();
      expect(preferences.length).toBeGreaterThan(0);
      expect(preferences[0].subject).toContain('TypeScript');
    });

    it('自动去重相似偏好', async () => {
      // 使用完全相同的偏好进行去重测试
      await handler.handle(classifier.detect('我喜欢简洁的回答'));
      await handler.handle(classifier.detect('我喜欢简洁的回答'));

      const preferences = await handler.getPreferences();
      expect(preferences.length).toBe(1);
      // 第二次应该更新访问计数
      expect(preferences[0].accessCount).toBeGreaterThanOrEqual(1);
    });

    it('用户偏好自动注入到系统提示中', async () => {
      await handler.handle(classifier.detect('我喜欢简洁的回答'));

      injector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      const result = await injector.inject([]);

      expect(result.systemMessage).not.toBeNull();
      expect(result.systemMessage?.content).toContain('简洁');
    });

    it('支持 Token 预算控制', async () => {
      // 存储多个偏好
      for (let i = 0; i < 10; i++) {
        await handler.handle(classifier.detect(`我喜欢偏好项目 ${i}`));
      }

      const budgetInjector = new PreferenceInjector({
        enabled: true,
        maxTokens: 100,
      });

      budgetInjector.setPreferenceProvider(async () => {
        const prefs = await handler.getPreferences();
        return prefs.map(p => ({
          id: p.id,
          type: p.type,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
        }));
      });

      const result = await budgetInjector.inject([]);

      expect(result.tokensUsed).toBeLessThanOrEqual(100);
    });
  });
});
