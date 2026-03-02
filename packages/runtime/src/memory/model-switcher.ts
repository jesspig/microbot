/**
 * 模型切换和清理模块
 * 
 * 负责嵌入模型的切换、检测和向量清理
 */

import type { MemoryStoreCore } from './core';
import type { VectorManager } from './vector-manager';
import type { MigrationIntegrationManager } from './migration-integration';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'model-switcher']);

/**
 * 模型切换管理器
 */
export class ModelSwitcher {
  private core: MemoryStoreCore;
  private vectorManager: VectorManager;
  private migrationManager: MigrationIntegrationManager;

  constructor(
    core: MemoryStoreCore,
    vectorManager: VectorManager,
    migrationManager: MigrationIntegrationManager
  ) {
    this.core = core;
    this.vectorManager = vectorManager;
    this.migrationManager = migrationManager;
  }

  /**
   * 切换嵌入模型
   */
  async switchModel(newModel: string, autoMigrate?: boolean): Promise<{
    success: boolean;
    hasExistingVectors: boolean;
    migrationStarted?: boolean;
    message: string;
  }> {
    const oldModel = this.core.storeConfig.embedModel;
    if (oldModel === newModel) {
      return {
        success: true,
        hasExistingVectors: true,
        message: '模型未变更',
      };
    }

    const hasVectors = await this.vectorManager.hasVectorColumn(newModel);

    this.core.storeConfig.embedModel = newModel;

    log.info('🔄 [MemoryStore] 切换嵌入模型', { oldModel, newModel, hasVectors });

    if (!hasVectors && (autoMigrate ?? this.core.storeConfig.multiEmbed?.autoMigrate)) {
      return {
        success: true,
        hasExistingVectors: false,
        migrationStarted: true,
        message: `已切换到 ${newModel}，向量迁移需要单独启动`,
      };
    }

    return {
      success: true,
      hasExistingVectors: hasVectors,
      message: hasVectors 
        ? `已切换到 ${newModel}，可使用已有向量`
        : `已切换到 ${newModel}，需要迁移向量或使用全文检索`,
    };
  }

  /**
   * 检测模型变更
   */
  async detectModelChange(): Promise<{
    needMigration: boolean;
    oldModel?: string;
    newModel: string;
    hasOldModelVectors: boolean;
  }> {
    const newModel = this.core.storeConfig.embedModel;
    if (!newModel) {
      return {
        needMigration: false,
        newModel: '',
        hasOldModelVectors: false,
      };
    }

    const table = this.core.dbTable;
    if (!table) {
      return {
        needMigration: false,
        newModel,
        hasOldModelVectors: false,
      };
    }

    const results = await table.query().limit(1).toArray();
    const recordedModel = results?.[0]?.active_embed as string | undefined;

    if (!recordedModel) {
      const columns = await this.vectorManager.getExistingVectorColumns();
      const hasLegacyVector = columns.includes('vector' as any) || columns.length > 0;
      
      return {
        needMigration: hasLegacyVector && !await this.vectorManager.hasVectorColumn(newModel),
        oldModel: undefined,
        newModel,
        hasOldModelVectors: hasLegacyVector,
      };
    }

    const needMigration = recordedModel !== newModel;
    const hasOldModelVectors = recordedModel ? await this.vectorManager.hasVectorColumn(recordedModel) : false;

    return {
      needMigration,
      oldModel: recordedModel,
      newModel,
      hasOldModelVectors,
    };
  }

  /**
   * 清理旧的向量列
   */
  async cleanupOldVectors(keepModels?: number): Promise<{
    cleanedModels: string[];
    keptModels: string[];
    error?: string;
  }> {
    const table = this.core.dbTable;
    if (!table) {
      return { cleanedModels: [], keptModels: [], error: '表未初始化' };
    }

    const maxModels = keepModels ?? this.core.storeConfig.multiEmbed?.maxModels ?? 3;
    const activeModel = this.core.storeConfig.embedModel;
    const migrationStatus = await this.migrationManager.getMigrationStatus();
    
    const allVectorColumns = await this.vectorManager.getExistingVectorColumns();
    const allModels = allVectorColumns.map(col => 
      this.vectorManager['getVectorColumnModelId'](col)
    );

    const modelsToKeep: string[] = [];
    
    if (activeModel && allModels.includes(activeModel)) {
      modelsToKeep.push(activeModel);
    }
    
    if (migrationStatus.status === 'running' && migrationStatus.targetModel) {
      if (!modelsToKeep.includes(migrationStatus.targetModel)) {
        modelsToKeep.push(migrationStatus.targetModel);
      }
    }
    
    for (const model of allModels) {
      if (modelsToKeep.length >= maxModels) break;
      if (!modelsToKeep.includes(model)) {
        modelsToKeep.push(model);
      }
    }

    const modelsToClean = allModels.filter(m => !modelsToKeep.includes(m));

    if (modelsToClean.length === 0) {
      log.info('🧹 [MemoryStore] 无需清理向量列');
      return { cleanedModels: [], keptModels: modelsToKeep };
    }

    log.info('🧹 [MemoryStore] 标记待清理的向量列', { 
      modelsToClean,
      modelsToKeep,
    });

    for (const model of modelsToClean) {
      const column = this.vectorManager['getModelVectorColumn'](model);
      log.info('🧹 [MemoryStore] 清理向量列', { model, column });
    }

    return {
      cleanedModels: modelsToClean,
      keptModels: modelsToKeep,
    };
  }

  /**
   * 检查并执行自动清理
   */
  async checkAndCleanup(): Promise<void> {
    const multiEmbed = this.core.storeConfig.multiEmbed;
    if (!multiEmbed?.enabled) return;

    const allVectorColumns = await this.vectorManager.getExistingVectorColumns();
    const maxModels = multiEmbed.maxModels ?? 3;

    if (allVectorColumns.length > maxModels) {
      log.info('🧹 [MemoryStore] 检测到超出最大模型数，触发自动清理', {
        current: allVectorColumns.length,
        max: maxModels,
      });
      
      await this.cleanupOldVectors(maxModels);
    }
  }
}