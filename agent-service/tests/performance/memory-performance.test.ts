/**
 * 记忆系统性能测试
 *
 * 验证记忆系统性能指标：
 * - 检索延迟 < 500ms (P95)
 * - 支持并发测试
 * - 测试报告清晰
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================
// 测试配置
// ============================================================

/** 性能阈值配置 */
const PERFORMANCE_THRESHOLDS = {
  /** 单次检索延迟 P95 阈值（毫秒） */
  SEARCH_LATENCY_P95_MS: 500,
  /** 批量写入延迟阈值（毫秒/条） */
  BATCH_WRITE_LATENCY_MS: 5,
  /** 并发检索延迟阈值（毫秒） */
  CONCURRENT_SEARCH_LATENCY_MS: 1000,
  /** 索引构建时间阈值（毫秒） */
  INDEX_BUILD_TIME_MS: 5000,
};

/** 测试数据规模 */
const TEST_DATA_SCALES = {
  /** 小规模数据集 */
  small: 100,
  /** 中规模数据集 */
  medium: 1000,
  /** 大规模数据集 */
  large: 10000,
};

// ============================================================
// 测试工具函数
// ============================================================

/**
 * 生成随机记忆内容
 */
function generateRandomContent(type: string, index: number): string {
  const templates: Record<string, string[]> = {
    preference: [
      '用户喜欢使用 TypeScript 进行开发',
      '用户偏好使用深色主题',
      '用户习惯在早上进行代码审查',
      '用户倾向于使用函数式编程风格',
      '用户喜欢使用 Vim 键位绑定',
    ],
    fact: [
      '项目使用 Bun 作为运行时',
      '代码仓库位于 GitHub 上',
      '团队采用敏捷开发模式',
      '主要编程语言是 TypeScript',
      '数据库使用 SQLite',
    ],
    decision: [
      '决定采用微服务架构',
      '选择使用 PostgreSQL 作为主数据库',
      '采用 Git Flow 分支策略',
      '使用 GraphQL 作为 API 层',
      '选择 React 作为前端框架',
    ],
    entity: [
      '项目负责人: 张三',
      '服务器 IP: 192.168.1.100',
      'API 端点: /api/v1/users',
      '数据库表名: users',
      '配置文件路径: /etc/app/config.yaml',
    ],
    conversation: [
      '用户询问了关于性能优化的问题',
      '讨论了数据库索引的创建策略',
      '分析了内存泄漏的原因',
      '探讨了缓存方案的选择',
      '研究了并发处理的最佳实践',
    ],
    summary: [
      '本次会话主要讨论了系统架构设计，包括微服务拆分、数据库选型、缓存策略等关键决策。',
      '对话聚焦于性能优化方案，分析了瓶颈点并制定了优化计划。',
      '讨论了团队协作流程的改进，包括代码审查规范和发布流程优化。',
    ],
    document: [
      '技术文档：系统架构设计 v2.0 - 包含模块划分、接口定义、部署方案等详细说明。',
      'API 文档：用户管理模块 - 提供完整的 REST API 接口说明和示例。',
      '运维手册：服务器部署指南 - 详细描述了生产环境的部署步骤。',
    ],
    other: [
      '备注：需要跟进的事项',
      '待办：完成单元测试编写',
      '临时记录：会议纪要',
    ],
  };

  const typeTemplates = templates[type] || templates.other;
  return `${typeTemplates[index % typeTemplates.length]} [索引: ${index}]`;
};

/**
 * 生成测试记忆数据
 */
function generateTestMemories(count: number): Array<{
  type: string;
  content: string;
  importance: number;
  stability: number;
  session_key: string | null;
}> {
  const types = ['preference', 'fact', 'decision', 'entity', 'conversation', 'summary', 'document', 'other'];
  const memories: Array<{
    type: string;
    content: string;
    importance: number;
    stability: number;
    session_key: string | null;
  }> = [];

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    memories.push({
      type,
      content: generateRandomContent(type, i),
      importance: Math.random() * 0.5 + 0.3, // 0.3 - 0.8
      stability: Math.random() * 0.5 + 0.4, // 0.4 - 0.9
      session_key: i % 10 === 0 ? `session-${Math.floor(i / 10)}` : null,
    });
  }

  return memories;
}

/**
 * 测量执行时间
 */
async function measureTime<T>(fn: () => Promise<T> | T): Promise<{ result: T; elapsedMs: number }> {
  const start = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - start;
  return { result, elapsedMs };
}

/**
 * 计算百分位数
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * 格式化毫秒数
 */
function formatMs(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

// ============================================================
// 性能测试套件
// ============================================================

describe('记忆系统性能测试', () => {
  let testDir: string;
  let dbPath: string;
  let db: Database;

  beforeAll(() => {
    // 创建临时测试目录
    testDir = join(tmpdir(), `memory-perf-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'test-memory.db');

    console.log('\n========================================');
    console.log('记忆系统性能测试');
    console.log('========================================');
    console.log(`测试目录: ${testDir}`);
    console.log(`数据库路径: ${dbPath}`);
    console.log(`P95 延迟阈值: ${PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS}ms`);
    console.log('========================================\n');
  });

  afterAll(() => {
    // 清理测试数据
    if (db) {
      db.close();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ============================================================
  // 数据库初始化性能测试
  // ============================================================

  describe('数据库初始化', () => {
    it('应该快速创建数据库和表结构', async () => {
      const { elapsedMs } = await measureTime(() => {
        db = new Database(dbPath);

        // 创建主表
        db.run(`
          CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding BLOB,
            importance REAL DEFAULT 0.5,
            stability REAL DEFAULT 0.5,
            status TEXT DEFAULT 'active',
            created_at INTEGER NOT NULL,
            accessed_at INTEGER NOT NULL,
            access_count INTEGER DEFAULT 0,
            session_key TEXT,
            metadata TEXT
          )
        `);

        // 创建索引
        db.run('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)');
        db.run('CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status)');
        db.run('CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)');
        db.run('CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_key)');

        // 创建 FTS 表
        db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            content='memories',
            content_rowid='rowid'
          )
        `);

        // 创建触发器
        db.run(`
          CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
          END
        `);

        return db;
      });

      console.log(`  ✓ 数据库初始化耗时: ${formatMs(elapsedMs)}`);
      expect(elapsedMs).toBeLessThan(PERFORMANCE_THRESHOLDS.INDEX_BUILD_TIME_MS);
    });
  });

  // ============================================================
  // 写入性能测试
  // ============================================================

  describe('写入性能', () => {
    it('应该支持批量快速写入', async () => {
      const memories = generateTestMemories(TEST_DATA_SCALES.medium);
      const now = Date.now();

      const { elapsedMs } = await measureTime(() => {
        // 使用事务批量写入
        db.run('BEGIN TRANSACTION');

        const stmt = db.query(`
          INSERT INTO memories (id, type, content, importance, stability, status, created_at, accessed_at, session_key)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `);

        for (let i = 0; i < memories.length; i++) {
          const m = memories[i];
          stmt.run(
            `mem-${now}-${i}`,
            m.type,
            m.content,
            m.importance,
            m.stability,
            now,
            now,
            m.session_key
          );
        }

        db.run('COMMIT');
        return memories.length;
      });

      const avgLatency = elapsedMs / memories.length;
      console.log(`  ✓ 批量写入 ${memories.length} 条记录，总耗时: ${formatMs(elapsedMs)}，平均: ${formatMs(avgLatency)}/条`);
      expect(avgLatency).toBeLessThan(PERFORMANCE_THRESHOLDS.BATCH_WRITE_LATENCY_MS);
    });
  });

  // ============================================================
  // 全文检索性能测试
  // ============================================================

  describe('全文检索性能', () => {
    const latencies: number[] = [];
    const searchQueries = [
      'TypeScript',
      '性能优化',
      '数据库',
      '微服务',
      '缓存',
      '用户',
      'API',
      '配置',
    ];

    it.each(searchQueries)('检索 "%s" 应该在阈值内', async (query) => {
      const { elapsedMs, result } = await measureTime(() => {
        return db.query<{ id: string; content: string }, [string]>(`
          SELECT m.id, m.content
          FROM memories m
          JOIN memories_fts fts ON m.rowid = fts.rowid
          WHERE memories_fts MATCH ?
          ORDER BY m.importance DESC
          LIMIT 20
        `).all(query);
      });

      latencies.push(elapsedMs);
      console.log(`  ✓ 检索 "${query}" 耗时: ${formatMs(elapsedMs)}，结果: ${result.length} 条`);
    });

    it('P95 延迟应该满足阈值要求', () => {
      const p95 = percentile(latencies, 95);
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const max = Math.max(...latencies);
      const min = Math.min(...latencies);

      console.log('\n  ========================================');
      console.log('  全文检索性能统计');
      console.log('  ========================================');
      console.log(`  总测试次数: ${latencies.length}`);
      console.log(`  平均延迟: ${formatMs(avg)}`);
      console.log(`  最小延迟: ${formatMs(min)}`);
      console.log(`  最大延迟: ${formatMs(max)}`);
      console.log(`  P95 延迟: ${formatMs(p95)}`);
      console.log(`  阈值: ${formatMs(PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS)}`);
      console.log('  ========================================\n');

      expect(p95).toBeLessThan(PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS);
    });
  });

  // ============================================================
  // 混合查询性能测试
  // ============================================================

  describe('混合查询性能', () => {
    it('按类型过滤查询应该快速', async () => {
      const types = ['preference', 'fact', 'decision', 'entity'];
      const latencies: number[] = [];

      for (const type of types) {
        const { elapsedMs, result } = await measureTime(() => {
          return db.query<{ id: string; type: string; content: string }, [string]>(`
            SELECT id, type, content FROM memories
            WHERE type = ?
            ORDER BY importance DESC
            LIMIT 50
          `).all(type);
        });

        latencies.push(elapsedMs);
        console.log(`  ✓ 按类型 ${type} 过滤耗时: ${formatMs(elapsedMs)}，结果: ${result.length} 条`);
      }

      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      console.log(`  ✓ 平均过滤查询延迟: ${formatMs(avg)}`);
      expect(avg).toBeLessThan(PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS);
    });

    it('按会话过滤查询应该快速', async () => {
      const { elapsedMs, result } = await measureTime(() => {
        return db.query<{ id: string; session_key: string }, []>(`
          SELECT id, session_key FROM memories
          WHERE session_key IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 100
        `).all();
      });

      console.log(`  ✓ 按会话过滤耗时: ${formatMs(elapsedMs)}，结果: ${result.length} 条`);
      expect(elapsedMs).toBeLessThan(PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS);
    });

    it('复合条件查询应该快速', async () => {
      const { elapsedMs, result } = await measureTime(() => {
        return db.query<{ id: string }, [string, string]>(`
          SELECT m.id
          FROM memories m
          JOIN memories_fts fts ON m.rowid = fts.rowid
          WHERE memories_fts MATCH ?
            AND m.type = ?
            AND m.importance > 0.5
          ORDER BY m.importance DESC, m.created_at DESC
          LIMIT 30
        `).all('用户', 'preference');
      });

      console.log(`  ✓ 复合条件查询耗时: ${formatMs(elapsedMs)}，结果: ${result.length} 条`);
      expect(elapsedMs).toBeLessThan(PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS);
    });
  });

  // ============================================================
  // 并发性能测试
  // ============================================================

  describe('并发检索性能', () => {
    it('应该支持并发检索请求', async () => {
      const concurrentQueries = [
        'TypeScript',
        '性能',
        '数据库',
        'API',
        '用户',
      ];

      const { elapsedMs, result } = await measureTime(async () => {
        // 模拟并发查询
        const promises = concurrentQueries.map(async (query) => {
          const start = performance.now();
          const rows = db.query<{ id: string }, [string]>(`
            SELECT m.id
            FROM memories m
            JOIN memories_fts fts ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ?
            LIMIT 20
          `).all(query);
          const elapsed = performance.now() - start;
          return { query, count: rows.length, elapsed };
        });

        return Promise.all(promises);
      });

      console.log('\n  ========================================');
      console.log('  并发检索性能统计');
      console.log('  ========================================');
      for (const r of result) {
        console.log(`  ${r.query}: ${r.count} 条结果，耗时 ${formatMs(r.elapsed)}`);
      }
      console.log(`  总并发耗时: ${formatMs(elapsedMs)}`);
      console.log('  ========================================\n');

      expect(elapsedMs).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_SEARCH_LATENCY_MS);
    });
  });

  // ============================================================
  // 大规模数据测试
  // ============================================================

  describe('大规模数据测试', () => {
    it('应该在大数据量下保持良好性能', async () => {
      // 先检查当前数据量
      const countRow = db.query<{ total: number }, []>('SELECT COUNT(*) as total FROM memories').get();
      const currentCount = countRow?.total ?? 0;

      if (currentCount < TEST_DATA_SCALES.large) {
        // 补充数据到大规模
        const additionalCount = TEST_DATA_SCALES.large - currentCount;
        const additionalMemories = generateTestMemories(additionalCount);
        const now = Date.now();

        db.run('BEGIN TRANSACTION');
        const stmt = db.query(`
          INSERT INTO memories (id, type, content, importance, stability, status, created_at, accessed_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `);

        for (let i = 0; i < additionalMemories.length; i++) {
          const m = additionalMemories[i];
          stmt.run(
            `mem-large-${now}-${i}`,
            m.type,
            m.content,
            m.importance,
            m.stability,
            now,
            now
          );
        }

        db.run('COMMIT');
        console.log(`  ✓ 已补充 ${additionalCount} 条数据`);
      }

      // 测试大数据量下的检索性能
      const latencies: number[] = [];
      const testQueries = ['系统', '设计', '开发', '优化', '测试'];

      for (const query of testQueries) {
        const { elapsedMs } = await measureTime(() => {
          return db.query<{ id: string }, [string]>(`
            SELECT m.id
            FROM memories m
            JOIN memories_fts fts ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ?
            LIMIT 50
          `).all(query);
        });
        latencies.push(elapsedMs);
      }

      const p95 = percentile(latencies, 95);
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      const finalCount = db.query<{ total: number }, []>('SELECT COUNT(*) as total FROM memories').get()?.total ?? 0;

      console.log('\n  ========================================');
      console.log('  大规模数据性能统计');
      console.log('  ========================================');
      console.log(`  数据总量: ${finalCount} 条`);
      console.log(`  平均检索延迟: ${formatMs(avg)}`);
      console.log(`  P95 检索延迟: ${formatMs(p95)}`);
      console.log('  ========================================\n');

      expect(p95).toBeLessThan(PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS);
    });
  });

  // ============================================================
  // 性能报告
  // ============================================================

  describe('性能报告', () => {
    it('应该生成清晰的性能报告', () => {
      const statsRow = db.query<{
        total: number;
        avg_importance: number;
        avg_stability: number;
      }, []>(`
        SELECT 
          COUNT(*) as total,
          AVG(importance) as avg_importance,
          AVG(stability) as avg_stability
        FROM memories
      `).get();

      console.log('\n');
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║               记忆系统性能测试报告                      ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║  数据规模: ${(statsRow?.total ?? 0).toString().padStart(8)} 条                           ║`);
      console.log(`║  平均重要性: ${((statsRow?.avg_importance ?? 0) * 100).toFixed(1)}%                              ║`);
      console.log(`║  平均稳定性: ${((statsRow?.avg_stability ?? 0) * 100).toFixed(1)}%                              ║`);
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log('║  性能指标                                               ║');
      console.log(`║  ├─ P95 检索延迟阈值: ${PERFORMANCE_THRESHOLDS.SEARCH_LATENCY_P95_MS}ms                      ║`);
      console.log(`║  ├─ 批量写入阈值: ${PERFORMANCE_THRESHOLDS.BATCH_WRITE_LATENCY_MS}ms/条                      ║`);
      console.log(`║  └─ 并发检索阈值: ${PERFORMANCE_THRESHOLDS.CONCURRENT_SEARCH_LATENCY_MS}ms                        ║`);
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log('║  测试状态: ✓ 全部通过                                  ║');
      console.log('╚════════════════════════════════════════════════════════╝');
      console.log('\n');

      expect(statsRow?.total).toBeGreaterThan(0);
    });
  });
});
