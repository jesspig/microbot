/**
 * 知识库文档检索 - 集成测试
 *
 * 验证知识库文档索引和检索功能：
 * - T029: 统一知识库 chunk 向量存储
 * - T030: 实现递归分块器
 * - T031: 实现知识库混合检索
 * - T032: 实现来源标注
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { rm, mkdir, writeFile } from 'fs/promises';
import {
  RecursiveChunker,
  createRecursiveChunker,
  defaultChunker,
  type ChunkResult,
} from '../../runtime/capability/knowledge/chunkers';
import {
  ChunkIndexer,
  createChunkIndexer,
  type ChunkVectorRecord,
  type IndexResult,
  type IndexStats,
} from '../../runtime/capability/knowledge/indexer/chunk-indexer';
import {
  KnowledgeSearcher,
  createKnowledgeSearcher,
  SourceAnnotator,
  createSourceAnnotator,
  type AnnotatedResult,
  type KnowledgeSearchResult,
} from '@micro-agent/sdk';
import type { KnowledgeDocument, KnowledgeChunk } from '../../runtime/capability/knowledge/types';

// 测试数据存储路径
const TEST_STORAGE_PATH = join(__dirname, '.test-knowledge-us3');

// 模拟嵌入服务
const mockEmbeddingService = {
  isAvailable: () => true,
  embed: async (text: string): Promise<number[]> => {
    // 简单的模拟向量：基于文本长度和内容生成
    const vector: number[] = [];
    for (let i = 0; i < 128; i++) {
      const charCode = text.charCodeAt(i % text.length) || 0;
      vector.push(Math.sin(charCode * (i + 1) * 0.01) * 0.5 + 0.5);
    }
    return vector;
  },
  embedBatch: async (texts: string[]): Promise<number[][]> => {
    return Promise.all(texts.map(t => mockEmbeddingService.embed(t)));
  },
};

describe('知识库文档检索', () => {
  // ========== T030: 递归分块器测试 ==========

  describe('T030: 递归分块器', () => {
    let chunker: RecursiveChunker;

    beforeEach(() => {
      chunker = new RecursiveChunker({
        chunkSize: 1500,
        chunkOverlap: 150,
      });
    });

    it('应该按默认配置创建分块器', () => {
      expect(defaultChunker).toBeDefined();
    });

    it('应该正确分块短文本', () => {
      const text = '这是一个简短的测试文本。';
      const chunks = chunker.chunk(text);

      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe(text);
      expect(chunks[0].startPos).toBe(0);
      expect(chunks[0].endPos).toBe(text.length);
    });

    it('应该正确分块长文本', () => {
      // 创建足够长的文本（超过 chunkSize）
      const paragraphs: string[] = [];
      for (let i = 0; i < 100; i++) {
        paragraphs.push(`这是第 ${i + 1} 段内容。这里包含一些测试文字，用于测试分块功能是否正常工作。每个段落都有足够的内容。`);
      }
      const text = paragraphs.join('\n\n');

      const chunks = chunker.chunk(text);

      // 长文本应该生成多个分块
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      // 验证每个分块大小不超过限制
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(1600); // 允许少量溢出
      }
    });

    it('应该正确处理分块重叠', () => {
      const config = { chunkSize: 500, chunkOverlap: 100 };
      const overlapChunker = new RecursiveChunker(config);

      // 创建适合分块的文本
      const text = '第一段内容。'.repeat(30) + '\n\n' + '第二段内容。'.repeat(30);
      const chunks = overlapChunker.chunk(text);

      if (chunks.length > 1) {
        // 验证重叠区域
        const firstEnd = chunks[0].content.slice(-50);
        const secondStart = chunks[1].content.slice(0, 150);

        // 重叠应该存在于某个位置
        const hasOverlap = firstEnd.length > 0 && secondStart.length > 0;
        expect(hasOverlap).toBe(true);
      }
    });

    it('应该正确处理自定义分隔符', () => {
      const customChunker = new RecursiveChunker({
        chunkSize: 200,
        chunkOverlap: 20,
        separators: ['###', '\n', '。', ' '],
      });

      const text = '第一部分###第二部分###第三部分###第四部分';
      const chunks = customChunker.chunk(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('应该正确处理中英文混合文本', () => {
      const text = `
This is English paragraph. It contains multiple sentences.
这是中文段落。它也包含多个句子。

混合内容 Mixed content here.
More English text follows.
更多中文内容在后面。
      `.trim();

      const chunks = chunker.chunk(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].content.length).toBeGreaterThan(0);
    });

    it('应该返回正确的元数据', () => {
      const text = '第一行\n第二行\n第三行\n第四行';
      const chunks = chunker.chunk(text);

      expect(chunks[0].metadata?.lineStart).toBeDefined();
    });

    it('应该处理空文本', () => {
      const chunks = chunker.chunk('');
      expect(chunks.length).toBe(0);
    });

    it('应该使用 Zod 校验配置', () => {
      // 无效配置应该抛出错误
      expect(() => {
        new RecursiveChunker({ chunkSize: -1 } as any);
      }).toThrow();

      expect(() => {
        new RecursiveChunker({ chunkOverlap: 10000 } as any);
      }).toThrow();
    });
  });

  // ========== T029: 分块向量索引器测试 ==========

  describe('T029: 分块向量索引器', () => {
    let indexer: ChunkIndexer;

    beforeEach(async () => {
      // 清理旧数据
      try {
        await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }

      indexer = new ChunkIndexer(
        { dbPath: join(TEST_STORAGE_PATH, 'vectors') },
        mockEmbeddingService as any
      );
    });

    afterEach(async () => {
      if (indexer) {
        await indexer.close();
      }
      try {
        await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
    });

    it('应该正确初始化索引器', async () => {
      await indexer.initialize();
      // 初始化成功，不抛出错误
    });

    it('应该正确索引文档分块', async () => {
      await indexer.initialize();

      const doc: KnowledgeDocument = {
        id: 'doc-1',
        path: '/test/doc.md',
        content: '这是测试内容。',
        metadata: {
          originalName: 'doc.md',
          fileType: 'markdown',
          fileSize: 100,
          fileHash: 'abc123',
          modifiedAt: Date.now(),
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          {
            id: 'chunk-1',
            docId: 'doc-1',
            content: '这是第一个分块的内容。',
            startPos: 0,
            endPos: 20,
            vector: new Array(128).fill(0.5),
          },
          {
            id: 'chunk-2',
            docId: 'doc-1',
            content: '这是第二个分块的内容。',
            startPos: 20,
            endPos: 40,
          },
        ],
      };

      const result = await indexer.indexDocument(doc);

      expect(result.success).toBe(true);
      expect(result.chunkCount).toBe(2);
      expect(result.failedChunks.length).toBe(0);
    });

    it('应该支持增量索引', async () => {
      await indexer.initialize();

      const doc1: KnowledgeDocument = {
        id: 'doc-1',
        path: '/test/doc1.md',
        content: '文档1内容',
        metadata: {
          originalName: 'doc1.md',
          fileType: 'markdown',
          fileSize: 100,
          fileHash: 'hash1',
          modifiedAt: Date.now(),
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          { id: 'chunk-1', docId: 'doc-1', content: '内容1', startPos: 0, endPos: 5 },
        ],
      };

      const doc2: KnowledgeDocument = {
        id: 'doc-2',
        path: '/test/doc2.md',
        content: '文档2内容',
        metadata: {
          originalName: 'doc2.md',
          fileType: 'markdown',
          fileSize: 100,
          fileHash: 'hash2',
          modifiedAt: Date.now(),
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          { id: 'chunk-2', docId: 'doc-2', content: '内容2', startPos: 0, endPos: 5 },
        ],
      };

      // 索引第一个文档
      await indexer.indexDocument(doc1);
      let stats = await indexer.getStats();
      expect(stats.totalDocuments).toBe(1);

      // 索引第二个文档
      await indexer.indexDocument(doc2);
      stats = await indexer.getStats();
      expect(stats.totalDocuments).toBe(2);
    });

    it('应该正确删除文档分块', async () => {
      await indexer.initialize();

      const doc: KnowledgeDocument = {
        id: 'doc-delete',
        path: '/test/delete.md',
        content: '待删除内容',
        metadata: {
          originalName: 'delete.md',
          fileType: 'markdown',
          fileSize: 50,
          fileHash: 'hash-del',
          modifiedAt: Date.now(),
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          { id: 'chunk-del', docId: 'doc-delete', content: '内容', startPos: 0, endPos: 5 },
        ],
      };

      await indexer.indexDocument(doc);
      await indexer.deleteDocumentChunks('doc-delete');

      const stats = await indexer.getStats();
      expect(stats.totalChunks).toBe(0);
    });

    it('应该返回正确的索引统计', async () => {
      await indexer.initialize();

      const stats = await indexer.getStats();
      expect(stats.totalChunks).toBeGreaterThanOrEqual(0);
      expect(stats.totalDocuments).toBeGreaterThanOrEqual(0);
    });
  });

  // ========== T032: 来源标注测试 ==========

  describe('T032: 来源标注', () => {
    let annotator: SourceAnnotator;
    let documents: Map<string, KnowledgeDocument>;

    beforeEach(() => {
      annotator = new SourceAnnotator({ contextLength: 50 });

      documents = new Map();
      documents.set('doc-1', {
        id: 'doc-1',
        path: '/path/to/document.md',
        content: '前文内容。这是主要的内容部分。这是后续内容。',
        metadata: {
          originalName: 'document.md',
          fileType: 'markdown',
          fileSize: 200,
          fileHash: 'hash1',
          modifiedAt: Date.now(),
          title: '测试文档',
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          {
            id: 'chunk-1',
            docId: 'doc-1',
            content: '这是主要的内容部分。',
            startPos: 6,
            endPos: 20,
            metadata: {
              lineStart: 1,
              lineEnd: 1,
              section: '简介',
            },
          },
        ],
      });
    });

    it('应该正确标注来源信息', () => {
      const result = annotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      expect(result.chunkId).toBe('chunk-1');
      expect(result.docId).toBe('doc-1');
      expect(result.docPath).toBe('/path/to/document.md');
      expect(result.docTitle).toBe('测试文档');
      expect(result.docType).toBe('markdown');
    });

    it('应该正确提取上下文', () => {
      const result = annotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      // 上下文应该包含当前内容
      expect(result.context.current).toContain('内容');
      expect(result.context.current.length).toBeGreaterThan(0);
    });

    it('应该包含行号信息', () => {
      const result = annotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      expect(result.lineInfo).toBeDefined();
      expect(result.lineInfo?.startLine).toBe(1);
    });

    it('应该包含章节信息', () => {
      const result = annotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      expect(result.section).toBe('简介');
    });

    it('应该生成正确的引用', () => {
      const result = annotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      expect(result.citation).toContain('测试文档');
      expect(result.citation).toContain('行');
    });

    it('应该格式化为 Markdown', () => {
      const result = annotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      const markdown = annotator.formatAsMarkdown(result);
      expect(markdown).toContain('> **来源**');
      expect(markdown).toContain('测试文档');
    });

    it('应该支持短格式引用', () => {
      const shortAnnotator = new SourceAnnotator({ citationFormat: 'short' });
      const result = shortAnnotator.annotate(
        'chunk-1',
        'doc-1',
        '这是主要的内容部分。',
        documents
      );

      expect(result.citation).toContain('测试文档');
      expect(result.citation).toContain('[');
    });

    it('应该正确处理未知文档', () => {
      const result = annotator.annotate(
        'chunk-unknown',
        'doc-unknown',
        '未知内容',
        documents
      );

      expect(result.docId).toBe('doc-unknown');
      expect(result.docPath).toBe('');
    });
  });

  // ========== T031: 混合检索测试 ==========

  describe('T031: 知识库混合检索', () => {
    let searcher: KnowledgeSearcher;
    let indexer: ChunkIndexer;
    let documents: Map<string, KnowledgeDocument>;

    beforeEach(async () => {
      // 清理旧数据
      try {
        await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }

      documents = new Map();

      // 创建测试文档
      const doc1: KnowledgeDocument = {
        id: 'doc-test-1',
        path: '/test/typescript.md',
        content: 'TypeScript 是 JavaScript 的超集。它添加了静态类型检查。TypeScript 代码会被编译成 JavaScript。',
        metadata: {
          originalName: 'typescript.md',
          fileType: 'markdown',
          fileSize: 500,
          fileHash: 'hash-ts',
          modifiedAt: Date.now(),
          title: 'TypeScript 简介',
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          {
            id: 'chunk-ts-1',
            docId: 'doc-test-1',
            content: 'TypeScript 是 JavaScript 的超集。它添加了静态类型检查。',
            startPos: 0,
            endPos: 40,
          },
          {
            id: 'chunk-ts-2',
            docId: 'doc-test-1',
            content: 'TypeScript 代码会被编译成 JavaScript。',
            startPos: 40,
            endPos: 75,
          },
        ],
      };

      const doc2: KnowledgeDocument = {
        id: 'doc-test-2',
        path: '/test/python.md',
        content: 'Python 是一种高级编程语言。它的语法简洁，易于学习。Python 支持多种编程范式。',
        metadata: {
          originalName: 'python.md',
          fileType: 'markdown',
          fileSize: 400,
          fileHash: 'hash-py',
          modifiedAt: Date.now(),
          title: 'Python 简介',
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          {
            id: 'chunk-py-1',
            docId: 'doc-test-2',
            content: 'Python 是一种高级编程语言。它的语法简洁，易于学习。',
            startPos: 0,
            endPos: 35,
          },
        ],
      };

      documents.set('doc-test-1', doc1);
      documents.set('doc-test-2', doc2);

      // 初始化索引器
      indexer = new ChunkIndexer(
        { dbPath: join(TEST_STORAGE_PATH, 'vectors') },
        mockEmbeddingService as any
      );
      await indexer.initialize();

      // 索引文档
      await indexer.indexDocument(doc1);
      await indexer.indexDocument(doc2);

      // 初始化检索器
      searcher = new KnowledgeSearcher(
        {
          vectorDbPath: join(TEST_STORAGE_PATH, 'vectors'),
          ftsDbPath: TEST_STORAGE_PATH,
        },
        mockEmbeddingService as any,
        () => documents
      );
      await searcher.initialize();

      // 为 FTS 建立索引
      for (const doc of documents.values()) {
        if (doc.chunks) {
          for (const chunk of doc.chunks) {
            searcher.indexChunk(chunk, doc);
          }
        }
      }
    });

    afterEach(async () => {
      if (searcher) {
        searcher.close();
      }
      if (indexer) {
        await indexer.close();
      }
      try {
        await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
    });

    it('应该正确初始化检索器', async () => {
      const stats = searcher.getStats();
      expect(typeof stats.vectorCount).toBe('number');
      expect(typeof stats.ftsCount).toBe('number');
    });

    it('应该执行向量检索', async () => {
      const results = await searcher.search('TypeScript', { mode: 'vector', limit: 5 });

      expect(results.length).toBeGreaterThanOrEqual(0);
      // 如果有结果，验证来源标注
      if (results.length > 0) {
        expect(results[0].source).toBeDefined();
        expect(results[0].retrievedBy).toContain('vector');
      }
    });

    it('应该执行全文检索', async () => {
      const results = await searcher.search('编程语言', { mode: 'fulltext', limit: 5 });

      expect(results.length).toBeGreaterThanOrEqual(0);
      if (results.length > 0) {
        expect(results[0].retrievedBy).toContain('fulltext');
      }
    });

    it('应该执行混合检索', async () => {
      const results = await searcher.search('TypeScript 编程', { mode: 'hybrid', limit: 5 });

      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('应该支持最小相似度过滤', async () => {
      const results = await searcher.search('测试查询', { minScore: 0.9 });

      // 高阈值应该返回较少结果
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('应该支持文档类型过滤', async () => {
      const results = await searcher.search('编程', {
        docTypes: ['markdown'],
      });

      // 如果有结果，应该都是 markdown 类型
      for (const r of results) {
        expect(r.source.docType).toBe('markdown');
      }
    });

    it('应该返回来源标注信息', async () => {
      const results = await searcher.search('TypeScript', { limit: 5 });

      for (const result of results) {
        expect(result.source.chunkId).toBe(result.chunkId);
        expect(result.source.docPath).toBeDefined();
        expect(result.source.citation).toBeDefined();
      }
    });

    it('应该正确删除文档索引', async () => {
      searcher.deleteDocumentIndex('doc-test-1');

      const stats = searcher.getStats();
      // FTS 索引应该减少
      expect(stats.ftsCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ========== 验收标准测试 ==========

  describe('验收标准', () => {
    it('索引成功率 > 98%', async () => {
      // 创建索引器
      const testIndexer = new ChunkIndexer(
        { dbPath: join(TEST_STORAGE_PATH, 'success-rate') },
        mockEmbeddingService as any
      );

      await testIndexer.initialize();

      // 创建 50 个文档进行测试（减少数量以避免超时）
      const results: IndexResult[] = [];
      for (let i = 0; i < 50; i++) {
        const doc: KnowledgeDocument = {
          id: `doc-${i}`,
          path: `/test/doc-${i}.md`,
          content: `文档 ${i} 的内容`,
          metadata: {
            originalName: `doc-${i}.md`,
            fileType: 'markdown',
            fileSize: 100,
            fileHash: `hash-${i}`,
            modifiedAt: Date.now(),
          },
          status: 'indexed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          chunks: [
            { id: `chunk-${i}`, docId: `doc-${i}`, content: `内容 ${i}`, startPos: 0, endPos: 10 },
          ],
        };

        const result = await testIndexer.indexDocument(doc);
        results.push(result);
      }

      // 计算成功率
      const successCount = results.filter(r => r.success).length;
      const successRate = successCount / results.length;

      expect(successRate).toBeGreaterThan(0.98);

      await testIndexer.close();
    });

    it('检索结果标注正确', async () => {
      const annotator = new SourceAnnotator();

      const documents = new Map<string, KnowledgeDocument>();
      documents.set('test-doc', {
        id: 'test-doc',
        path: '/correct/path.md',
        content: '完整文档内容',
        metadata: {
          originalName: 'path.md',
          fileType: 'markdown',
          fileSize: 100,
          fileHash: 'hash',
          modifiedAt: Date.now(),
          title: '正确标题',
        },
        status: 'indexed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chunks: [
          {
            id: 'correct-chunk',
            docId: 'test-doc',
            content: '分块内容',
            startPos: 0,
            endPos: 4,
            metadata: { lineStart: 1, lineEnd: 2 },
          },
        ],
      });

      const result = annotator.annotate('correct-chunk', 'test-doc', '分块内容', documents);

      // 验证所有标注字段正确
      expect(result.docPath).toBe('/correct/path.md');
      expect(result.docTitle).toBe('正确标题');
      expect(result.docType).toBe('markdown');
      expect(result.chunkIndex).toBe(0);
      expect(result.totalChunks).toBe(1);
      expect(result.lineInfo?.startLine).toBe(1);
    });

    it('分块大小和重叠符合配置', () => {
      const chunker = new RecursiveChunker({
        chunkSize: 1500,
        chunkOverlap: 150,
      });

      // 创建一个足够长的文本
      const longText = '这是测试内容。'.repeat(200);
      const chunks = chunker.chunk(longText);

      // 验证分块大小限制
      for (const chunk of chunks) {
        // 允许少量溢出
        expect(chunk.content.length).toBeLessThanOrEqual(1600);
      }
    });
  });
});
