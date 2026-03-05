/**
 * 知识库索引构建器
 */

import type { KnowledgeDocument, KnowledgeChunk } from './types';
import type { EmbeddingService } from '../memory/types';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['knowledge', 'indexer']);

/** 索引配置 */
export interface IndexerConfig {
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * 创建文档索引构建器
 */
export function createDocumentIndexer(
  config: IndexerConfig,
  embeddingService?: EmbeddingService,
  onIndexComplete?: (doc: KnowledgeDocument, chunkCount: number) => void,
  onIndexError?: (doc: KnowledgeDocument, error: unknown) => void
): {
  buildDocumentIndex: (doc: KnowledgeDocument) => Promise<void>;
  chunkDocument: (doc: KnowledgeDocument) => KnowledgeChunk[];
} {
  return {
    async buildDocumentIndex(doc: KnowledgeDocument): Promise<void> {
      doc.status = 'processing';

      try {
        const chunks = this.chunkDocument(doc);

        // 为每个块生成向量
        if (embeddingService?.isAvailable()) {
          for (const chunk of chunks) {
            try {
              chunk.vector = await embeddingService.embed(chunk.content);
            } catch (e) {
              log.warn('块向量生成失败', { chunkId: chunk.id, error: String(e) });
            }
          }
        }

        doc.chunks = chunks;
        doc.status = 'indexed';
        doc.indexedAt = Date.now();

        onIndexComplete?.(doc, chunks.length);
        log.info('文档索引完成', { path: doc.path, chunkCount: chunks.length });
      } catch (error) {
        doc.status = 'error';
        doc.error = String(error);
        onIndexError?.(doc, error);
        log.error('文档索引失败', { path: doc.path, error: String(error) });
      }
    },

    chunkDocument(doc: KnowledgeDocument): KnowledgeChunk[] {
      const chunks: KnowledgeChunk[] = [];
      const { chunkSize, chunkOverlap } = config;
      const content = doc.content;

      // 按段落分割
      const paragraphs = content.split(/\n\s*\n/);
      let currentChunk = '';
      let currentPos = 0;
      let chunkStartPos = 0;

      for (const paragraph of paragraphs) {
        const trimmed = paragraph.trim();
        if (!trimmed) continue;

        if (currentChunk.length + trimmed.length > chunkSize && currentChunk.length > 0) {
          chunks.push(createChunk(doc.id, currentChunk, chunkStartPos, currentPos));

          const overlap = currentChunk.slice(-chunkOverlap);
          currentChunk = overlap + '\n\n' + trimmed;
          chunkStartPos = currentPos - overlap.length;
        } else {
          if (currentChunk.length > 0) {
            currentChunk += '\n\n';
            currentPos += 2;
          }
          currentChunk += trimmed;
        }

        currentPos += trimmed.length;
      }

      if (currentChunk.length > 0) {
        chunks.push(createChunk(doc.id, currentChunk, chunkStartPos, content.length));
      }

      return chunks;
    },
  };
}

function createChunk(
  docId: string,
  content: string,
  startPos: number,
  endPos: number
): KnowledgeChunk {
  return {
    id: `${docId}_chunk_${startPos}`,
    docId,
    content,
    startPos,
    endPos,
  };
}
