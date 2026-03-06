/**
 * MicroAgent CLI 应用
 *
 * 连接 Agent Service，路由消息到各通道（飞书等）
 */

import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from '@micro-agent/config';
import { MessageRouter } from './modules/message-router';
import { FeishuWrapper, type FeishuConfig as FeishuWrapperConfig } from './modules/feishu-wrapper';
import { AgentClientImpl } from './modules/agent-client';
import {
  displayStartupInfo,
  displaySuccessInfo,
  displayErrorInfo,
  displayShutdownInfo,
} from './modules/startup-info';

/** 应用配置 */
export interface AppConfig {
  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn';
  /** IPC 路径 */
  ipcPath?: string;
  /** 配置文件路径 */
  configPath?: string;
  /** 详细输出 */
  verbose?: boolean;
}

/** 应用接口 */
export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): { running: boolean; channels: string[]; sessions: number };
}

/**
 * CLI 应用实现
 */
class CLIApp implements App {
  private running = false;
  private config: AppConfig;
  private router: MessageRouter | null = null;
  private agentClient: AgentClientImpl | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('应用已在运行中');
      return;
    }

    // 显示启动信息
    displayStartupInfo({
      verbose: this.config.verbose,
      configPath: this.config.configPath,
      channels: this.getEnabledChannels(),
      ipcPath: this.config.ipcPath,
    });

    try {
      // 加载配置
      const settings = this.loadSettings();

      // 创建 Agent 客户端
      this.agentClient = new AgentClientImpl({
        ipcPath: this.config.ipcPath,
        timeout: 60000,
      });

      // 创建消息路由器
      this.router = new MessageRouter(this.agentClient);

      // 注册通道
      await this.registerChannels(settings, this.router);

      // 启动路由器
      await this.router.start();

      this.running = true;

      // 显示成功信息
      displaySuccessInfo({
        channels: this.getChannelStatus(),
        sessions: this.router.activeSessionCount,
        ipcPath: this.config.ipcPath ?? '默认',
      });

      // 保持运行
      await this.keepAlive();

    } catch (error) {
      displayErrorInfo(error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    displayShutdownInfo();
    this.running = false;

    if (this.router) {
      await this.router.stop();
    }

    console.log('  ✓ 已停止');
  }

  getStatus(): { running: boolean; channels: string[]; sessions: number } {
    return {
      running: this.running,
      channels: this.getConnectedChannels(),
      sessions: this.router?.activeSessionCount ?? 0,
    };
  }

  /**
   * 加载用户设置
   */
  private loadSettings(): Settings {
    try {
      const config = loadConfig({});
      return {
        agents: config.agents,
        providers: config.providers,
        channels: config.channels,
      };
    } catch (error) {
      console.log(`  配置加载失败: ${error instanceof Error ? error.message : String(error)}`);
      return { channels: {} };
    }
  }

  /**
   * 注册通道
   */
  private async registerChannels(settings: Settings, router: MessageRouter): Promise<void> {
    // 飞书通道
    if (settings.channels?.feishu?.enabled) {
      const feishuConfig = settings.channels.feishu;
      
      if (!feishuConfig.appId || !feishuConfig.appSecret) {
        console.log('  ⚠ 飞书配置不完整，跳过');
        return;
      }

      console.log('  连接飞书...');

      try {
        const feishu = new FeishuWrapper({
          appId: feishuConfig.appId,
          appSecret: feishuConfig.appSecret,
          encryptKey: feishuConfig.encryptKey,
          verificationToken: feishuConfig.verificationToken,
        });

        router.registerChannel(feishu);
        console.log('  ✓ 飞书通道已注册');
      } catch (error) {
        console.log(`  ✗ 飞书通道注册失败: ${(error as Error).message}`);
      }
    }
  }

  /**
   * 获取已启用的通道列表
   */
  private getEnabledChannels(): string[] {
    const settings = this.loadSettings();
    const channels: string[] = [];

    if (settings.channels?.feishu?.enabled) {
      channels.push('feishu');
    }

    return channels;
  }

  /**
   * 获取已连接的通道列表
   */
  private getConnectedChannels(): string[] {
    if (!this.router) return [];
    
    const channels: string[] = [];
    const status = this.getChannelStatus();
    
    for (const ch of status) {
      if (ch.connected) {
        channels.push(ch.type);
      }
    }
    
    return channels;
  }

  /**
   * 获取通道状态
   */
  private getChannelStatus(): { type: string; connected: boolean }[] {
    // 简化实现，实际需要从 router 获取
    const settings = this.loadSettings();
    const status: { type: string; connected: boolean }[] = [];

    if (settings.channels?.feishu?.enabled) {
      status.push({ type: 'feishu', connected: this.running });
    }

    return status;
  }

  /**
   * 保持运行
   */
  private keepAlive(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.running) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }
}

/** 用户设置接口 */
interface Settings {
  agents?: {
    models?: {
      chat?: string;
      tool?: string;
      embed?: string;
      vision?: string;
      coder?: string;
      intent?: string;
    };
    workspace?: string;
    memory?: {
      enabled?: boolean;
    };
  };
  providers?: Record<string, {
    baseUrl?: string;
    apiKey?: string;
    models?: string[];
  }>;
  channels?: {
    feishu?: FeishuChannelConfig;
  };
}

/** 飞书通道配置 */
interface FeishuChannelConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
}

/**
 * 创建应用
 */
export async function createApp(config: AppConfig): Promise<App> {
  return new CLIApp(config);
}