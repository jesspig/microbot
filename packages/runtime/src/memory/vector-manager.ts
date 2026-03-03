/**
 * 向量列管理模块
 * 
 * 负责向量列的创建、迁移、标准化和管理
 */

import type { VectorColumnName, EmbedModelInfo } from './types';
import type { MemoryStoreCore, LanceDBRecord } from './core';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'vector-manager']);

/**
 * 向量列管理器
 */
export class VectorManager {
  private core: MemoryStoreCore;

  constructor(core: MemoryStoreCore) {
    this.core = core;
  }

  /**
   * 迁移旧数据结构
   */
  async migrateLegacySchema(): Promise<void> {
    const table = this.core.dbTable;
    if (!table) return;

    try {
      const schema = await table.schema();
      const hasLegacyVector = schema.fields.some(f => f.name === 'vector');
      const hasActiveEmbed = schema.fields.some(f => f.name === 'active_embed');

      if (hasActiveEmbed) {
        log.debug('📐 [MemoryStore] 数据结构已是新版，无需迁移');
        return;
      }

      if (!hasLegacyVector) {
        log.debug('📐 [MemoryStore] 无旧版向量列，无需迁移');
        return;
      }

      const count = await table.countRows();
      if (count === 0) {
        log.debug('📐 [MemoryStore] 表为空，无需迁移');
        return;
      }

      log.info('🔄 [MemoryStore] 开始迁移旧数据结构', { recordCount: count });

      const embedModel = this.core.storeConfig.embedModel;
      if (!embedModel) {
        log.warn('📐 [MemoryStore] 未配置嵌入模型，跳过向量列迁移');
        return;
      }

      const newVectorColumn = this.getModelVectorColumn(embedModel);

      const records = await table.query().toArray();
      const toMigrate: LanceDBRecord[] = [];
      const idsToDelete: string[] = [];

      for (const record of records) {
        const oldVector = record.vector as number[] | undefined;
        if (!oldVector || oldVector.length === 0) continue;

        toMigrate.push({
          ...record,
          [newVectorColumn]: oldVector,
          active_embed: embedModel,
          embed_versions: JSON.stringify({ [embedModel]: Date.now() }),
        });
        idsToDelete.push(String(record.id));
      }

      if (toMigrate.length === 0) {
        log.debug('📐 [MemoryStore] 无需迁移的记录');
        return;
      }

      const deleteIds = idsToDelete.map(id => `"${this.core['escapeValue'](id)}"`).join(', ');
      await table.delete(`id IN (${deleteIds})`);
      await table.add(toMigrate);

      log.info('✅ [MemoryStore] 旧数据结构迁移完成', { 
        migratedCount: toMigrate.length,
        newVectorColumn,
        embedModel,
      });

    } catch (error) {
      log.error('🚨 [MemoryStore] 迁移旧数据结构失败', { error: String(error) });
    }
  }

  /**
   * 确保 documentId 列存在
   */
  async ensureDocumentIdColumn(): Promise<void> {
    const table = this.core.dbTable;
    if (!table) return;

    const schema = await table.schema();
    const columnExists = schema.fields.some(f => f.name === 'documentId');

    if (columnExists) {
      log.debug('📐 [MemoryStore] documentId 列已存在');
      return;
    }

    log.info('📐 [MemoryStore] documentId 列不存在，需要重建表');

    const db = this.core.dbConnection;
    if (!db) {
      throw new Error('Database not initialized');
    }

    const existingRecords = await table.query().toArray();
    const existingCount = existingRecords.length;

    log.info('📐 [MemoryStore] 备份现有数据', { recordCount: existingCount });

    const existingVectorColumns: { name: string; dimension: number }[] = [];
    for (const field of schema.fields) {
      if (field.name.startsWith('vector_')) {
        const dim = await this.getVectorDimensionWithoutInit(field.name as VectorColumnName);
        if (dim > 0) {
          existingVectorColumns.push({ name: field.name, dimension: dim });
        }
      }
    }

    if (existingCount > 0 && existingRecords.length > 0) {
      const firstRecord = existingRecords[0];
      for (const [key, value] of Object.entries(firstRecord)) {
        if (key.startsWith('vector_') && !existingVectorColumns.some(c => c.name === key)) {
          let dim = 0;
          if (Array.isArray(value)) {
            dim = (value as number[]).length;
          } else if (value && typeof value === 'object' && 'toArray' in value) {
            const arr = (value as { toArray: () => number[] }).toArray();
            dim = arr.length;
          } else if (value && typeof value === 'object' && 'length' in value) {
            dim = (value as { length: number }).length;
          }
          if (dim > 0) {
            existingVectorColumns.push({ name: key, dimension: dim });
          }
        }
      }
    }

    const tableName = 'memories';
    await db.dropTable(tableName);

    const placeholderRecord: LanceDBRecord = {
      id: `__schema_placeholder__`,
      sessionId: '__schema__',
      type: '__schema__',
      content: '__schema__',
      ...Object.fromEntries(
        existingVectorColumns.map(col => [col.name, new Array(col.dimension).fill(0)])
      ),
      metadata: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active_embed: '',
      embed_versions: '{}',
      documentId: '',
    };

    const newTable = await db.createTable(tableName, [placeholderRecord]);
    this.core['table'] = newTable;
    
    await newTable.delete(`id = "__schema_placeholder__"`);

    if (existingCount > 0) {
      const normalizedRecords = existingRecords.map(record => ({
        ...record,
        documentId: '',
        active_embed: record.active_embed ?? '',
        embed_versions: record.embed_versions ?? '{}',
      }));
      const finalRecords = this.normalizeVectorColumns(normalizedRecords, existingVectorColumns);
      await newTable.add(finalRecords);
    }

    log.info('✅ [MemoryStore] 表已重建，documentId 列已添加', { 
      restoredRecords: existingCount,
      preservedVectorColumns: existingVectorColumns.length,
    });
  }

  /**
   * 确保当前嵌入模型的向量列存在
   */
  async ensureVectorColumn(): Promise<void> {
    const table = this.core.dbTable;
    if (!table) return;

    const embedModel = this.core.storeConfig.embedModel;
    if (!embedModel) return;

    const targetColumn = this.getModelVectorColumn(embedModel);

    const schema = await table.schema();
    const columnExists = schema.fields.some(f => f.name === targetColumn);

    if (columnExists) {
      log.debug('📐 [MemoryStore] 向量列已存在', { column: targetColumn });
      return;
    }

    log.info('📐 [MemoryStore] 向量列不存在，需要重建表', { 
      newColumn: targetColumn,
      embedModel,
    });

    const db = this.core.dbConnection;
    if (!db) {
      throw new Error('Database not initialized');
    }

    const vectorDimension = await this.core['detectVectorDimension']();
    const dimension = vectorDimension || 1024;

    const existingRecords = await table.query().toArray();
    const existingCount = existingRecords.length;

    log.info('📐 [MemoryStore] 备份现有数据', { recordCount: existingCount });

    const existingVectorColumns: { name: string; dimension: number }[] = [];
    for (const field of schema.fields) {
      if (field.name.startsWith('vector_') && field.name !== targetColumn) {
        const dim = await this.getVectorDimensionWithoutInit(field.name as VectorColumnName);
        if (dim > 0) {
          existingVectorColumns.push({ name: field.name, dimension: dim });
        }
      }
    }

    if (existingCount > 0 && existingRecords.length > 0) {
      const firstRecord = existingRecords[0];
      for (const [key, value] of Object.entries(firstRecord)) {
        if (key === targetColumn || existingVectorColumns.some(c => c.name === key)) continue;
        if (key.startsWith('vector_') && value && typeof value === 'object') {
          let dim = 0;
          if (Array.isArray(value)) {
            dim = (value as number[]).length;
          } else if ('length' in value && typeof (value as { length: number }).length === 'number') {
            dim = (value as { length: number }).length;
          } else if ('toArray' in value && typeof (value as { toArray: () => unknown }).toArray === 'function') {
            const arr = (value as { toArray: () => number[] }).toArray();
            dim = arr.length;
          }
          
          if (dim > 0) {
            existingVectorColumns.push({ name: key, dimension: dim });
          }
        }
      }
    }

    log.info('📐 [MemoryStore] 保留现有向量列', { 
      columns: existingVectorColumns.map(c => `${c.name}(${c.dimension})`),
    });

    const tableName = 'memories';
    await db.dropTable(tableName);

    const placeholderRecord: LanceDBRecord = {
      id: `__schema_placeholder__`,
      sessionId: '__schema__',
      type: '__schema__',
      content: '__schema__',
      [targetColumn]: new Array(dimension).fill(0),
      ...Object.fromEntries(
        existingVectorColumns.map(col => [col.name, new Array(col.dimension).fill(0)])
      ),
      metadata: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active_embed: embedModel,
      embed_versions: JSON.stringify({ [embedModel]: Date.now() }),
      documentId: '',
    };

    const newTable = await db.createTable(tableName, [placeholderRecord]);
    this.core['table'] = newTable;
    
    await newTable.delete(`id = "__schema_placeholder__"`);

    if (existingCount > 0) {
      const normalizedRecords = this.normalizeVectorColumns(existingRecords, existingVectorColumns).map(record => ({
        ...record,
        documentId: record.documentId ?? '',
        active_embed: record.active_embed ?? '',
        embed_versions: record.embed_versions ?? '{}',
      }));
      await newTable.add(normalizedRecords);
    }

    log.info('✅ [MemoryStore] 表已重建，新向量列已添加', { 
      column: targetColumn, 
      dimension,
      restoredRecords: existingCount,
      preservedColumns: existingVectorColumns.length,
    });
  }

  /**
   * 获取向量列的维度（不触发初始化）
   */
  async getVectorDimensionWithoutInit(column: VectorColumnName): Promise<number> {
    const table = this.core.dbTable;
    if (!table) return 0;

    try {
      const schema = await table.schema();
      const field = schema.fields.find(f => f.name === column);
      if (!field) return 0;

      const results = await table
        .query()
        .where(`${column} IS NOT NULL`)
        .limit(10)
        .toArray();

      for (const result of results) {
        const value = result[column];
        if (!value) continue;
        
        let dim = 0;
        if (Array.isArray(value)) {
          dim = value.length;
        } else if (typeof value === 'object') {
          if ('length' in value && typeof (value as { length: number }).length === 'number') {
            dim = (value as { length: number }).length;
          } else if ('toArray' in value && typeof (value as { toArray: () => unknown }).toArray === 'function') {
            const arr = (value as { toArray: () => number[] }).toArray();
            dim = arr.length;
          }
        }
        
        if (dim > 0) return dim;
      }

      return 0;
    } catch (error) {
      log.warn('📐 [MemoryStore] 获取向量维度失败', { column, error: String(error) });
      return 0;
    }
  }

  /**
   * 标准化向量列：将 FixedSizeList 转换为普通数组
   */
  normalizeVectorColumns(
    records: LanceDBRecord[],
    vectorColumns?: { name: string; dimension?: number }[]
  ): LanceDBRecord[] {
    return records.map(record => {
      const normalized: Record<string, unknown> = {};
      
      const specifiedColumns = vectorColumns?.map(c => c.name);
      const columnsToProcess = (specifiedColumns && specifiedColumns.length > 0)
        ? specifiedColumns
        : Object.keys(record).filter(key => key.startsWith('vector_'));
      
      for (const [key, value] of Object.entries(record)) {
        if (columnsToProcess.includes(key) && value && typeof value === 'object') {
          if (Array.isArray(value)) {
            normalized[key] = [...value];
          } else if ('toArray' in value && typeof (value as { toArray: () => unknown }).toArray === 'function') {
            normalized[key] = [...(value as { toArray: () => number[] }).toArray()];
          } else if (Symbol.iterator in Object(value)) {
            normalized[key] = [...Array.from(value as Iterable<unknown>)];
          } else if ('length' in value && typeof (value as { length: unknown }).length === 'number') {
            const len = (value as { length: number }).length;
            const arr = new Array(len);
            for (let i = 0; i < len; i++) {
              arr[i] = (value as Record<number, unknown>)[i];
            }
            normalized[key] = arr;
          } else {
            normalized[key] = value;
          }
        } else {
          normalized[key] = value;
        }
      }
      
      return normalized;
    });
  }

  /**
   * 获取所有已存在的向量列名
   */
  async getExistingVectorColumns(): Promise<VectorColumnName[]> {
    const table = this.core.dbTable;
    if (!table) return [];

    try {
      const schema = await table.schema();
      const vectorColumns: VectorColumnName[] = [];

      for (const field of schema.fields) {
        if (field.name.startsWith('vector_')) {
          vectorColumns.push(field.name as VectorColumnName);
        }
      }

      return vectorColumns;
    } catch (error) {
      log.error('🚨 [MemoryStore] 获取向量列失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 检查是否存在指定模型的向量列
   */
  async hasVectorColumn(modelId: string): Promise<boolean> {
    const columns = await this.getExistingVectorColumns();
    const targetColumn = this.getModelVectorColumn(modelId);
    return columns.includes(targetColumn);
  }

  /**
   * 获取向量列的维度
   */
  async getVectorDimension(column: VectorColumnName): Promise<number> {
    return this.getVectorDimensionWithoutInit(column);
  }

  /**
   * 列出所有已存储向量的嵌入模型
   */
  async listEmbedModels(): Promise<EmbedModelInfo[]> {
    const table = this.core.dbTable;
    if (!table) return [];

    const columns = await this.getExistingVectorColumns();
    const models: EmbedModelInfo[] = [];

    for (const column of columns) {
      const modelId = this.getVectorColumnModelId(column);
      const dimension = await this.getVectorDimension(column);
      
      const count = await table
        .query()
        .where(`${column} IS NOT NULL`)
        .toArray()
        .then(r => r.length);

      models.push({
        modelId,
        vectorColumn: column,
        dimension,
        recordCount: count,
      });
    }

    return models;
  }

  /**
   * 更新记录的向量
   */
  async updateVector(
    id: string,
    vectorColumn: string,
    vector: number[],
    modelId: string
  ): Promise<void> {
    const table = this.core.dbTable;
    if (!table) return;

    const escapedId = this.core['escapeValue'](id);
    const results = await table
      .query()
      .where(`id = "${escapedId}"`)
      .limit(1)
      .toArray();

    if (results.length === 0) {
      throw new Error(`Record not found: ${id}`);
    }

    const original = results[0];

    const schema = await table.schema();
    const vectorColumns: { name: string }[] = schema.fields
      .filter(f => f.name.startsWith('vector_'))
      .map(f => ({ name: f.name }));

    const normalizedOriginal = this.normalizeVectorColumns([original], vectorColumns)[0];

    const updated = {
      ...normalizedOriginal,
      [vectorColumn]: vector,
      active_embed: modelId,
      updatedAt: Date.now(),
    };

    const backupRecord = { ...normalizedOriginal };

    try {
      await table.delete(`id = "${escapedId}"`);
      await table.add([updated]);

      log.debug('向量已更新', { id, vectorColumn, modelId });
    } catch (error) {
      log.error('🚨 [MemoryStore] 向量更新失败，尝试恢复原始记录', { 
        id, 
        error: String(error) 
      });
      
      try {
        const checkResults = await table
          .query()
          .where(`id = "${escapedId}"`)
          .limit(1)
          .toArray();
        
        if (checkResults.length === 0) {
          await table.add([backupRecord]);
          log.info('✅ [MemoryStore] 原始记录已恢复', { id });
        }
      } catch (recoveryError) {
        log.error('🚨 [MemoryStore] 恢复原始记录失败', { 
          id, 
          error: String(recoveryError) 
        });
      }
      
      throw error;
    }
  }

  /**
   * 将模型 ID 转换为向量列名
   */
  static modelIdToVectorColumn(modelId: string): VectorColumnName {
    const [provider, ...modelParts] = modelId.split('/');
    const model = modelParts.join('/');
    if (!provider || !model) {
      throw new Error(`Invalid model ID format: ${modelId}`);
    }
    const safeModel = model
      .replace(/\//g, '_s_')
      .replace(/:/g, '_c_')
      .replace(/\./g, '_d_')
      .replace(/-/g, '_h_');
    return `vector_${provider}_${safeModel}` as VectorColumnName;
  }

  /**
   * 将向量列名转换为模型 ID
   */
  static vectorColumnToModelId(column: string): string {
    if (!column.startsWith('vector_')) {
      throw new Error(`Invalid vector column name: ${column}`);
    }
    const parts = column.slice(7).split('_');
    if (parts.length < 2) {
      throw new Error(`Invalid vector column name: ${column}`);
    }
    const provider = parts[0];
    const modelParts: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      switch (part) {
        case 's': modelParts.push('/'); break;
        case 'c': modelParts.push(':'); break;
        case 'd': modelParts.push('.'); break;
        case 'h': modelParts.push('-'); break;
        default: modelParts.push(part);
      }
    }
    const model = modelParts.join('');
    return `${provider}/${model}`;
  }

  // 私有辅助方法
  private getModelVectorColumn(modelId: string): VectorColumnName {
    return VectorManager.modelIdToVectorColumn(modelId);
  }

  private getVectorColumnModelId(column: VectorColumnName): string {
    return VectorManager.vectorColumnToModelId(column);
  }
}