/**
 * Agent 客户端
 * 
 * 通过 IPC 与 Agent Service 通信。
 */

import { MicroAgentClient } from '@micro-agent/client-sdk';
import type { StreamChunk, ToolConfig, SkillConfig, MemoryConfig, KnowledgeConfig } from '@micro-agent/client-sdk';
import type { AgentClient, MessageContent } from './message-router';

/**
 * Agent 客户端配置
 */
export interface AgentClientConfig {
  /** IPC 路径 */
  ipcPath?: string;
  /** 超时时间 */
  timeout?: number;
}

/**
 * Agent 客户端实现
 */
export class AgentClientImpl implements AgentClient {
  private client: MicroAgentClient;
  private _connected = false;

  constructor(config?: AgentClientConfig) {
    this.client = new MicroAgentClient({
      transport: 'ipc',
      ipc: {
        path: config?.ipcPath,
        timeout: config?.timeout ?? 60000,
      },
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * 连接到 Agent Service
   */
  async connect(): Promise<void> {
    await this.client.connect();
    this._connected = true;
    console.log('[AgentClient] 已连接到 Agent Service');
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this._connected = false;
    console.log('[AgentClient] 已断开连接');
  }

  /**
   * 发送消息（流式）
   */
  async *chat(
    sessionId: string,
    content: MessageContent,
    metadata?: Record<string, unknown>
  ): AsyncIterable<StreamChunk> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }

    const text = content.type === 'text' ? content.text : JSON.stringify(content);

    // 使用 SDK 的流式接口
    for await (const chunk of this.client.chatStream({
      sessionId,
      content: { type: 'text', text },
      metadata,
    })) {
      yield chunk;
    }
  }

  /**
   * 执行任务（非流式）
   */
  async execute(
    sessionId: string,
    content: MessageContent,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }

    const text = content.type === 'text' ? content.text : JSON.stringify(content);

    const response = await this.client.chat({
      sessionId,
      content: { type: 'text', text },
      metadata,
    });

    return response.content ?? '';
  }

  /**
   * 获取服务状态
   */
  async getStatus(): Promise<{
    version: string;
    uptime: number;
    activeSessions: number;
  }> {
    const result = await this.client.sendRequest('status', {});
    return result as {
      version: string;
      uptime: number;
      activeSessions: number;
    };
  }

  /**
   * 设置系统提示词
   */
  async setSystemPrompt(prompt: string): Promise<void> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }
    await this.client.config.setSystemPrompt(prompt);
    console.log('[AgentClient] 系统提示词已设置');
  }

  /**
   * 注册工具
   */
  async registerTools(tools: ToolConfig[]): Promise<{ count: number; tools: string[] }> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }
    await this.client.config.registerTools(tools);
    console.log('[AgentClient] 工具已注册', { count: tools.length });
    return { count: tools.length, tools: tools.map(t => t.name) };
  }

  /**
   * 加载技能
   */
  async loadSkills(skills: SkillConfig[]): Promise<{ count: number; skills: string[] }> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }
    await this.client.config.loadSkills(skills);
    console.log('[AgentClient] 技能已加载', { count: skills.length });
    return { count: skills.length, skills: skills.map(s => s.name) };
  }

  /**
   * 配置记忆系统
   */
  async configureMemory(config: MemoryConfig): Promise<void> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }
    await this.client.config.configureMemory(config);
    console.log('[AgentClient] 记忆系统已配置', { enabled: config.enabled, mode: config.mode });
  }

  /**
   * 配置知识库
   */
  async configureKnowledge(config: KnowledgeConfig): Promise<void> {
    if (!this._connected) {
      throw new Error('未连接到 Agent Service');
    }
    await this.client.config.configureKnowledge(config);
    console.log('[AgentClient] 知识库已配置', { enabled: config.enabled });
  }
}
