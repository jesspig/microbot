/**
 * 会话类型定义
 */

import type { ChannelType } from './interfaces';
import type { LLMMessage } from './message';

/** 会话 ID */
export type SessionId = string;

/** 会话键（格式：channel:chatId） */
export type SessionKey = `${string}:${string}`;

/** 会话状态 */
export type SessionState = 'active' | 'idle' | 'closed';

/** 会话元数据 */
export interface SessionMetadata {
  /** 通道类型 */
  channel: ChannelType;
  /** 聊天 ID */
  chatId: string;
  /** 工作目录 */
  workspace: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** 自定义元数据 */
  custom?: Record<string, unknown>;
}

/** 会话快照 */
export interface SessionSnapshot {
  /** 会话键 */
  sessionKey: SessionKey;
  /** 会话状态 */
  state: SessionState;
  /** 消息历史 */
  messages: LLMMessage[];
  /** 元数据 */
  metadata: SessionMetadata;
  /** Token 预算使用情况 */
  tokenUsage?: {
    used: number;
    budget: number;
  };
}

/** 会话存储接口 */
export interface SessionStore {
  /** 获取会话 */
  get(sessionKey: SessionKey): Promise<SessionSnapshot | undefined>;
  /** 保存会话 */
  save(session: SessionSnapshot): Promise<void>;
  /** 删除会话 */
  delete(sessionKey: SessionKey): Promise<void>;
  /** 列出所有活跃会话 */
  listActive(): Promise<SessionSnapshot[]>;
}
