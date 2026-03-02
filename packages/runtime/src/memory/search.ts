/**
 * 检索功能模块
 * 
 * 负责向量检索、全文检索、混合检索、双层检索等
 */

import type { MemoryEntry, MemoryFilter, SearchOptions } from '../types';
import type { MemoryStoreConfig } from './types';
import type { MemoryStoreCore } from './core';
import type { MigrationStatus } from './types';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'search']);

/** 检索模式类型 */
export type SearchMode = 'vector' | 'fulltext' | 'hybrid' | 'migration-hybrid' | 'unknown';

/**
 * 检索管理器
 */
export class SearchManager {
  private core: MemoryStoreCore;
  private lastSearchMode: SearchMode = 'unknown';

  constructor(core: MemoryStoreCore) {
    this.core = core;
  }

  /**
   * 获取最后一次记忆检索使用的模式
   */
  getLastSearchMode(): SearchMode {
    return this.lastSearchMode;
  }

  /**
   * 搜索记忆（主入口）
   */
  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const config = this.core.storeConfig;
    const limit = Math.min(
      options?.limit ?? config.defaultSearchLimit!,
      config.maxSearchLimit!
    );

    const mode = options?.mode ?? 'auto';
    const hasEmbedding = config.embeddingService?.isAvailable();

    // 确定使用的模型
    const targetModel = options?.model ?? config.embedModel;
    const vectorColumn = targetModel 
      ? this.core['getModelVectorColumn'](targetModel)
      : 'vector';

    // 检查该模型的向量列是否存在
    const hasVectorColumn = targetModel ? await this.hasVectorColumn(targetModel) : true;

    // 根据模式选择检索策略
    switch (mode) {
      case 'fulltext':
        log.info('🔍 [MemoryStore] 开始检索全文记忆', { 
          query: query.slice(0, 50),
          limit,
          mode: 'fulltext'
        });
        this.lastSearchMode = 'fulltext';
        return this.fulltextSearch(query, limit, options?.filter);
      
      case 'vector':
        if (!hasEmbedding || !hasVectorColumn) {
          log.warn('🔍 [MemoryStore] 向量模式但条件不满足，回退到全文检索', {
            hasEmbedding,
            hasVectorColumn,
          });
          this.lastSearchMode = 'fulltext';
          return this.fulltextSearch(query, limit, options?.filter);
        }
        log.info('🔍 [MemoryStore] 开始检索向量记忆', { 
          query: query.slice(0, 50),
          limit,
          mode: 'vector',
          vectorColumn,
          targetModel
        });
        this.lastSearchMode = 'vector';
        return this.vectorSearch(query, limit, options?.filter, targetModel);
      
      case 'hybrid':
        log.info('🔍 [MemoryStore] 开始检索混合记忆', { 
          query: query.slice(0, 50),
          limit,
          mode: 'hybrid',
          vectorColumn,
          targetModel
        });
        this.lastSearchMode = 'hybrid';
        return this.hybridSearch(query, limit, options?.filter, targetModel);
      
      case 'auto':
      default:
        // 自动模式：检查是否在迁移中
        const migrationStatus = await this.getMigrationStatus();
        
        if (migrationStatus.status === 'running' && migrationStatus.targetModel === targetModel) {
          // 迁移中：混合检索
          log.info('🔍 [MemoryStore] 开始检索混合记忆', { 
            query: query.slice(0, 50),
            limit,
            mode: 'migration-hybrid',
            migratedUntil: migrationStatus.migratedUntil,
            progress: migrationStatus.progress,
          });
          this.lastSearchMode = 'migration-hybrid';
          return this.migrationAwareSearch(query, limit, options?.filter, targetModel, migrationStatus);
        }
        
        // 非迁移中：优先向量，失败回退全文
        if (hasEmbedding && hasVectorColumn) {
          log.info('🔍 [MemoryStore] 开始检索向量记忆', { 
            query: query.slice(0, 50),
            limit,
            mode: 'vector',
            vectorColumn,
            targetModel
          });
          const results = await this.vectorSearch(query, limit, options?.filter, targetModel);
          if (results.length > 0) {
            this.lastSearchMode = 'vector';
            return results;
          }
          // 向量检索无结果，尝试全文检索
          log.info('🔍 [MemoryStore] 向量检索无结果，开始检索全文记忆');
          this.lastSearchMode = 'fulltext';
          return this.fulltextSearch(query, limit, options?.filter);
        }
        log.info('🔍 [MemoryStore] 开始检索全文记忆', { 
          query: query.slice(0, 50),
          limit,
          mode: 'fulltext'
        });
        this.lastSearchMode = 'fulltext';
        return this.fulltextSearch(query, limit, options?.filter);
    }
  }

  /**
   * 双层检索（向量 + 关键词）
   */
  async dualLayerSearch(
    query: string,
    limit: number = 10,
    candidates: number = 200,
    filter?: MemoryFilter,
    modelId?: string
  ): Promise<MemoryEntry[]> {
    const startTime = Date.now();
    const targetModel = modelId ?? this.core.storeConfig.embedModel;
    const hasEmbedding = this.core.storeConfig.embeddingService?.isAvailable();
    const hasVectorColumn = targetModel ? await this.hasVectorColumn(targetModel) : false;

    // 第一层：向量检索
    let vectorCandidates: MemoryEntry[] = [];
    let vectorScores: Map<string, number> = new Map();

    if (hasEmbedding && hasVectorColumn) {
      try {
        vectorCandidates = await this.vectorSearch(query, candidates, filter, targetModel);
        
        // 计算向量相似度分数（归一化）
        for (let i = 0; i < vectorCandidates.length; i++) {
          const entry = vectorCandidates[i];
          const score = 1 - (i / vectorCandidates.length);
          vectorScores.set(entry.id, score);
        }
      } catch (error) {
        log.warn('🔍 [MemoryStore] 双层检索向量层失败', { error: String(error) });
      }
    }

    // 如果向量检索无结果，回退到全文检索
    if (vectorCandidates.length === 0) {
      log.info('🔍 [MemoryStore] 双层检索回退到全文检索', { query: query.slice(0, 50) });
      this.lastSearchMode = 'fulltext';
      return this.fulltextSearch(query, limit, filter);
    }

    // 第二层：候选内关键词匹配
    const keywords = this.extractKeywords(query);
    const scoredCandidates: Array<{ entry: MemoryEntry; vectorScore: number; keywordScore: number; finalScore: number }> = [];

    for (const entry of vectorCandidates) {
      const vectorScore = vectorScores.get(entry.id) ?? 0;
      const keywordScore = this.calculateKeywordScore(entry.content, keywords);
      const finalScore = vectorScore * 0.7 + keywordScore * 0.3;

      scoredCandidates.push({
        entry,
        vectorScore,
        keywordScore,
        finalScore,
      });
    }

    // 按综合分数排序
    scoredCandidates.sort((a, b) => b.finalScore - a.finalScore);

    const elapsed = Date.now() - startTime;
    this.lastSearchMode = 'hybrid';

    log.info('📖 记忆检索完成', {
      query: query.slice(0, 50),
      source: 'dual-layer',
      sourceDetail: {
        vectorCandidates: vectorCandidates.length,
        keywords: keywords.slice(0, 5),
      },
      resultCount: Math.min(scoredCandidates.length, limit),
      elapsed: `${elapsed}ms`,
    });

    return scoredCandidates.slice(0, limit).map(item => ({
      ...item.entry,
      metadata: {
        ...item.entry.metadata,
        score: item.finalScore,
      },
    }));
  }

  /**
   * 向量检索
   */
  private async vectorSearch(
    query: string, 
    limit: number, 
    filter?: MemoryFilter, 
    modelId?: string
  ): Promise<MemoryEntry[]> {
    const config = this.core.storeConfig;
    
    // 检查嵌入服务是否可用
    if (!config.embeddingService?.isAvailable()) {
      log.info('🔍 [MemoryStore] 嵌入服务不可用，跳过向量检索');
      return [];
    }

    // 确定使用的模型和向量列
    const targetModel = modelId ?? config.embedModel;
    const vectorColumn = targetModel 
      ? this.core['getModelVectorColumn'](targetModel)
      : 'vector';

    // 检查表的向量维度
    const tableVectorDimension = await this.getVectorDimension(vectorColumn);
    if (tableVectorDimension === 0) {
      log.info('🔍 [MemoryStore] 表无向量数据，跳过向量检索', { vectorColumn, targetModel });
      return [];
    }

    log.info('🔍 [MemoryStore] 向量列检查通过', { vectorColumn, tableVectorDimension });

    try {
      const startTime = Date.now();
      const vector = await config.embeddingService.embed(query);
      
      // 检查向量维度是否匹配
      if (vector.length !== tableVectorDimension) {
        log.warn('⚠️ [MemoryStore] 向量维度不匹配，跳过向量检索', { 
          queryDimension: vector.length, 
          tableDimension: tableVectorDimension,
          vectorColumn,
        });
        return [];
      }
      
      // 构建过滤条件
      const conditions: string[] = [];
      
      if (filter?.sessionId) {
        conditions.push(`sessionId = "${this.core['escapeValue'](filter.sessionId)}"`);
      }
      if (filter?.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        const typeConditions = types.map(t => `type = "${this.core['escapeValue'](t)}"`).join(' OR ');
        conditions.push(`(${typeConditions})`);
      }
      
      const searchLimit = limit * 2;
      
      let queryBuilder = this.core.dbTable!.vectorSearch(vector)
        .column(vectorColumn)
        .limit(searchLimit);
      
      if (conditions.length > 0) {
        const whereClause = conditions.join(' AND ');
        queryBuilder = queryBuilder.where(whereClause);
      }
      
      log.debug('🔍 [MemoryStore] 执行向量搜索', { 
        vectorColumn, 
        queryDimension: vector.length,
        filter: conditions.length > 0 ? conditions.join(' AND ') : 'none'
      });
      
      const rawResults = await queryBuilder.toArray();
      
      // 过滤掉空向量记录
      const results = rawResults.filter(r => {
        const vec = r[vectorColumn];
        if (!vec) return false;
        if (Array.isArray(vec)) return vec.length > 0;
        if (typeof vec === 'object') {
          if ('length' in vec) return (vec as { length: number }).length > 0;
          if ('toArray' in vec) {
            const arr = (vec as { toArray: () => number[] }).toArray();
            return arr.length > 0;
          }
        }
        return false;
      }).slice(0, limit);
      
      const elapsed = Date.now() - startTime;

      log.info('📖 记忆检索完成', { 
        query: query.slice(0, 50),
        source: 'vector',
        sourceDetail: {
          column: vectorColumn,
          model: targetModel,
        },
        resultCount: results.length,
        rawCount: rawResults.length,
        elapsed: `${elapsed}ms`
      });

      return results.map(r => this.core['recordToEntry'](r));
    } catch (error) {
      log.warn('⚠️ [MemoryStore] 向量检索失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 全文检索
   */
  private async fulltextSearch(
    query: string, 
    limit: number, 
    filter?: MemoryFilter
  ): Promise<MemoryEntry[]> {
    const table = this.core.dbTable;
    if (!table) {
      log.error('🚨 [MemoryStore] 全文检索失败: 表未初始化');
      return [];
    }

    try {
      const startTime = Date.now();

      // 构建查询
      let queryBuilder = table.query();

      // 应用过滤条件
      if (filter) {
        const conditions: string[] = [];
        if (filter.sessionId) {
          conditions.push(`sessionId = "${filter.sessionId}"`);
        }
        if (filter.type) {
          const types = Array.isArray(filter.type) ? filter.type : [filter.type];
          const typeConditions = types.map(t => `type = "${t}"`).join(' OR ');
          conditions.push(`(${typeConditions})`);
        }
        if (conditions.length > 0) {
          queryBuilder = queryBuilder.where(conditions.join(' AND '));
        }
      }

      // 获取所有匹配记录
      const allResults = await queryBuilder.toArray();
      
      // 提取关键词
      const keywords = this.extractKeywords(query);
      
      const scored = allResults
        .map(r => {
          const content = (r.content as string).toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            const count = (content.match(new RegExp(this.escapeRegex(kw), 'g')) || []).length;
            score += count;
          }
          return { record: r, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const elapsed = Date.now() - startTime;
      
      log.info('📖 记忆检索完成', { 
        query: query.slice(0, 50),
        source: 'fulltext',
        sourceDetail: {
          keywords: keywords.slice(0, 5),
        },
        resultCount: scored.length,
        elapsed: `${elapsed}ms`
      });

      return scored.map(item => this.core['recordToEntry'](item.record));
    } catch (error) {
      log.error('🚨 [MemoryStore] 全文检索异常', { error: String(error) });
      return [];
    }
  }

  /**
   * 混合检索（向量 + 全文）
   */
  private async hybridSearch(
    query: string, 
    limit: number, 
    filter?: MemoryFilter, 
    modelId?: string
  ): Promise<MemoryEntry[]> {
    const targetModel = modelId ?? this.core.storeConfig.embedModel;
    const hasVectorColumn = targetModel ? await this.hasVectorColumn(targetModel) : true;

    const [vectorResults, fulltextResults] = await Promise.all([
      this.core.storeConfig.embeddingService?.isAvailable() && hasVectorColumn
        ? this.vectorSearch(query, limit, filter, targetModel) 
        : Promise.resolve([]),
      this.fulltextSearch(query, limit, filter),
    ]);

    // 合并结果，去重
    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const entry of vectorResults) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }

    for (const entry of fulltextResults) {
      if (!seen.has(entry.id) && merged.length < limit) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }

    log.info('📖 记忆检索完成', { 
      query: query.slice(0, 50),
      source: 'hybrid',
      sourceDetail: {
        vector: vectorResults.length,
        fulltext: fulltextResults.length,
      },
      resultCount: merged.length,
      model: targetModel,
    });

    return merged.slice(0, limit);
  }

  /**
   * 迁移中混合检索
   */
  private async migrationAwareSearch(
    query: string, 
    limit: number, 
    filter: MemoryFilter | undefined, 
    modelId: string | undefined,
    migrationStatus: MigrationStatus
  ): Promise<MemoryEntry[]> {
    const targetModel = modelId ?? this.core.storeConfig.embedModel;
    if (!targetModel) {
      return this.fulltextSearch(query, limit, filter);
    }
    
    const vectorColumn = this.core['getModelVectorColumn'](targetModel);
    
    const [vectorResults, fulltextResults] = await Promise.all([
      this.core.storeConfig.embeddingService?.isAvailable() && await this.hasVectorColumn(targetModel)
        ? this.vectorSearch(query, limit, filter, targetModel) 
        : Promise.resolve([]),
      this.fulltextSearchWithMigrationFilter(query, limit, filter, migrationStatus.migratedUntil),
    ]);

    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const entry of vectorResults) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }

    for (const entry of fulltextResults) {
      if (!seen.has(entry.id) && merged.length < limit) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }

    log.info('📖 记忆检索完成', { 
      query: query.slice(0, 50),
      source: 'migration-hybrid',
      sourceDetail: {
        vector: { count: vectorResults.length, desc: '已迁移部分' },
        fulltext: { count: fulltextResults.length, desc: '未迁移部分' },
      },
      resultCount: merged.length,
      migration: {
        progress: migrationStatus.progress,
        migratedUntil: migrationStatus.migratedUntil,
      },
    });

    return merged.slice(0, limit);
  }

  /**
   * 带迁移过滤的全文检索
   */
  private async fulltextSearchWithMigrationFilter(
    query: string, 
    limit: number, 
    filter: MemoryFilter | undefined,
    migratedUntil?: number
  ): Promise<MemoryEntry[]> {
    const table = this.core.dbTable;
    if (!table) return [];

    try {
      const startTime = Date.now();

      let queryBuilder = table.query();
      const conditions: string[] = [];
      
      if (migratedUntil !== undefined) {
        conditions.push(`createdAt > ${migratedUntil}`);
      }
      
      if (filter?.sessionId) {
        conditions.push(`sessionId = "${filter.sessionId}"`);
      }
      if (filter?.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        const typeConditions = types.map(t => `type = "${t}"`).join(' OR ');
        conditions.push(`(${typeConditions})`);
      }
      
      if (conditions.length > 0) {
        queryBuilder = queryBuilder.where(conditions.join(' AND '));
      }

      const allResults = await queryBuilder.toArray();
      const keywords = this.extractKeywords(query);
      
      const scored = allResults
        .map(r => {
          const content = (r.content as string).toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            const count = (content.match(new RegExp(this.escapeRegex(kw), 'g')) || []).length;
            score += count;
          }
          return { ...r, _score: score } as MemoryEntry & { _score: number };
        })
        .filter(r => r._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit);

      const elapsed = Date.now() - startTime;
      log.debug('🔍 [MemoryStore] 带迁移过滤的全文检索完成', {
        query: query.slice(0, 50),
        migratedUntil,
        resultCount: scored.length,
        elapsed,
      });

      return scored;
    } catch (error) {
      log.error('🔍 [MemoryStore] 带迁移过滤的全文检索失败', { error });
      return [];
    }
  }

  /**
   * 提取关键词（支持中英文混合）
   */
  private extractKeywords(query: string): string[] {
    const keywords: string[] = [];
    const lowerQuery = query.toLowerCase();
    
    // 1. 提取英文单词
    const englishWords = lowerQuery.match(/[a-z]+/g) || [];
    keywords.push(...englishWords.filter(w => w.length > 1));
    
    // 2. 提取中文词汇（n-gram）
    const chineseChars = lowerQuery.match(/[\u4e00-\u9fa5]/g) || [];
    if (chineseChars.length > 0) {
      // 2-gram
      for (let i = 0; i < chineseChars.length - 1; i++) {
        keywords.push(chineseChars[i] + chineseChars[i + 1]);
      }
      // 3-gram
      if (chineseChars.length > 3) {
        for (let i = 0; i < chineseChars.length - 2; i++) {
          keywords.push(chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2]);
        }
      }
    }
    
    // 3. 提取数字
    const numbers = lowerQuery.match(/\d+/g) || [];
    keywords.push(...numbers.filter(n => n.length > 1));
    
    return [...new Set(keywords)];
  }

  /**
   * 计算关键词匹配分数
   */
  private calculateKeywordScore(content: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;

    const lowerContent = content.toLowerCase();
    let matchCount = 0;
    let totalWeight = 0;

    for (const keyword of keywords) {
      const weight = keyword.length / keywords.reduce((sum, k) => sum + k.length, 0);
      totalWeight += weight;

      const regex = new RegExp(this.escapeRegex(keyword), 'gi');
      const matches = lowerContent.match(regex);
      if (matches && matches.length > 0) {
        matchCount += weight * Math.min(matches.length, 3);
      }
    }

    return totalWeight > 0 ? Math.min(matchCount / totalWeight, 1) : 0;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 检查是否存在指定模型的向量列
   */
  private async hasVectorColumn(modelId: string): Promise<boolean> {
    const columns = await this.getExistingVectorColumns();
    const targetColumn = this.core['getModelVectorColumn'](modelId);
    return columns.includes(targetColumn);
  }

  /**
   * 获取所有已存在的向量列名
   */
  private async getExistingVectorColumns(): Promise<string[]> {
    const table = this.core.dbTable;
    if (!table) return [];

    try {
      const schema = await table.schema();
      const vectorColumns: string[] = [];

      for (const field of schema.fields) {
        if (field.name.startsWith('vector_')) {
          vectorColumns.push(field.name);
        }
      }

      return vectorColumns;
    } catch (error) {
      log.error('🚨 [MemoryStore] 获取向量列失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 获取向量列的维度
   */
  private async getVectorDimension(column: string): Promise<number> {
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
   * 获取迁移状态（需外部提供）
   */
  private async getMigrationStatus(): Promise<MigrationStatus> {
    return {
      status: 'idle',
      progress: 0,
      migratedCount: 0,
      totalRecords: 0,
      failedCount: 0,
    };
  }
}
