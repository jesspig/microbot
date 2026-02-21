/**
 * MicroBot 应用入口
 *
 * 提供 createApp() 工厂函数，组装所有模块。
 */

import {
  loadConfig,
  expandPath,
  parseModelConfigs,
  getConfigStatus,
} from '@microbot/config';
import {
  ToolRegistry,
  ChannelManager,
  SkillsLoader,
  LLMGateway,
  OpenAICompatibleProvider,
  MessageBus,
  SessionStore,
  AgentExecutor,
} from '@microbot/sdk';
import type {
  App,
  Config,
  ProviderEntry,
} from '@microbot/types';
import type { ModelConfig } from '@microbot/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';

// 扩展组件导入
import {
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
  createExecTool,
  WebFetchTool,
  MessageTool,
} from '../../../extensions/tool';
import { FeishuChannel } from '../../../extensions/channel/feishu';

/** 获取内置技能路径 */
function getBuiltinSkillsPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // 技能已迁移到 extensions/skills/
  return resolve(currentDir, '../../../extensions/skills');
}

/**
 * 应用实现
 */
class AppImpl implements App {
  private running = false;
  private channelManager: ChannelManager;
  private gateway: LLMGateway;
  /** 可用模型列表（用于自动路由） */
  private availableModels = new Map<string, ModelConfig[]>();
  private config: Config;
  private workspace: string;
  private messageBus: MessageBus;
  private sessionStore: SessionStore;
  private toolRegistry: ToolRegistry;
  private executor: AgentExecutor | null = null;
  private skillsLoader: SkillsLoader | null = null;

  constructor(config: Config, workspace: string) {
    this.config = config;
    this.workspace = workspace;
    this.channelManager = new ChannelManager();
    this.messageBus = new MessageBus();
    this.sessionStore = new SessionStore({
      sessionsDir: `${homedir()}/.microbot/sessions`,
      sessionTimeout: 30 * 60 * 1000,
    });
    this.toolRegistry = new ToolRegistry();

    // 从模型配置解析 provider：格式为 "provider/model"
    const chatModel = config.agents.models?.chat || '';
    const slashIndex = chatModel.indexOf('/');
    const defaultProvider = slashIndex > 0
      ? chatModel.slice(0, slashIndex)
      : Object.keys(config.providers)[0] || '';
    this.gateway = new LLMGateway({ defaultProvider, fallbackEnabled: true });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 1. 注册内置工具
    this.registerBuiltinTools();

    // 2. 初始化 Provider Gateway
    this.initProviders();

    // 3. 初始化技能加载器
    this.skillsLoader = new SkillsLoader(this.workspace, getBuiltinSkillsPath());
    this.skillsLoader.load();
    if (this.skillsLoader.count > 0) {
      const skillNames = this.skillsLoader.getAll().map(s => s.name).join(', ');
      console.log(`  已加载 ${this.skillsLoader.count} 个技能: ${skillNames}`);
    } else {
      console.log('  未找到任何技能');
    }

    // 4. 初始化通道
    this.initChannels();

    // 5. 启动通道
    await this.channelManager.startAll();

    // 6. 启动出站消息消费者
    this.startOutboundConsumer();

    // 7. 创建并启动 Agent 执行器
    this.executor = new AgentExecutor(
      this.messageBus,
      this.gateway,
      this.toolRegistry,
      {
        workspace: this.workspace,
        maxIterations: this.config.agents.maxToolIterations ?? 20,
        maxTokens: this.config.agents.maxTokens ?? 8192,
        temperature: this.config.agents.temperature ?? 0.7,
        systemPrompt: this.loadSystemPrompt(),
        // 路由配置
        auto: this.config.agents.auto ?? false,
        max: this.config.agents.max ?? false,
        chatModel: this.config.agents.models?.chat,
        checkModel: this.config.agents.models?.check,
        availableModels: this.availableModels,
        routing: this.config.routing,
      }
    );
    
    // 在后台运行执行器
    this.executor.run().catch(error => {
      console.error('执行器异常:', error instanceof Error ? error.message : String(error));
    });
  }

  private loadSystemPrompt(): string {
    // 尝试加载 workspace 下的 SOUL.md 或 USER.md
    const soulPath = resolve(this.workspace, 'SOUL.md');
    const userPath = resolve(this.workspace, 'USER.md');
    
    let basePrompt = '你是一个有帮助的 AI 助手。';
    
    if (existsSync(soulPath)) {
      basePrompt = readFileSync(soulPath, 'utf-8');
    } else if (existsSync(userPath)) {
      basePrompt = readFileSync(userPath, 'utf-8');
    }
    
    // 构建技能部分（模仿 nanobot 的方式）
    const parts: string[] = [];
    
    // 1. Always 技能：自动加载完整内容
    if (this.skillsLoader && this.skillsLoader.count > 0) {
      const alwaysSkills = this.skillsLoader.getAlwaysSkills();
      if (alwaysSkills.length > 0) {
        const alwaysContent = alwaysSkills.map(skill => {
          const content = skill.content.replace(/<skill-dir>/g, skill.skillPath);
          return `### ${skill.name}\n${skill.description}\n\n**目录:** ${skill.skillPath}\n\n${content}`;
        }).join('\n\n---\n\n');
        parts.push(`# 自动加载技能\n\n以下技能已自动加载到上下文中，无需读取文件：\n\n${alwaysContent}`);
      }
    }
    
    // 2. 可用技能：XML 摘要 + 明确引导
    if (this.skillsLoader && this.skillsLoader.count > 0) {
      const skillsSummary = this.skillsLoader.buildSkillsSummary();
      parts.push(`# 技能

以下技能可以扩展你的能力。要使用某个技能，先用 \`read_file\` 工具读取其 SKILL.md 文件了解详细用法，然后执行相应命令。

${skillsSummary}`);
    }
    
    if (parts.length > 0) {
      return basePrompt + '\n\n---\n\n' + parts.join('\n\n---\n\n');
    }
    
    return basePrompt;
  }

  private registerBuiltinTools(): void {
    this.toolRegistry.register(ReadFileTool);
    this.toolRegistry.register(WriteFileTool);
    this.toolRegistry.register(ListDirTool);
    this.toolRegistry.register(createExecTool(this.workspace));
    this.toolRegistry.register(WebFetchTool);
    this.toolRegistry.register(MessageTool);
    console.log(`  已注册 ${this.toolRegistry.getDefinitions().length} 个工具: ${this.toolRegistry.getDefinitions().map(t => t.name).join(', ')}`);
  }

  private startOutboundConsumer(): void {
    (async () => {
      while (this.running) {
        try {
          const msg = await this.messageBus.consumeOutbound();
          await this.channelManager.send(msg);
        } catch (error) {
          console.error('发送消息失败:', error instanceof Error ? error.message : String(error));
        }
      }
    })().catch(error => {
      console.error('出站消费者异常:', error instanceof Error ? error.message : String(error));
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // 停止执行器
    if (this.executor) {
      this.executor.stop();
    }

    await this.channelManager.stopAll();
  }

  getRunningChannels(): string[] {
    return this.channelManager.getRunningChannels();
  }

  getProviderStatus(): string {
    if (!this.config.agents.models?.chat && Object.keys(this.config.providers).length === 0) {
      return '未配置';
    }
    return this.gateway.getDefaultModel();
  }

  getRouterStatus(): { auto: boolean; max: boolean; chatModel: string; checkModel?: string } {
    return {
      auto: this.config.agents.auto ?? false,
      max: this.config.agents.max ?? false,
      chatModel: this.config.agents.models?.chat || '未配置',
      checkModel: this.config.agents.models?.check,
    };
  }

  private initProviders(): void {
    const providers = this.config.providers as Record<string, ProviderEntry | undefined>;
    const chatModel = this.config.agents.models?.chat || '';

    // 从模型配置解析默认 provider
    const slashIndex = chatModel.indexOf('/');
    const defaultProviderName = slashIndex > 0 ? chatModel.slice(0, slashIndex) : null;
    const defaultModelId = slashIndex > 0 ? chatModel.slice(slashIndex + 1) : chatModel;

    for (const [name, config] of Object.entries(providers)) {
      if (!config) continue;

      // 解析模型配置（支持字符串简写和完整对象）
      const modelConfigs = config.models ? parseModelConfigs(config.models) : [];
      const modelIds = modelConfigs.map(m => m.id);

      // 存储模型配置用于自动路由
      if (modelConfigs.length > 0) {
        this.availableModels.set(name, modelConfigs);
      }

      const provider = new OpenAICompatibleProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        defaultModel: modelConfigs[0]?.id ?? defaultModelId,
        modelConfigs,
      });

      // 默认 provider 优先级为 1，其他为 100
      const priority = name === defaultProviderName ? 1 : 100;
      this.gateway.registerProvider(name, provider, modelIds.length > 0 ? modelIds : ['*'], priority, modelConfigs);
    }
  }

  private initChannels(): void {
    const channels = this.config.channels;

    if (channels.feishu?.enabled && channels.feishu.appId && channels.feishu.appSecret) {
      const channel = new FeishuChannel(this.messageBus, {
        appId: channels.feishu.appId,
        appSecret: channels.feishu.appSecret,
        allowFrom: channels.feishu.allowFrom ?? [],
      });
      this.channelManager.register(channel);
    }
  }
}

export async function createApp(configPath?: string): Promise<App> {
  const baseConfig = loadConfig(configPath ? { configPath } : {});
  const workspace = expandPath(baseConfig.agents.workspace);

  // 确保 workspace 目录存在
  const { mkdirSync, existsSync } = await import('fs');
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  const config = loadConfig({ workspace });

  return new AppImpl(config, workspace);
}

// 导出类型
export type { App } from '@microbot/types';
