/**
 * 文档分块管理模块
 * 
 * 负责文档分块的存储、删除和查询
 */

import type { MemoryEntry } from '../types';
import type { KnowledgeChunk, KnowledgeDocMetadata } from '../knowledge/types';
import type { MemoryStoreCore } from './core';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'document-manager']);

/**
 * 文档分块管理器
 */
export class DocumentManager {
  private core: MemoryStoreCore;

  constructor(core: MemoryStoreCore) {
    this.core = core;
  }

  /**
   * 存储文档分块（增量更新）
   */
  async storeDocumentChunks(
    docId: string,
    chunks: KnowledgeChunk[],
    metadata: KnowledgeDocMetadata
  ): Promise<void> {
    const table = this.core.dbTable;
    if (!table) return;

    if (chunks.length === 0) {
      await this.deleteDocumentChunks(docId);
      log.info('📄 [MemoryStore] 文档分块已清空', { docId });
      return;
    }

    const existingChunks = await this.getDocumentChunks(docId);
    const existingIds = new Set(existingChunks.map(c => c.id));
    const newIds = new Set(chunks.map(c => c.id));

    const toDelete = existingChunks.filter(c => !newIds.has(c.id));
    const toAdd = chunks.filter(c => !existingIds.has(c.id));

    if (toDelete.length > 0) {
      const deleteIds = toDelete.map(c => `"${c.id}"`).join(', ');
      await table.delete(`id IN (${deleteIds})`);
      log.debug('📄 [MemoryStore] 删除旧分块', { docId, count: toDelete.length });
    }

    if (toAdd.length > 0) {
      const entries: MemoryEntry[] = toAdd.map((chunk, index) => ({
        id: chunk.id,
        sessionId: 'knowledge_base',
        type: 'document' as const,
        content: chunk.content,
        vector: chunk.vector,
        metadata: {
          documentId: docId,
          documentPath: metadata.originalName,
          fileType: metadata.fileType,
          documentTitle: metadata.title,
          chunkIndex: chunks.indexOf(chunk),
          chunkStart: chunk.startPos,
          chunkEnd: chunk.endPos,
          tags: ['knowledge_base', metadata.fileType, ...(metadata.tags || [])],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await this.core.storeBatch(entries);
    }

    log.info('📄 [MemoryStore] 文档分块已更新', {
      docId,
      total: chunks.length,
      added: toAdd.length,
      deleted: toDelete.length,
      unchanged: chunks.length - toAdd.length,
      title: metadata.title || metadata.originalName,
    });
  }

  /**
   * 删除文档的所有分块
   */
  async deleteDocumentChunks(docId: string): Promise<void> {
    const table = this.core.dbTable;
    if (!table) return;

    try {
      await table.delete(`documentId = "${docId}"`);
      log.info('📄 [MemoryStore] 文档分块已删除', { docId });
    } catch (error) {
      try {
        await table.delete(`type = 'document' AND metadata LIKE '%"documentId":"${docId}"%'`);
        log.info('📄 [MemoryStore] 文档分块已删除（兼容模式）', { docId });
      } catch {
        log.debug('📄 [MemoryStore] 删除文档分块时无匹配记录', { docId });
      }
    }
  }

  /**
   * 获取文档的所有分块
   */
  async getDocumentChunks(docId: string): Promise<MemoryEntry[]> {
    const table = this.core.dbTable;
    if (!table) return [];

    try {
      const records = await table
        ?.query()
        .where(`documentId = "${docId}"`)
        .toArray() ?? [];

      return records.map(record => this.core['recordToEntry'](record));
    } catch {
      try {
        const records = await table
          ?.query()
          .where(`type = 'document' AND metadata LIKE '%"documentId":"${docId}"%'`)
          .toArray() ?? [];

        return records.map(record => this.core['recordToEntry'](record));
      } catch (error) {
        log.warn('📄 [MemoryStore] 获取文档分块失败', { docId, error: String(error) });
        return [];
      }
    }
  }

  /**
   * 按类型统计记忆数量
   */
  async getStatsByType(): Promise<Record<string, number>> {
    const table = this.core.dbTable;
    if (!table) return {};

    const stats: Record<string, number> = {};
    
    try {
      const records = await table.query().toArray();
      
      for (const record of records) {
        const type = String(record.type || 'other');
        stats[type] = (stats[type] || 0) + 1;
      }
    } catch (error) {
      log.warn('📊 [MemoryStore] 统计记忆类型失败', { error: String(error) });
    }

    return stats;
  }
}