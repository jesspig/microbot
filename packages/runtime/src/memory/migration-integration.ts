/**
 * 迁移功能集成模块
 * 
 * 负责嵌入模型迁移的集成和管理
 */

import type { MigrationStatus, MigrationResult, RetryResult } from './types';
import type { MemoryStoreCore } from './core';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'migration-integration']);

/**
 * 迁移集成管理器
 */
export class MigrationIntegrationManager {
  private core: MemoryStoreCore;
  private migrationInstance: InstanceType<typeof import('./migration').EmbeddingMigration> | null = null;

  constructor(core: MemoryStoreCore) {
    this.core = core;
  }

  /**
   * 获取迁移状态
   */
  async getMigrationStatus(): Promise<MigrationStatus> {
    if (!this.migrationInstance) {
      return {
        status: 'idle',
        progress: 0,
        migratedCount: 0,
        totalRecords: 0,
        failedCount: 0,
      };
    }
    return this.migrationInstance.getStatus();
  }

  /**
   * 启动迁移到指定模型
   */
  async migrateToModel(
    targetModel: string,
    options?: { autoStart?: boolean }
  ): Promise<MigrationResult> {
    const { EmbeddingMigration } = await import('./migration');
    
    const embeddingService = this.core.storeConfig.embeddingService;
    if (!embeddingService) {
      return {
        success: false,
        error: '嵌入服务不可用',
      };
    }
    
    const currentStatus = await this.getMigrationStatus();
    if (currentStatus.status === 'running') {
      return {
        success: false,
        error: '已有迁移任务在进行中',
        status: currentStatus,
      };
    }

    const storagePath = this.core['expandPath'](this.core.storeConfig.storagePath);
    this.migrationInstance = new EmbeddingMigration(
      this.core as any,
      embeddingService,
      storagePath
    );

    this.setupMigrationEventListeners();

    if (options?.autoStart !== false) {
      await this.migrationInstance.start(targetModel);
    }

    return {
      success: true,
      status: await this.migrationInstance.getStatus(),
    };
  }

  /**
   * 重试失败的迁移记录
   */
  async retryMigration(recordIds?: string[]): Promise<RetryResult> {
    if (!this.migrationInstance) {
      return {
        retried: 0,
        succeeded: 0,
        failed: 0,
        remainingFailed: [],
      };
    }

    return this.migrationInstance.retryFailed(recordIds);
  }

  /**
   * 暂停当前迁移
   */
  async pauseMigration(): Promise<void> {
    if (this.migrationInstance) {
      await this.migrationInstance.pause();
    }
  }

  /**
   * 继续暂停的迁移
   */
  async resumeMigration(): Promise<void> {
    if (this.migrationInstance) {
      await this.migrationInstance.resume();
    }
  }

  /**
   * 设置迁移事件监听器
   */
  private setupMigrationEventListeners(): void {
    if (!this.migrationInstance) return;

    const events = ['start', 'progress', 'complete', 'error', 'paused', 'resumed', 'record_failed'] as const;
    
    for (const eventType of events) {
      this.migrationInstance.on(`migration:${eventType}`, (data: unknown) => {
        log.info(`🔄 [MemoryStore] 迁移事件: migration:${eventType}`, data as Record<string, unknown>);
      });
    }
  }
}