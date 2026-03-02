/**
 * 核心存储功能
 * 
 * 负责基础的初始化、存储、查询和记录转换
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdir, writeFile, readFile, readdir, unlink, stat, appendFile } from 'fs/promises';
import { join } from 'path';
import type { MemoryEntry, MemoryStats, CleanupResult } from '../types';
import type { MemoryStoreConfig, EmbeddingService } from './types';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['memory', 'core']);

/** 默认配置 */
const DEFAULT_CONFIG: Partial<MemoryStoreConfig> = {
  defaultSearchLimit: 10,
  maxSearchLimit: 50,
  shortTermRetentionDays: 7,
};

/**
 * LanceDB 记录结构
 */
export type LanceDBRecord = Record<string, unknown>;

/**
 * 核心存储类
 * 
 * 负责基础的初始化、存储、查询和记录转换
 */
export class MemoryStoreCore {
  protected db: lancedb.Connection | null = null;
  protected table: lancedb.Table | null = null;
  protected config: MemoryStoreConfig;
  protected initialized = false;

  constructor(config: MemoryStoreConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const storagePath = this.expandPath(this.config.storagePath);

    // 创建目录结构
    await mkdir(join(storagePath, 'sessions'), { recursive: true });
    await mkdir(join(storagePath, 'summaries'), { recursive: true });
    await mkdir(join(storagePath, 'lancedb'), { recursive: true });

    // 连接 LanceDB
    this.db = await lancedb.connect(join(storagePath, 'lancedb'));

    // 创建或打开表
    const tableName = 'memories';
    const tables = await this.db.tableNames();

    if (tables.includes(tableName)) {
      this.table = await this.db.openTable(tableName);
      const existingCount = await this.table.countRows();
      log.info('📐 [MemoryStore] 打开已有向量表', { 
        existingEntries: existingCount 
      });
    } else {
      log.info('📐 [MemoryStore] 创建向量表');
      // 子类负责创建表结构
    }

    this.initialized = true;
    
    // 显示已有记忆数量
    const existingCount = await this.table?.countRows() ?? 0;
    log.debug('记忆存储已初始化', { 
      path: storagePath,
      existingEntries: existingCount
    });
    
    if (existingCount > 0) {
      log.debug('📚 [MemoryStore] 加载已有记忆', { count: existingCount });
    }
  }

  /**
   * 动态检测嵌入向量维度
   */
  protected async detectVectorDimension(): Promise<number> {
    // 尝试通过嵌入服务获取实际维度
    if (this.config.embeddingService?.isAvailable()) {
      try {
        const sampleVector = await this.config.embeddingService.embed('test');
        const dimension = sampleVector.length;
        log.info('📐 [MemoryStore] 检测到嵌入模型维度', { dimension });
        return dimension;
      } catch (error) {
        log.warn('📐 [MemoryStore] 嵌入维度检测失败', { 
          error: String(error)
        });
      }
    }

    // 降级：使用全文检索模式（向量维度设为 0）
    log.info('📐 [MemoryStore] 无可用嵌入服务，使用全文检索模式');
    return 0;
  }

  /**
   * 存储记忆条目（双存储）
   */
  async store(entry: MemoryEntry): Promise<void> {
    await this.ensureInitialized();

    // 获取向量（如果嵌入服务可用）
    let vector = entry.vector ?? (await this.getEmbedding(entry.content));
    
    // 检查向量有效性：空数组或 null 都视为无效
    if (vector && Array.isArray(vector) && vector.length === 0) {
      log.warn('⚠️ [MemoryStore] 检测到空向量，将按无向量处理', { 
        id: entry.id,
        content: entry.content.slice(0, 100)
      });
      vector = undefined;
    }

    // 确定向量列名
    const embedModel = this.config.embedModel;
    const vectorColumn = embedModel 
      ? this.getModelVectorColumn(embedModel) 
      : 'vector';

    // 提取 documentId（用于文档分块的精确删除）
    const documentId = entry.metadata?.documentId ?? '';

    // 1. 存储到 LanceDB（主存储）
    const record: Record<string, unknown> = {
      id: entry.id,
      sessionId: entry.sessionId,
      type: entry.type,
      content: entry.content,
      [vectorColumn]: vector ?? [],
      metadata: JSON.stringify(entry.metadata),
      createdAt: entry.createdAt.getTime(),
      updatedAt: entry.updatedAt.getTime(),
      // 多嵌入模型支持
      active_embed: embedModel ?? null,
      embed_versions: embedModel ? JSON.stringify({ [embedModel]: Date.now() }) : null,
      // 独立 documentId 列（用于精确删除文档分块）
      documentId,
    };

    await this.table?.add([record]);

    // 2. 存储到 Markdown（人类可读备份）
    await this.storeMarkdown(entry);

    log.info('💾 [MemoryStore] 记忆已存储', { 
      id: entry.id, 
      type: entry.type,
      sessionId: entry.sessionId,
      hasVector: !!vector,
      vectorLength: vector?.length ?? 0,
      vectorColumn,
      embedModel,
      mode: vector ? 'vector' : 'fulltext'
    });
  }

  /**
   * 批量存储记忆条目
   */
  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    await this.ensureInitialized();

    // 确定向量列名
    const embedModel = this.config.embedModel;
    const vectorColumn = embedModel 
      ? this.getModelVectorColumn(embedModel) 
      : 'vector';

    const records: Record<string, unknown>[] = [];
    let validVectorCount = 0;
    let emptyVectorCount = 0;

    for (const entry of entries) {
      let vector = entry.vector ?? (await this.getEmbedding(entry.content));
      
      // 检查向量有效性
      if (vector && Array.isArray(vector) && vector.length === 0) {
        vector = undefined;
        emptyVectorCount++;
      } else if (vector && Array.isArray(vector) && vector.length > 0) {
        validVectorCount++;
      }
      
      // 提取 documentId（用于文档分块的精确删除）
      const documentId = entry.metadata?.documentId ?? '';

      records.push({
        id: entry.id,
        sessionId: entry.sessionId,
        type: entry.type,
        content: entry.content,
        [vectorColumn]: vector ?? [],
        metadata: JSON.stringify(entry.metadata),
        createdAt: entry.createdAt.getTime(),
        updatedAt: entry.updatedAt.getTime(),
        // 多嵌入模型支持
        active_embed: embedModel ?? null,
        embed_versions: embedModel ? JSON.stringify({ [embedModel]: Date.now() }) : null,
        // 独立 documentId 列（用于精确删除文档分块）
        documentId,
      });
    }

    // 批量写入 LanceDB
    await this.table?.add(records);

    // 批量写入 Markdown
    for (const entry of entries) {
      await this.storeMarkdown(entry);
    }

    log.info('💾 [MemoryStore] 批量存储完成', { 
      count: entries.length, 
      validVectors: validVectorCount,
      emptyVectors: emptyVectorCount,
      vectorColumn 
    });
  }

  /**
   * 获取最近记忆
   */
  async getRecent(sessionId: string, limit: number = 20): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    if (!this.table) return [];

    const results = await this.table
      .query()
      .where(`sessionId = "${this.escapeValue(sessionId)}"`)
      .limit(limit)
      .toArray();

    log.debug('📖 [MemoryStore] 获取最近记忆', { 
      sessionId, 
      limit, 
      resultCount: results.length 
    });

    return results.map(r => this.recordToEntry(r));
  }

  /**
   * 根据 ID 获取记忆
   */
  async getById(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();

    if (!this.table) return null;

    const results = await this.table
      .query()
      .where(`id = "${this.escapeValue(id)}"`)
      .limit(1)
      .toArray();

    const first = results[0];
    return first ? this.recordToEntry(first) : null;
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.table?.delete(`id = "${this.escapeValue(id)}"`);
    log.debug('记忆已删除', { id });
  }

  /**
   * 清除会话记忆
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    await this.table?.delete(`sessionId = "${this.escapeValue(sessionId)}"`);
    log.info('会话记忆已清除', { sessionId });
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<MemoryStats> {
    await this.ensureInitialized();

    const results = await this.table?.query().toArray();
    const entries = results ?? [];

    const sessions = new Set(entries.map(e => e.sessionId as string));
    const timestamps = entries.map(e => e.createdAt as number);

    return {
      totalEntries: entries.length,
      totalSessions: sessions.size,
      totalSize: 0, // 需要单独计算文件大小
      oldestEntry: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
      newestEntry: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
    };
  }

  /**
   * 获取记录总数
   */
  async count(): Promise<number> {
    await this.ensureInitialized();
    const results = await this.table?.query().toArray();
    return results?.length ?? 0;
  }

  /**
   * 清理过期记忆
   */
  async cleanupExpired(): Promise<CleanupResult> {
    await this.ensureInitialized();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.shortTermRetentionDays!);
    const cutoffTimestamp = cutoffDate.getTime();

    const results = await this.table?.query().toArray();
    const expired = (results ?? [])
      .filter(r => (r.createdAt as number) < cutoffTimestamp)
      .map(r => r.id as string);

    for (const expiredId of expired) {
      await this.table?.delete(`id = "${this.escapeValue(expiredId)}"`);
    }

    log.info('过期记忆已清理', { count: expired.length });
    return {
      deletedCount: expired.length,
      summarizedCount: 0,
      errors: [],
    };
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    this.initialized = false;
    log.info('📦 [MemoryStore] 存储已关闭');
  }

  // ========== 受保护的辅助方法 ==========

  protected async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 转义 SQL 查询中的字符串值
   */
  protected escapeValue(value: string): string {
    // 转义反斜杠和双引号
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  protected expandPath(path: string): string {
    if (path.startsWith('~')) {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
      return join(home, path.slice(1));
    }
    return path;
  }

  protected async getEmbedding(text: string): Promise<number[] | undefined> {
    if (this.config.embeddingService?.isAvailable()) {
      try {
        return await this.config.embeddingService.embed(text);
      } catch (error) {
        log.warn('嵌入生成失败', { error: String(error) });
      }
    }
    return undefined;
  }

  protected recordToEntry(record: Record<string, unknown>): MemoryEntry {
    return {
      id: record.id as string,
      sessionId: record.sessionId as string,
      type: record.type as MemoryEntry['type'],
      content: record.content as string,
      vector: Array.isArray(record.vector) && (record.vector as number[]).length > 0 
        ? record.vector as number[] 
        : undefined,
      metadata: typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata as MemoryEntry['metadata'],
      createdAt: new Date(record.createdAt as number),
      updatedAt: new Date(record.updatedAt as number),
    };
  }

  /**
   * 存储到 Markdown 文件（追加模式）
   */
  private async storeMarkdown(entry: MemoryEntry): Promise<void> {
    const storagePath = this.expandPath(this.config.storagePath);
    const sessionsPath = join(storagePath, 'sessions');
    
    // 确保目录存在
    await mkdir(sessionsPath, { recursive: true });

    // 当天的文件名
    const today = this.formatDate(new Date());
    const mdPath = join(sessionsPath, `${today}.md`);

    // 检查文件是否存在
    let isNewFile = false;
    try {
      await stat(mdPath);
    } catch {
      isNewFile = true;
    }

    // 构建要写入的内容
    let content = '';
    if (isNewFile) {
      // 新文件：写入头部
      content = `# 记忆 - ${today}\n\n`;
    } else {
      // 已有文件：添加分隔符
      content = '\n---\n\n';
    }

    // 追加当前记录
    content += this.formatEntryMarkdown(entry) + '\n';

    // 立即写入文件
    await appendFile(mdPath, content, 'utf-8');
    
    log.debug('📝 [MemoryStore] Markdown 已保存', { 
      file: `${today}.md`,
      entryId: entry.id 
    });
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 格式化单条记忆为 Markdown
   */
  private formatEntryMarkdown(entry: MemoryEntry): string {
    const timeLabel = entry.type === 'summary' ? '📝 摘要' : 
                      entry.type === 'entity' ? '🏷️ 实体' : '💬 对话';
    
    const lines: string[] = [
      `## ${timeLabel}`,
      ``,
      `**ID**: \`${entry.id}\``,
      `**会话**: \`${entry.sessionId}\``,
      `**时间**: ${entry.createdAt.toLocaleString('zh-CN')}`,
      `**标签**: ${(entry.metadata.tags ?? []).join(', ') || '无'}`,
      ``,
      '### 内容',
      ``,
      entry.content,
    ];

    return lines.join('\n');
  }

  /**
   * 模型 ID 转向量列名（子类可覆盖）
   */
  protected getModelVectorColumn(modelId: string): string {
    const [provider, ...modelParts] = modelId.split('/');
    const model = modelParts.join('/');
    const safeModel = model
      .replace(/\//g, '_s_')
      .replace(/:/g, '_c_')
      .replace(/\./g, '_d_')
      .replace(/-/g, '_h_');
    return `vector_${provider}_${safeModel}`;
  }

  /**
   * 向量列名转模型 ID（子类可覆盖）
   */
  protected getVectorColumnModelId(column: string): string {
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

  // Getter
  get dbConnection(): lancedb.Connection | null {
    return this.db;
  }

  get dbTable(): lancedb.Table | null {
    return this.table;
  }

  get storeConfig(): MemoryStoreConfig {
    return this.config;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}