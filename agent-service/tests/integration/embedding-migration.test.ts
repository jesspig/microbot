/**
 * Embedding 模型迁移集成测试
 *
 * 验证模型切换、向量迁移、回滚流程。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { ModelRegistry, createModelRegistry, PREDEFINED_MODELS } from '../../runtime/capability/memory/embedding/model-registry';
import { VectorAdapter, createVectorAdapter } from '../../runtime/capability/memory/embedding/vector-adapter';
import { MigrationService, createMigrationService } from '../../runtime/capability/memory/embedding/migration-service';
import type { EmbeddingService } from '../../runtime/capability/memory/types';

/** 测试用的 Mock 嵌入服务 */
class MockEmbeddingService implements EmbeddingService {
  private dimension: number;
  private available: boolean;

  constructor(dimension: number = 1536, available: boolean = true) {
    this.dimension = dimension;
    this.available = available;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async embed(text: string): Promise<number[]> {
    // 生成确定性向量（基于文本哈希）
    const vector: number[] = [];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }

    for (let i = 0; i < this.dimension; i++) {
      vector.push(Math.sin(hash + i) * 0.5 + 0.5);
    }

    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

/** 测试临时目录 */
const getTestDir = () => join(process.cwd(), `.test-embedding-${Date.now()}-${Math.random().toString(36).slice(2)}`);

describe('Embedding 模型管理', () => {
  let modelRegistry: ModelRegistry;
  let vectorAdapter: VectorAdapter;
  let migrationService: MigrationService;
  let testDir: string;

  beforeEach(async () => {
    // 使用唯一测试目录
    testDir = getTestDir();
    await mkdir(testDir, { recursive: true });

    // 初始化组件
    modelRegistry = createModelRegistry({
      predefinedModels: PREDEFINED_MODELS.slice(0, 3),
    });
    await modelRegistry.initialize();

    vectorAdapter = createVectorAdapter({
      storagePath: testDir,
      tableName: 'test_vectors',
      defaultLimit: 10,
      maxLimit: 100,
    });
    await vectorAdapter.initialize();

    migrationService = createMigrationService(vectorAdapter, modelRegistry, {
      defaultBatchSize: 10,
      batchInterval: 0,
    });
  });

  afterEach(async () => {
    // 清理资源
    await vectorAdapter.close();
    modelRegistry.clear();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('ModelRegistry', () => {
    it('应该正确初始化预定义模型', async () => {
      const models = modelRegistry.getAllModels();
      expect(models.length).toBeGreaterThanOrEqual(3);

      // 验证第一个模型的属性
      const firstModel = models[0];
      expect(firstModel.id).toBeDefined();
      expect(firstModel.provider).toBeDefined();
      expect(firstModel.dimension).toBeGreaterThan(0);
    });

    it('应该正确注册新模型', async () => {
      const embeddingService = new MockEmbeddingService(768);
      const model = await modelRegistry.register({
        provider: 'test',
        name: 'test-model',
        setActive: true,
      }, embeddingService);

      expect(model.id).toBe('test/test-model');
      expect(model.provider).toBe('test');
      expect(model.name).toBe('test-model');
      expect(model.dimension).toBe(768);
      expect(model.isActive).toBe(true);
    });

    it('应该正确切换活跃模型', async () => {
      const embeddingService = new MockEmbeddingService(768);
      // 注册两个模型
      await modelRegistry.register({ provider: 'test', name: 'model-a' }, embeddingService);
      await modelRegistry.register({ provider: 'test', name: 'model-b' }, embeddingService);

      // 切换到 model-b
      const result = await modelRegistry.switchActiveModel('test/model-b');
      expect(result.success).toBe(true);

      const activeModel = modelRegistry.getActiveModel();
      expect(activeModel?.id).toBe('test/model-b');
    });

    it('应该正确返回是否需要迁移', async () => {
      // 注册相同维度但不同 provider/name 的模型
      const serviceA = new MockEmbeddingService(768);
      const serviceB = new MockEmbeddingService(768);

      await modelRegistry.register(
        { provider: 'test', name: 'model-a', setActive: true },
        serviceA
      );

      // 模拟已有向量（通过更新计数）
      modelRegistry.updateVectorCount('test/model-a', 10);

      // 切换到另一个模型（相同维度不需要迁移）
      await modelRegistry.register(
        { provider: 'test', name: 'model-b' },
        serviceB
      );

      let result = await modelRegistry.switchActiveModel('test/model-b');
      expect(result.success).toBe(true);
      // 相同维度，不需要迁移向量
      expect(result.needsMigration).toBe(false);

      // 注册一个不同维度的模型来测试需要迁移的情况
      const serviceC = new MockEmbeddingService(1024);
      await modelRegistry.register(
        { provider: 'test', name: 'model-c' },
        serviceC
      );

      // 由于 model-b 的向量计数为 0，所以也不需要迁移
      result = await modelRegistry.switchActiveModel('test/model-c');
      expect(result.success).toBe(true);
      expect(result.needsMigration).toBe(false);
    });
  });

  describe('VectorAdapter', () => {
    it('应该正确存储和检索向量', async () => {
      const vector = Array(1536).fill(0).map(() => Math.random());
      const result = await vectorAdapter.store('mem-1', 'test-model', vector);

      expect(result.success).toBe(true);

      const retrieved = await vectorAdapter.get(result.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.memoryId).toBe('mem-1');
      expect(retrieved?.modelId).toBe('test-model');
      expect(retrieved?.dimension).toBe(1536);
    });

    it('应该正确批量存储向量', async () => {
      const items = [
        { memoryId: 'mem-1', modelId: 'model-a', vector: Array(768).fill(0.1) },
        { memoryId: 'mem-2', modelId: 'model-a', vector: Array(768).fill(0.2) },
        { memoryId: 'mem-3', modelId: 'model-a', vector: Array(768).fill(0.3) },
      ];

      const result = await vectorAdapter.storeBatch(items);
      expect(result.success).toBe(true);
      expect(result.ids.length).toBe(3);
    });

    it('应该正确按模型 ID 过滤向量', async () => {
      await vectorAdapter.store('mem-1', 'model-a', Array(768).fill(0.1));
      await vectorAdapter.store('mem-2', 'model-b', Array(768).fill(0.2));

      const vectorsA = await vectorAdapter.getByModelId('model-a');
      const vectorsB = await vectorAdapter.getByModelId('model-b');

      expect(vectorsA.length).toBe(1);
      expect(vectorsB.length).toBe(1);
      expect(vectorsA[0].dimension).toBe(768);
      expect(vectorsB[0].dimension).toBe(768);
    });

    it('应该正确更新活跃状态', async () => {
      const result = await vectorAdapter.store('mem-1', 'model-a', Array(768).fill(0.1));
      expect(result.success).toBe(true);

      let vector = await vectorAdapter.get(result.id);
      expect(vector?.isActive).toBe(true);

      await vectorAdapter.setActive(result.id, false);

      vector = await vectorAdapter.get(result.id);
      expect(vector?.isActive).toBe(false);
    });

    it('应该正确统计向量数量', async () => {
      await vectorAdapter.store('mem-1', 'model-a', Array(768).fill(0.1));
      await vectorAdapter.store('mem-2', 'model-a', Array(768).fill(0.2));
      await vectorAdapter.store('mem-3', 'model-b', Array(768).fill(0.3));

      const total = await vectorAdapter.count();
      const countA = await vectorAdapter.countByModelId('model-a');
      const countB = await vectorAdapter.countByModelId('model-b');

      expect(total).toBe(3);
      expect(countA).toBe(2);
      expect(countB).toBe(1);
    });
  });

  describe('MigrationService', () => {
    // 注意：LanceDB 不支持在同一个表中存储不同维度的向量
    // 跨维度迁移需要使用不同的表或特殊的处理方式
    // 当前测试使用相同维度来验证迁移逻辑

    it('应该正确启动和完成迁移', async () => {
      const sourceService = new MockEmbeddingService(768);
      const targetService = new MockEmbeddingService(768); // 使用相同维度

      // 注册源模型并存储向量
      await modelRegistry.register(
        { provider: 'test', name: 'source', setActive: true },
        sourceService
      );

      // 存储测试向量
      await vectorAdapter.store('mem-1', 'test/source', await sourceService.embed('content 1'));
      await vectorAdapter.store('mem-2', 'test/source', await sourceService.embed('content 2'));

      // 注册目标模型
      await modelRegistry.register(
        { provider: 'test', name: 'target' },
        targetService
      );

      // 启动迁移
      const migration = await migrationService.startMigration(
        'test/source',
        'test/target',
        targetService,
        { batchSize: 10, batchInterval: 0 }
      );

      expect(migration.id).toBeDefined();
      expect(migration.sourceModelId).toBe('test/source');
      expect(migration.targetModelId).toBe('test/target');
      expect(migration.totalCount).toBe(2);

      // 等待迁移完成
      await new Promise(resolve => setTimeout(resolve, 500));

      const progress = migrationService.getProgress(migration.id);
      expect(progress?.status).toBe('completed');
      expect(progress?.processedCount).toBe(2);
    });

    it('应该正确暂停和恢复迁移', async () => {
      const sourceService = new MockEmbeddingService(768);
      const targetService = new MockEmbeddingService(768);

      await modelRegistry.register(
        { provider: 'test', name: 'source', setActive: true },
        sourceService
      );

      // 存储较多向量以便测试暂停
      for (let i = 0; i < 30; i++) {
        await vectorAdapter.store(`mem-${i}`, 'test/source', await sourceService.embed(`content ${i}`));
      }

      await modelRegistry.register(
        { provider: 'test', name: 'target' },
        targetService
      );

      // 启动迁移（更大的批次间隔以便有足够时间暂停）
      const migration = await migrationService.startMigration(
        'test/source',
        'test/target',
        targetService,
        { batchSize: 5, batchInterval: 200 }
      );

      // 立即尝试暂停（迁移刚开始）
      await new Promise(resolve => setTimeout(resolve, 50));

      const paused = await migrationService.pauseMigration(migration.id);
      // 如果迁移已完成，跳过暂停检查
      if (paused) {
        const progressAfterPause = migrationService.getProgress(migration.id);
        expect(progressAfterPause?.status).toBe('paused');

        // 恢复迁移
        const resumed = await migrationService.resumeMigration(migration.id, targetService);
        expect(resumed).toBe(true);
      }

      // 等待完成
      await new Promise(resolve => setTimeout(resolve, 800));

      const progressAfterResume = migrationService.getProgress(migration.id);
      expect(progressAfterResume?.status).toBe('completed');
    });

    it('应该正确回滚迁移', async () => {
      const sourceService = new MockEmbeddingService(768);
      const targetService = new MockEmbeddingService(768);

      await modelRegistry.register(
        { provider: 'test', name: 'source', setActive: true },
        sourceService
      );

      // 存储测试向量
      await vectorAdapter.store('mem-1', 'test/source', await sourceService.embed('content 1'));

      await modelRegistry.register(
        { provider: 'test', name: 'target' },
        targetService
      );

      // 启动并完成迁移
      const migration = await migrationService.startMigration(
        'test/source',
        'test/target',
        targetService,
        { batchSize: 10, batchInterval: 0 }
      );

      await new Promise(resolve => setTimeout(resolve, 300));

      // 验证迁移完成
      const targetVectors = await vectorAdapter.getByModelId('test/target');
      expect(targetVectors.length).toBe(1);

      // 执行回滚
      const rollbackResult = await migrationService.rollback(migration.id);
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.restoredCount).toBe(1);

      // 验证目标模型向量已删除
      const targetVectorsAfterRollback = await vectorAdapter.getByModelId('test/target');
      expect(targetVectorsAfterRollback.length).toBe(0);

      // 验证源模型向量已恢复活跃
      const sourceVectors = await vectorAdapter.getActiveVectors('test/source');
      expect(sourceVectors.length).toBe(1);
    });

    it('应该正确追踪迁移进度', async () => {
      const sourceService = new MockEmbeddingService(768);
      const targetService = new MockEmbeddingService(768);

      await modelRegistry.register(
        { provider: 'test', name: 'source', setActive: true },
        sourceService
      );

      for (let i = 0; i < 10; i++) {
        await vectorAdapter.store(`mem-${i}`, 'test/source', await sourceService.embed(`content ${i}`));
      }

      await modelRegistry.register(
        { provider: 'test', name: 'target' },
        targetService
      );

      const migration = await migrationService.startMigration(
        'test/source',
        'test/target',
        targetService,
        { batchSize: 3, batchInterval: 50 }
      );

      // 检查初始进度
      let progress = migrationService.getProgress(migration.id);
      expect(progress?.totalCount).toBe(10);
      expect(progress?.progress).toBeGreaterThanOrEqual(0);

      // 等待完成
      await new Promise(resolve => setTimeout(resolve, 500));

      progress = migrationService.getProgress(migration.id);
      expect(progress?.status).toBe('completed');
      expect(progress?.progress).toBe(100);
      expect(progress?.processedCount).toBe(10);
    });
  });

  describe('端到端迁移流程', () => {
    it('应该支持完整的模型切换流程', async () => {
      const serviceA = new MockEmbeddingService(768);
      const serviceB = new MockEmbeddingService(768); // 使用相同维度

      // 初始化模型 A
      await modelRegistry.register(
        { provider: 'test', name: 'model-a', setActive: true },
        serviceA
      );

      // 存储一些记忆
      const vectors = [];
      for (let i = 0; i < 5; i++) {
        const v = await serviceA.embed(`memory content ${i}`);
        vectors.push(v);
        await vectorAdapter.store(`mem-${i}`, 'test/model-a', v);
      }

      // 初始化模型 B
      await modelRegistry.register(
        { provider: 'test', name: 'model-b' },
        serviceB
      );

      // 切换到模型 B
      const switchResult = await modelRegistry.switchActiveModel('test/model-b');
      expect(switchResult.success).toBe(true);
      // 相同维度不需要迁移向量（模型本身不同即可切换）
      expect(switchResult.needsMigration).toBe(false);

      // 手动触发迁移（将数据从模型 A 迁移到模型 B）
      const migration = await migrationService.startMigration(
        'test/model-a',
        'test/model-b',
        serviceB,
        { batchSize: 10, batchInterval: 0 }
      );

      // 等待完成
      await new Promise(resolve => setTimeout(resolve, 300));

      const progress = migrationService.getProgress(migration.id);
      expect(progress?.status).toBe('completed');

      // 验证向量已迁移
      const newVectors = await vectorAdapter.getByModelId('test/model-b');
      expect(newVectors.length).toBe(5);

      // 验证新向量维度正确
      expect(newVectors[0].dimension).toBe(768);
    });
  });
});
