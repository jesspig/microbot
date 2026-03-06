/**
 * MicroAgent CLI 应用
 *
 * 连接 Agent Service，路由消息到各通道（飞书等）
 */

import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { loadConfig, createDefaultUserConfig } from '@micro-agent/config';
import { MessageRouter } from './modules/message-router';
import { FeishuWrapper, type FeishuConfig as FeishuWrapperConfig } from './modules/feishu-wrapper';
import { AgentClientImpl } from './modules/agent-client';
import {
  createDefaultStartupInfo,
  printStartupInfo,
  displayErrorInfo,
  displayShutdownInfo,
  type StartupInfo,
} from './modules/startup-info';
import { getBuiltinToolConfigs } from './modules/tools-init';
import { getBuiltinSkillConfigs, getSkillsBuiltinPath } from './modules/skills-init';
import { getProviderConfigs, parseDefaultModelInfo } from './modules/providers-init';
import { getMemorySystemConfig, getSearchModeDescription, getEmbeddingModelInfo } from './modules/memory-init';
import { ensureUserConfigFiles, loadSystemPrompt } from './modules/system-prompt';
import { getLogger } from '@logtape/logtape';
import { existsSync } from 'fs';
import { SkillsLoader } from '@micro-agent/sdk';
import { fileURLToPath } from 'url';

const log = getLogger(['cli', 'app']);

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
  getRunningChannels(): string[];
  getProviderStatus(): string;
}

/**
 * CLI 应用实现
 */
class CLIApp implements App {
  private running = false;
  private config: AppConfig;
  private router: MessageRouter | null = null;
  private agentClient: AgentClientImpl | null = null;
  private skillsLoader: SkillsLoader | null = null;
  private startupInfo: StartupInfo;
  private settings: Settings;

  constructor(config: AppConfig) {
    this.config = config;
    this.startupInfo = createDefaultStartupInfo();
    this.settings = this.loadSettings();
  }

  async start(): Promise<void> {
    if (this.running) {
      log.warn('应用已在运行中');
      return;
    }

    try {
      // 1. 确保用户配置文件存在
      this.ensureUserConfigFiles();

      // 2. 初始化技能加载器
      this.initSkillsLoader();

      // 3. 收集启动信息
      this.collectStartupInfo();

      // 4. 创建 Agent 客户端
      this.agentClient = new AgentClientImpl({
        ipcPath: this.config.ipcPath,
        timeout: 60000,
      });

      // 5. 创建消息路由器
      this.router = new MessageRouter(this.agentClient);

      // 6. 注册通道
      await this.registerChannels();

      // 7. 启动路由器（连接到 Agent Service）
      await this.router.start();

      // 8. 向 Agent Service 传递配置
      await this.configureAgentService();

      this.running = true;

      // 9. 打印启动信息
      printStartupInfo(this.startupInfo);

      log.info('应用启动完成');

      // 10. 保持运行
      await this.keepAlive();

    } catch (error) {
      displayErrorInfo(error as Error);
      throw error;
    }
  }

  /**
   * 初始化技能加载器
   */
  private initSkillsLoader(): void {
    const workspace = this.settings.agents?.workspace || process.cwd();
    const builtinPath = getSkillsBuiltinPath();
    
    this.skillsLoader = new SkillsLoader(workspace, builtinPath);
    this.skillsLoader.load();
    
    log.info('技能加载器已初始化', { count: this.skillsLoader.count });
  }

  /**
   * 配置 Agent Service
   * 
   * 将 CLI 收集的配置传递给 Agent Service
   */
  private async configureAgentService(): Promise<void> {
    if (!this.agentClient || !this.agentClient.connected) {
      log.warn('Agent Service 未连接，跳过配置传递');
      return;
    }

    log.info('开始配置 Agent Service...');

    try {
      const workspace = this.settings.agents?.workspace || process.cwd();

      // 1. 设置系统提示词（使用 SkillsLoader 构建完整提示词）
      const systemPrompt = loadSystemPrompt(workspace, this.skillsLoader);
      await this.agentClient.setSystemPrompt(systemPrompt);
      log.info('系统提示词已传递', { length: systemPrompt.length });

      // 2. 注册工具
      const tools = getBuiltinToolConfigs();
      const enabledTools = tools.filter(t => t.enabled !== false);
      if (enabledTools.length > 0) {
        await this.agentClient.registerTools(enabledTools);
        log.info('工具已注册', { count: enabledTools.length });
      }

      // 3. 加载技能（传递完整技能信息，包含路径）
      if (this.skillsLoader && this.skillsLoader.count > 0) {
        const skills = this.skillsLoader.getAll().map(s => ({
          name: s.name,
          description: s.description,
          enabled: true,
          path: s.skillPath,
          always: s.always,
          allowedTools: s.allowedTools,
        }));
        await this.agentClient.loadSkills(skills);
        log.info('技能已加载', { count: skills.length });
      }

      // 4. 配置记忆系统
      const memoryConfig = getMemorySystemConfig(this.settings as any);
      if (memoryConfig.enabled) {
        // 获取嵌入模型信息
        const embedModelInfo = getEmbeddingModelInfo(this.settings as any);
        
        await this.agentClient.configureMemory({
          enabled: true,
          mode: memoryConfig.mode,
          embedModel: memoryConfig.embedModel,
          embedBaseUrl: embedModelInfo?.baseUrl,
          embedApiKey: embedModelInfo?.apiKey,
          storagePath: memoryConfig.storagePath,
          searchLimit: memoryConfig.searchLimit,
          autoSummarize: memoryConfig.autoSummarize,
          summarizeThreshold: memoryConfig.summarizeThreshold,
        });
        log.info('记忆系统已配置', { mode: memoryConfig.mode, hasEmbedding: !!embedModelInfo?.baseUrl });
      }

      // 5. 配置知识库
      if (this.settings.agents?.workspace) {
        // 获取嵌入模型信息
        const embedModelInfo = getEmbeddingModelInfo(this.settings as any);
        
        await this.agentClient.configureKnowledge({
          enabled: true,
          basePath: resolve(this.settings.agents.workspace, '.knowledge'),
          embedModel: this.settings.agents.models?.embed,
          embedBaseUrl: embedModelInfo?.baseUrl,
          embedApiKey: embedModelInfo?.apiKey,
        });
        log.info('知识库已配置', { hasEmbedding: !!embedModelInfo?.baseUrl });
      }

      log.info('Agent Service 配置完成');
    } catch (error) {
      log.error('配置 Agent Service 失败', { error: error instanceof Error ? error.message : String(error) });
      // 配置失败不阻止启动，但记录警告
      this.startupInfo.warningMessages.push(`Agent Service 配置传递失败: ${error instanceof Error ? error.message : String(error)}`);
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

  getRunningChannels(): string[] {
    return this.startupInfo.channels;
  }

  getProviderStatus(): string {
    const providers = getProviderConfigs(this.settings as any);
    if (providers.length === 0) {
      return '未配置';
    }
    const { defaultProviderName } = parseDefaultModelInfo(this.settings as any);
    return defaultProviderName || providers[0].name;
  }

  /**
   * 确保用户配置文件存在
   */
  private ensureUserConfigFiles(): void {
    const { created } = ensureUserConfigFiles();
    if (created.length > 0) {
      log.info('已创建提示词文件', { files: created });
    }

    // 创建默认 settings.yaml（如果不存在）
    const templatesPath = this.getTemplatesPath();
    createDefaultUserConfig(templatesPath);
  }

  /**
   * 获取模板路径
   */
  private getTemplatesPath(): string {
    // 模板目录包含 settings.example.yaml
    // 路径：applications/templates/configs/ 或 templates/configs/
    const possiblePaths = [
      resolve(import.meta.dir, '../../templates/configs'), // applications/templates/configs
      resolve(import.meta.dir, '../../../templates/configs'), // 项目根目录 templates/configs
    ];

    for (const path of possiblePaths) {
      const settingsExample = join(path, 'settings.example.yaml');
      if (existsSync(settingsExample)) {
        return path;
      }
    }

    // 回退到 applications/templates/configs
    return possiblePaths[0];
  }

  /**
   * 收集启动信息
   */
  private collectStartupInfo(): void {
    // 收集工具信息
    log.info('初始化工具...');
    const tools = getBuiltinToolConfigs();
    this.startupInfo.tools = tools.filter(t => t.enabled).map(t => t.name);
    log.info('工具已加载', { count: this.startupInfo.tools.length, tools: this.startupInfo.tools });

    // 收集技能信息（使用 SkillsLoader）
    log.info('加载技能...');
    if (this.skillsLoader && this.skillsLoader.count > 0) {
      this.startupInfo.skills = this.skillsLoader.getAll().map(s => s.name);
      log.info('技能已加载', { count: this.startupInfo.skills.length, skills: this.startupInfo.skills.slice(0, 5) });
    }

    // 收集模型信息
    log.info('解析模型配置...');
    if (this.settings.agents?.models) {
      this.startupInfo.models = {
        chat: this.settings.agents.models.chat,
        vision: this.settings.agents.models.vision,
        embed: this.settings.agents.models.embed,
        coder: this.settings.agents.models.coder,
        intent: this.settings.agents.models.intent,
      };
      if (this.settings.agents.models.chat) {
        log.info('对话模型', { model: this.settings.agents.models.chat });
      }
    }

    // 收集 Provider 信息
    log.info('初始化 Provider...');
    const providers = getProviderConfigs(this.settings as any);
    if (providers.length > 0) {
      log.info('Provider �����置', { count: providers.length, providers: providers.map(p => p.name) });
    }

    // 收集记忆系统信息
    log.info('初始化记忆系统...');
    const memoryConfig = getMemorySystemConfig(this.settings as any);
    this.startupInfo.memory = {
      mode: memoryConfig.mode,
      embedModel: memoryConfig.embedModel,
      storagePath: memoryConfig.storagePath,
      autoSummarize: memoryConfig.autoSummarize,
      summarizeThreshold: memoryConfig.summarizeThreshold,
    };
    if (memoryConfig.enabled) {
      log.info('记忆系统已启用', { mode: memoryConfig.mode, embedModel: memoryConfig.embedModel });
    }

    // 收集通道信息
    log.info('初始化消息通道...');
    this.startupInfo.channels = this.getEnabledChannels();
    if (this.startupInfo.channels.length > 0) {
      log.info('通道已启用', { channels: this.startupInfo.channels });
    }

    // 添加提示信息
    if (memoryConfig.enabled) {
      this.startupInfo.infoMessages.push(`记忆系统已启用 (${getSearchModeDescription(this.settings as any)})`);
    }

    // 检查配置警告
    this.checkConfigWarnings();
  }

  /**
   * 检查配置警告
   */
  private checkConfigWarnings(): void {
    const providers = getProviderConfigs(this.settings as any);
    
    if (!this.settings.agents?.models?.chat && providers.length === 0) {
      this.startupInfo.warningMessages.push('未配置对话模型');
    }

    if (providers.length === 0) {
      this.startupInfo.warningMessages.push('未配置 Provider');
    }

    if (this.startupInfo.channels.length === 0) {
      this.startupInfo.warningMessages.push('未启用消息通道');
    }
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
      log.warn('配置加载失败', { error: error instanceof Error ? error.message : String(error) });
      return { channels: {} };
    }
  }

  /**
   * 注册通道
   */
  private async registerChannels(): Promise<void> {
    // 飞书通道
    if (this.settings.channels?.feishu?.enabled) {
      const feishuConfig = this.settings.channels.feishu;
      
      if (!feishuConfig.appId || !feishuConfig.appSecret) {
        this.startupInfo.warningMessages.push('飞书配置不完整');
        return;
      }

      try {
        const feishu = new FeishuWrapper({
          appId: feishuConfig.appId,
          appSecret: feishuConfig.appSecret,
          encryptKey: feishuConfig.encryptKey,
          verificationToken: feishuConfig.verificationToken,
        });

        this.router!.registerChannel(feishu);
        log.info('飞书通道已注册');
      } catch (error) {
        this.startupInfo.warningMessages.push(`飞书通道注册失败: ${(error as Error).message}`);
      }
    }
  }

  /**
   * 获取已启用的通道列表
   */
  private getEnabledChannels(): string[] {
    const channels: string[] = [];

    if (this.settings.channels?.feishu?.enabled) {
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
    const status: { type: string; connected: boolean }[] = [];

    if (this.settings.channels?.feishu?.enabled) {
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
      storagePath?: string;
      searchLimit?: number;
      autoSummarize?: boolean;
      summarizeThreshold?: number;
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
