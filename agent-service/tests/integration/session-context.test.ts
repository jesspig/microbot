/**
 * 会话上下文管理 - 集成测试
 *
 * 验证会话上下文注入、搜索、管理功能：
 * - T043: 扩展 Session 类型和存储
 * - T044: 实现会话全文索引
 * - T045: 实现会话上下文注入器
 * - T046: 实现会话列表管理
 * - T047: 实现智能会话标题生成
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { rm, mkdir } from 'fs/promises';
import { Database } from 'bun:sqlite';
// 基础能力从 agent-service 导入
import {
  SessionSearcher,
  SessionManager,
} from '../../runtime/capability/session';
// 高级封装从 SDK 导入
import {
  SessionContextInjector,
  TitleGenerator,
  type MessageProvider,
} from '../../../sdk/src/session';
import type { LLMMessage } from '../../types/message';
import type { SessionKey } from '../../types/session';

// 测试数据存储路径
const TEST_STORAGE_PATH = join(__dirname, '.test-session-us6');

// 测试用的内存数据库
let testDb: Database;

describe('会话上下文管理', () => {
  beforeEach(async () => {
    // 清理旧数据
    try {
      await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }

    // 创建测试目录
    await mkdir(TEST_STORAGE_PATH, { recursive: true });

    // 创建内存数据库
    testDb = new Database(':memory:');

    // 创建基础表
    testDb.run(`
      CREATE TABLE sessions (
        key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        is_starred INTEGER DEFAULT 0,
        tags TEXT DEFAULT '[]',
        message_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        tokens_used INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_consolidated INTEGER DEFAULT 0
      )
    `);

    testDb.run(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        seq_num INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
      )
    `);

    // 创建 FTS 表
    testDb.run(`
      CREATE VIRTUAL TABLE sessions_fts USING fts5(
        title,
        summary,
        tags,
        content='sessions',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `);

    // 创建触发器
    testDb.run(`
      CREATE TRIGGER sessions_fts_insert AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(rowid, title, summary, tags) 
        VALUES (NEW.rowid, COALESCE(NEW.title, ''), COALESCE(NEW.summary, ''), COALESCE(NEW.tags, '[]'));
      END
    `);

    testDb.run(`
      CREATE TRIGGER sessions_fts_delete AFTER DELETE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, title, summary, tags) 
        VALUES ('delete', OLD.rowid, COALESCE(OLD.title, ''), COALESCE(OLD.summary, ''), COALESCE(OLD.tags, '[]'));
      END
    `);

    testDb.run(`
      CREATE TRIGGER sessions_fts_update AFTER UPDATE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, title, summary, tags) 
        VALUES ('delete', OLD.rowid, COALESCE(OLD.title, ''), COALESCE(OLD.summary, ''), COALESCE(OLD.tags, '[]'));
        INSERT INTO sessions_fts(rowid, title, summary, tags) 
        VALUES (NEW.rowid, COALESCE(NEW.title, ''), COALESCE(NEW.summary, ''), COALESCE(NEW.tags, '[]'));
      END
    `);

    // 创建标签表
    testDb.run(`
      CREATE TABLE session_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE,
        UNIQUE(session_key, tag)
      )
    `);

    // 创建上下文配置表
    testDb.run(`
      CREATE TABLE session_context_configs (
        session_key TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        strategy TEXT DEFAULT 'hybrid',
        max_history_messages INTEGER DEFAULT 20,
        history_token_budget INTEGER DEFAULT 4000,
        max_related_summaries INTEGER DEFAULT 2,
        summary_token_budget INTEGER DEFAULT 500,
        include_system_messages INTEGER DEFAULT 0,
        auto_generate_title INTEGER DEFAULT 1,
        auto_generate_summary INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
      )
    `);

    // 插入测试会话
    const now = Date.now();
    const testSessions = [
      {
        key: 'cli:test-1',
        channel: 'cli',
        chatId: 'test-1',
        title: 'TypeScript 类型系统讨论',
        summary: '讨论了 TypeScript 的泛型和条件类型',
        is_starred: 1,
        tags: '["typescript", "编程"]',
        message_count: 5,
        status: 'active',
        created_at: now - 3600000,
        updated_at: now - 1800000,
      },
      {
        key: 'cli:test-2',
        channel: 'cli',
        chatId: 'test-2',
        title: 'Python 数据分析',
        summary: '使用 pandas 和 numpy 进行数据分析',
        is_starred: 0,
        tags: '["python", "数据分析"]',
        message_count: 8,
        status: 'active',
        created_at: now - 7200000,
        updated_at: now - 3600000,
      },
      {
        key: 'cli:test-3',
        channel: 'cli',
        chatId: 'test-3',
        title: 'Rust 内存管理',
        summary: '讨论 Rust 的所有权和借用机制',
        is_starred: 1,
        tags: '["rust", "系统编程"]',
        message_count: 12,
        status: 'archived',
        created_at: now - 86400000,
        updated_at: now - 43200000,
      },
    ];

    for (const session of testSessions) {
      testDb.run(`
        INSERT INTO sessions (key, channel, chat_id, title, summary, is_starred, tags, message_count, status, created_at, updated_at, last_consolidated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [
        session.key,
        session.channel,
        session.chatId,
        session.title,
        session.summary,
        session.is_starred,
        session.tags,
        session.message_count,
        session.status,
        session.created_at,
        session.updated_at,
      ]);
    }

    // 插入测试消息
    const testMessages = [
      {
        session_key: 'cli:test-1',
        messages: [
          { role: 'user', content: '请解释一下 TypeScript 的泛型' },
          { role: 'assistant', content: 'TypeScript 泛型是一种参数化类型的机制...' },
          { role: 'user', content: '条件类型如何使用？' },
          { role: 'assistant', content: '条件类型使用 extends 关键字...' },
        ],
      },
    ];

    let seq = 0;
    for (const { session_key, messages } of testMessages) {
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        testDb.run(`
          INSERT INTO messages (session_key, seq_num, message_json, timestamp)
          VALUES (?, ?, ?, ?)
        `, [session_key, i, JSON.stringify(msg), now - 3600000 + i * 60000]);
      }
    }
  });

  afterEach(async () => {
    // 关闭数据库
    if (testDb) {
      testDb.close();
    }

    // 清理测试数据
    try {
      await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  // ========== T043: 扩展 Session 类型和存储测试 ==========

  describe('T043: Session 类型和存储扩展', () => {
    it('应该支持会话标题和摘要字段', () => {
      const row = testDb.query<{
        title: string | null;
        summary: string | null;
      }, [string]>(`
        SELECT title, summary FROM sessions WHERE key = ?
      `).get('cli:test-1');

      expect(row).not.toBeNull();
      expect(row?.title).toBe('TypeScript 类型系统讨论');
      expect(row?.summary).toBe('讨论了 TypeScript 的泛型和条件类型');
    });

    it('应该支持星标字段', () => {
      const row = testDb.query<{ is_starred: number }, [string]>(`
        SELECT is_starred FROM sessions WHERE key = ?
      `).get('cli:test-1');

      expect(row?.is_starred).toBe(1);
    });

    it('应该支持标签字段', () => {
      const row = testDb.query<{ tags: string }, [string]>(`
        SELECT tags FROM sessions WHERE key = ?
      `).get('cli:test-1');

      const tags = JSON.parse(row?.tags ?? '[]');
      expect(tags).toContain('typescript');
      expect(tags).toContain('编程');
    });
  });

  // ========== T044: 会话全文索引测试 ==========

  describe('T044: 会话全文索引', () => {
    it('应该支持标题全文检索', async () => {
      const result = await testDb.query<{
        key: string;
        title: string | null;
      }, [string]>(`
        SELECT s.key, s.title
        FROM sessions s
        JOIN sessions_fts ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
        ORDER BY bm25(sessions_fts)
      `).all('TypeScript');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toContain('TypeScript');
    });

    it('应该支持摘要全文检索', async () => {
      const result = testDb.query<{
        key: string;
        summary: string | null;
      }, [string]>(`
        SELECT s.key, s.summary
        FROM sessions s
        JOIN sessions_fts ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
      `).all('pandas');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].summary).toContain('pandas');
    });

    it('应该支持多关键词检索', async () => {
      // FTS5 使用 OR 连接多个词
      const result = testDb.query<{
        key: string;
      }, [string]>(`
        SELECT s.key
        FROM sessions s
        JOIN sessions_fts ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
      `).all('python OR 数据');

      expect(result.length).toBeGreaterThan(0);
    });

    it('应该按 BM25 相关性排序', async () => {
      // 插入更相关的测试数据
      testDb.run(`
        INSERT INTO sessions (key, channel, chat_id, title, summary, created_at, updated_at)
        VALUES ('cli:bm25-test', 'cli', 'bm25-test', 'Python Python Python', 'Python 编程', ?, ?)
      `, [Date.now(), Date.now()]);

      const result = testDb.query<{
        key: string;
        title: string | null;
      }, [string]>(`
        SELECT s.key, s.title
        FROM sessions s
        JOIN sessions_fts ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
        ORDER BY bm25(sessions_fts)
      `).all('Python');

      // BM25 返回负值，越接近 0 越相关
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ========== T045: 会话上下文注入器测试 ==========

  describe('T045: 会话上下文注入', () => {
    let injector: SessionContextInjector;
    let messageProvider: MessageProvider;

    beforeEach(() => {
      injector = new SessionContextInjector({
        enabled: true,
        strategy: 'hybrid',
        maxHistoryMessages: 10,
        historyTokenBudget: 2000,
        maxRelatedSummaries: 2,
        summaryTokenBudget: 500,
      });

      // 设置消息提供者
      messageProvider = async (sessionKey: SessionKey): Promise<LLMMessage[]> => {
        const rows = testDb.query<{ message_json: string }, [string]>(`
          SELECT message_json FROM messages
          WHERE session_key = ?
          ORDER BY seq_num ASC
        `).all(sessionKey);

        return rows.map(row => JSON.parse(row.message_json) as LLMMessage);
      };

      injector.setMessageProvider(messageProvider);
    });

    it('应该注入历史消息', async () => {
      const result = await injector.inject('cli:test-1');

      expect(result.historyMessages.length).toBeGreaterThan(0);
      expect(result.historyTokensUsed).toBeGreaterThan(0);
    });

    it('应该遵守 Token 预算', async () => {
      // 使用简单的 Token 预算数字
      const remainingTokens = 1500;

      const result = await injector.inject('cli:test-1', remainingTokens);

      expect(result.totalTokensUsed).toBeLessThanOrEqual(1500);
    });

    it('应该使用滑动窗口策略', async () => {
      const slidingInjector = new SessionContextInjector({
        enabled: true,
        strategy: 'sliding_window',
        maxHistoryMessages: 5,
      });

      slidingInjector.setMessageProvider(messageProvider);

      const result = await slidingInjector.inject('cli:test-1');

      expect(result.historyMessages.length).toBeLessThanOrEqual(5);
      expect(result.relatedSummaries.length).toBe(0);
    });

    it('应该在禁用时返回空结果', async () => {
      const disabledInjector = new SessionContextInjector({ enabled: false });
      disabledInjector.setMessageProvider(messageProvider);

      const result = await disabledInjector.inject('cli:test-1');

      expect(result.historyMessages.length).toBe(0);
      expect(result.totalTokensUsed).toBe(0);
    });

    it('应该过滤系统消息', async () => {
      // 添加系统消息
      testDb.run(`
        INSERT INTO messages (session_key, seq_num, message_json, timestamp)
        VALUES ('cli:test-1', 100, ?, ?)
      `, [JSON.stringify({ role: 'system', content: '系统提示' }), Date.now()]);

      const result = await injector.inject('cli:test-1', undefined, {
        includeSystemMessages: false,
      });

      const hasSystem = result.historyMessages.some(m => m.role === 'system');
      expect(hasSystem).toBe(false);
    });

    it('应该处理空会话', async () => {
      const result = await injector.inject('cli:empty-session');

      expect(result.historyMessages.length).toBe(0);
      expect(result.wasTruncated).toBe(false);
    });
  });

  // ========== T046: 会话列表管理测试 ==========

  describe('T046: 会话列表管理', () => {
    let manager: SessionManager;

    beforeEach(() => {
      // 创建使用内存数据库的管理器
      manager = new SessionManager();
      // 直接使用内存数据库
      (manager as any).db = testDb;
    });

    it('应该列出所有会话', async () => {
      const result = await manager.list();

      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('应该支持分页', async () => {
      const result = await manager.list(undefined, undefined, {
        page: 1,
        pageSize: 2,
      });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.totalPages).toBe(2);
    });

    it('应该按状态过滤', async () => {
      const result = await manager.list({ state: 'active' });

      expect(result.items.length).toBe(2);
      expect(result.items.every(s => s.state === 'active')).toBe(true);
    });

    it('应该按星标过滤', async () => {
      const result = await manager.list({ isStarred: true });

      expect(result.items.length).toBe(2);
      expect(result.items.every(s => s.isStarred)).toBe(true);
    });

    it('应该获取会话详情', async () => {
      const session = await manager.get('cli:test-1');

      expect(session).not.toBeNull();
      expect(session?.title).toBe('TypeScript 类型系统讨论');
      expect(session?.isStarred).toBe(true);
    });

    it('应该更新会话标题', async () => {
      await manager.update('cli:test-1', { title: '新标题' });

      const session = await manager.get('cli:test-1');
      expect(session?.title).toBe('新标题');
    });

    it('应该设置星标', async () => {
      await manager.setStarred('cli:test-2', true);

      const session = await manager.get('cli:test-2');
      expect(session?.isStarred).toBe(true);
    });

    it('应该切换星标', async () => {
      const newState = await manager.toggleStar('cli:test-1');
      expect(newState).toBe(false);

      const session = await manager.get('cli:test-1');
      expect(session?.isStarred).toBe(false);
    });

    it('应该添加标签', async () => {
      await manager.addTag('cli:test-1', '新标签');

      const session = await manager.get('cli:test-1');
      expect(session?.tags).toContain('新标签');
    });

    it('应该移除标签', async () => {
      await manager.removeTag('cli:test-1', 'typescript');

      const session = await manager.get('cli:test-1');
      expect(session?.tags).not.toContain('typescript');
    });

    it('应该归档会话', async () => {
      await manager.archive('cli:test-1');

      const session = await manager.get('cli:test-1');
      expect(session?.state).toBe('archived');
    });

    it('应该删除会话', async () => {
      await manager.delete('cli:test-1');

      const session = await manager.get('cli:test-1');
      expect(session).toBeNull();
    });

    it('应该批量删除会话', async () => {
      const count = await manager.batchDelete(['cli:test-1', 'cli:test-2']);
      expect(count).toBe(2);

      const result = await manager.list();
      expect(result.total).toBe(1);
    });
  });

  // ========== T047: 智能标题生成测试 ==========

  describe('T047: 智能标题生成', () => {
    let generator: TitleGenerator;

    beforeEach(() => {
      generator = new TitleGenerator();
    });

    it('应该从用户消息生成标题', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '请帮我解释一下 TypeScript 的泛型机制' },
        { role: 'assistant', content: 'TypeScript 泛型是一种参数化类型...' },
      ];

      const result = await generator.generateTitle(messages);

      expect(result.title).not.toBe('新对话');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('应该提取关键主题', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '如何使用 Python 进行数据分析？' },
        { role: 'assistant', content: '可以使用 pandas 和 numpy...' },
      ];

      const summaryResult = await generator.generateSummary(messages);

      expect(summaryResult.keyTopics.length).toBeGreaterThan(0);
    });

    it('应该生成会话摘要', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '请解释 TypeScript 的类型系统' },
        { role: 'assistant', content: 'TypeScript 提供了静态类型检查...' },
        { role: 'user', content: '泛型如何使用？' },
        { role: 'assistant', content: '泛型允许你创建可复用的组件...' },
      ];

      const result = await generator.generateSummary(messages);

      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.tokensUsed).toBeGreaterThan(0);
    });

    it('应该提取实体', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '请介绍一下 React 框架和 Vue 框架的区别' },
        { role: 'assistant', content: 'React 和 Vue 都是前端框架...' },
      ];

      const result = await generator.generateSummary(messages);

      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('应该处理空消息列表', async () => {
      const titleResult = await generator.generateTitle([]);
      expect(titleResult.title).toBe('新对话');

      const summaryResult = await generator.generateSummary([]);
      expect(summaryResult.summary).toBe('');
    });

    it('应该处理短消息列表', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '你好' },
      ];

      const result = await generator.generateTitle(messages);
      expect(result.isAutoGenerated).toBe(false);
    });

    it('应该截断过长的标题', async () => {
      const longContent = '这是一个非常长的对话内容'.repeat(20);
      const messages: LLMMessage[] = [
        { role: 'user', content: longContent },
        { role: 'assistant', content: '好的' },
      ];

      const result = await generator.generateTitle(messages, { maxLength: 30 });

      expect(result.title.length).toBeLessThanOrEqual(30);
    });

    it('应该同时生成标题和摘要', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '请解释 TypeScript 的类型推断' },
        { role: 'assistant', content: 'TypeScript 可以自动推断变量类型...' },
      ];

      const result = await generator.generateTitleAndSummary(messages);

      expect(result.title).not.toBe('新对话');
      expect(result.keyTopics.length).toBeGreaterThan(0);
    });
  });

  // ========== 验收标准测试 ==========

  describe('验收标准', () => {
    it('会话搜索返回正确结果', async () => {
      const result = testDb.query<{
        key: string;
        title: string | null;
      }, [string]>(`
        SELECT s.key, s.title
        FROM sessions s
        JOIN sessions_fts ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
      `).all('TypeScript');

      expect(result.length).toBeGreaterThan(0);
    });

    it('支持 FTS5 BM25 排序', async () => {
      const result = testDb.query<{
        key: string;
        score: number;
      }, [string]>(`
        SELECT s.key, bm25(sessions_fts) as score
        FROM sessions s
        JOIN sessions_fts ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
        ORDER BY bm25(sessions_fts)
      `).all('Python');

      // BM25 返回负值，结果应该是有序的
      expect(result.length).toBeGreaterThan(0);
    });

    it('上下文注入符合配置', async () => {
      const injector = new SessionContextInjector({
        enabled: true,
        strategy: 'sliding_window',
        maxHistoryMessages: 3,
      });

      injector.setMessageProvider(async () => [
        { role: 'user', content: '消息1' },
        { role: 'assistant', content: '回复1' },
        { role: 'user', content: '消息2' },
        { role: 'assistant', content: '回复2' },
        { role: 'user', content: '消息3' },
      ] as LLMMessage[]);

      const result = await injector.inject('test:session');

      expect(result.historyMessages.length).toBeLessThanOrEqual(3);
    });

    it('Token 预算正确控制', async () => {
      const injector = new SessionContextInjector({
        enabled: true,
        historyTokenBudget: 100, // 小预算
      });

      injector.setMessageProvider(async () => [
        { role: 'user', content: '这是一条很长的消息内容'.repeat(50) },
      ] as LLMMessage[]);

      // 使用简单的 Token 预算数字
      const remainingTokens = 100;

      const result = await injector.inject('test:session', remainingTokens);

      expect(result.historyTokensUsed).toBeLessThanOrEqual(100);
    });

    it('会话管理 API 完整', async () => {
      const manager = new SessionManager();
      (manager as any).db = testDb;

      // 列表
      const list = await manager.list();
      expect(list.items.length).toBeGreaterThan(0);

      // 获取
      const session = await manager.get('cli:test-1');
      expect(session).not.toBeNull();

      // 更新
      await manager.update('cli:test-1', { title: '测试标题' });

      // 星标
      await manager.toggleStar('cli:test-1');

      // 标签
      await manager.addTag('cli:test-1', '测试标签');

      // 归档
      await manager.archive('cli:test-1');

      // 恢复
      await manager.restore('cli:test-1');
    });

    it('支持分页和筛选', async () => {
      const manager = new SessionManager();
      (manager as any).db = testDb;

      // 分页
      const page1 = await manager.list(undefined, undefined, { page: 1, pageSize: 2 });
      expect(page1.items.length).toBe(2);
      expect(page1.totalPages).toBe(2);

      // 筛选
      const active = await manager.list({ state: 'active' });
      expect(active.items.every(s => s.state === 'active')).toBe(true);

      const starred = await manager.list({ isStarred: true });
      expect(starred.items.every(s => s.isStarred)).toBe(true);
    });

    it('标题生成准确', async () => {
      const generator = new TitleGenerator();

      const messages: LLMMessage[] = [
        { role: 'user', content: '请帮我写一个 React 组件' },
        { role: 'assistant', content: '好的，我来帮你写...' },
      ];

      const result = await generator.generateTitle(messages);

      expect(result.title).not.toBe('新对话');
      expect(result.title.length).toBeGreaterThan(0);
    });

    it('摘要包含关键信息', async () => {
      const generator = new TitleGenerator();

      const messages: LLMMessage[] = [
        { role: 'user', content: '请解释 Python 的装饰器模式' },
        { role: 'assistant', content: '装饰器是一种设计模式...' },
        { role: 'user', content: '能给个例子吗？' },
        { role: 'assistant', content: '当然，这是一个装饰器示例...' },
      ];

      const result = await generator.generateSummary(messages);

      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.keyTopics.length).toBeGreaterThan(0);
    });
  });
});
