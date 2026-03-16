/**
 * Agent 构建器
 *
 * 负责组装 Agent 运行所需的全部组件：
 * - Provider（从配置加载）
 * - Tools（注册内置工具）
 * - Skills（从文件系统加载）
 * - Memory（配置记忆管理）
 * - Session（会话管理）
 */

import { mkdir, exists, copyFile } from "node:fs/promises";

const MODULE_NAME = "AgentBuilder";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentLoop,
  SessionManager,
  ToolRegistry,
  SkillRegistry,
  type IProviderExtended,
  type AgentConfig,
  type AgentEventHandler,
} from "../../runtime/index.js";
import { loadSettings, type Settings } from "../config/index.js";
import { createOpenAIProvider } from "../providers/openai.js";
import { createOpenAIResponseProvider } from "../providers/openai-response.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createOllamaProvider } from "../providers/ollama.js";
import { toolFactories } from "../tools/index.js";
import { mcpManager } from "../tools/mcp/index.js";
import { FilesystemSkillLoader } from "../skills/index.js";
import {
  MICRO_AGENT_DIR,
  WORKSPACE_DIR,
  SESSIONS_DIR,
  LOGS_DIR,
  HISTORY_DIR,
  SKILLS_DIR,
  SETTINGS_FILE,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TIMEOUT_MS,
} from "../shared/constants.js";
import {
  builderLogger,
  createTimer,
  sanitize,
  logMethodCall,
  logMethodReturn,
  logMethodError,
} from "../shared/logger.js";

// ============================================================================
// 常量定义
// ============================================================================

/** 模板目录路径 */
const TEMPLATES_DIR = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "templates"
);

/** 模板文件列表（全部复制到根目录） */
const TEMPLATE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "mcp.json",
  { src: "settings.example.yaml", dest: "settings.yaml" },
];

// ============================================================================
// 构建结果类型
// ============================================================================

/**
 * Agent 构建结果
 */
export interface AgentBuildResult {
  /** Agent 循环实例 */
  agent: AgentLoop;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 工具注册表 */
  tools: ToolRegistry;
  /** 技能注册表 */
  skills: SkillRegistry;
  /** 加载的配置 */
  settings: Settings;
  /** 运行时目录路径 */
  paths: {
    root: string;
    workspace: string;
    sessions: string;
    logs: string;
    history: string;
    skills: string;
  };
}

// ============================================================================
// AgentBuilder 类
// ============================================================================

/**
 * Agent 构建器
 *
 * 提供流式 API 组装 Agent 组件
 */
export class AgentBuilder {
  /** 配置对象 */
  private settings: Settings | null = null;

  /** 配置文件路径 */
  private configPath: string | null = null;

  /** 自定义 Provider */
  private customProvider: IProviderExtended | null = null;

  /** 工具注册表 */
  private tools = new ToolRegistry();

  /** 技能注册表 */
  private skills = new SkillRegistry();

  /** 自定义工具名称列表 */
  private customToolNames: string[] = [];

  /** Agent 配置 */
  private agentConfig: Partial<AgentConfig> = {};

  /** 事件处理器 */
  private eventHandlers: AgentEventHandler[] = [];

  /** 是否已初始化目录 */
  private dirInitialized = false;

  // ============================================================================
  // 配置方法
  // ============================================================================

  /**
   * 指定配置文件路径
   * @param path - 配置文件路径
   * @returns 构建器实例
   */
  withConfigPath(path: string): this {
    this.configPath = path;
    return this;
  }

  /**
   * 直接设置配置对象
   * @param settings - 配置对象
   * @returns 构建器实例
   */
  withSettings(settings: Settings): this {
    this.settings = settings;
    return this;
  }

  /**
   * 设置自定义 Provider
   * @param provider - Provider 实例
   * @returns 构建器实例
   */
  withProvider(provider: IProviderExtended): this {
    this.customProvider = provider;
    return this;
  }

  /**
   * 添加工具
   * @param names - 工具名称列表
   * @returns 构建器实例
   */
  withTools(names: string[]): this {
    this.customToolNames = names;
    return this;
  }

  /**
   * 设置 Agent 配置
   * @param config - Agent 配置
   * @returns 构建器实例
   */
  withAgentConfig(config: Partial<AgentConfig>): this {
    this.agentConfig = { ...this.agentConfig, ...config };
    return this;
  }

  /**
   * 添加事件处理器
   * @param handler - 事件处理器
   * @returns 构建器实例
   */
  withEventHandler(handler: AgentEventHandler): this {
    this.eventHandlers.push(handler);
    return this;
  }

  // ============================================================================
  // 构建方法
  // ============================================================================

  /**
   * 构建 Agent
   * @returns 构建结果
   */
  async build(): Promise<AgentBuildResult> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "build", module: MODULE_NAME });

    try {
      // 1. 初始化运行时目录
      logger.info("Agent构建", { step: "ensureDirectories" });
      await this.ensureDirectories();

      // 2. 加载配置
      logger.info("Agent构建", { step: "loadSettings" });
      const settings = await this.loadSettings();

      // 3. 创建 Provider
      logger.info("Agent构建", { step: "createProvider" });
      const provider = await this.createProvider(settings);

      // 4. 注册工具
      logger.info("Agent构建", { step: "registerTools" });
      await this.registerTools(settings);

      // 5. 加载技能
      logger.info("Agent构建", { step: "loadSkills" });
      await this.loadSkills();

      // 6. 创建 Agent 配置
      const agentConfig = this.createAgentConfig(settings);

      // 7. 创建 Agent 实例
      logger.info("Agent构建", { step: "createAgentInstance", model: agentConfig.model });
      const agent = new AgentLoop(provider, this.tools, agentConfig);

      // 8. 注册事件处理器
      for (const handler of this.eventHandlers) {
        agent.on(handler);
      }

      // 9. 创建会话管理器
      const sessionManager = new SessionManager();

      const result = {
        agent,
        sessionManager,
        tools: this.tools,
        skills: this.skills,
        settings,
        paths: {
          root: MICRO_AGENT_DIR,
          workspace: WORKSPACE_DIR,
          sessions: SESSIONS_DIR,
          logs: LOGS_DIR,
          history: HISTORY_DIR,
          skills: SKILLS_DIR,
        },
      };

      logMethodReturn(logger, {
        method: "build",
        module: MODULE_NAME,
        result: { toolsCount: this.tools.list().length, skillsCount: this.skills.list().length },
        duration: timer(),
      });

      return result;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "build",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  // ============================================================================
  // 私有方法 - 目录初始化
  // ============================================================================

  /**
   * 确保运行时目录存在
   */
  private async ensureDirectories(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "ensureDirectories", module: MODULE_NAME });

    try {
      if (this.dirInitialized) {
        logMethodReturn(logger, { method: "ensureDirectories", module: MODULE_NAME, result: { skipped: true }, duration: timer() });
        return;
      }

      // 创建主目录
      logger.debug("创建目录", { dir: MICRO_AGENT_DIR });
      await this.ensureDir(MICRO_AGENT_DIR);
      await this.ensureDir(WORKSPACE_DIR);
      await this.ensureDir(SESSIONS_DIR);
      await this.ensureDir(LOGS_DIR);
      await this.ensureDir(HISTORY_DIR);
      await this.ensureDir(SKILLS_DIR);

      // 复制模板文件
      await this.copyTemplates();

      this.dirInitialized = true;

      logMethodReturn(logger, { method: "ensureDirectories", module: MODULE_NAME, result: { initialized: true }, duration: timer() });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "ensureDirectories",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 确保目录存在
   * @param dir - 目录路径
   */
  private async ensureDir(dir: string): Promise<void> {
    const logger = builderLogger();
    try {
      const isExists = await this.pathExists(dir);
      if (!isExists) {
        await mkdir(dir, { recursive: true });
        logger.debug("目录创建成功", { dir });
      }
    } catch (error) {
      logger.debug("目录操作异常", { dir, error: String(error) });
      throw error;
    }
  }

  /**
   * 检查路径是否存在
   * @param path - 路径
   * @returns 是否存在
   */
  private async pathExists(path: string): Promise<boolean> {
    const logger = builderLogger();
    try {
      await exists(path);
      return true;
    } catch (error) {
      logger.debug("路径检查异常", { path, error: String(error) });
      return false;
    }
  }

  /**
   * 复制模板文件
   * 仅在目标文件不存在时复制
   */
  private async copyTemplates(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "copyTemplates", module: MODULE_NAME });

    let copiedCount = 0;
    let skippedCount = 0;

    // 复制模板文件到根目录
    for (const item of TEMPLATE_FILES) {
      // 处理两种格式：字符串或对象
      const srcFile = typeof item === "string" ? item : item.src;
      const destFile = typeof item === "string" ? item : item.dest;

      const srcPath = join(TEMPLATES_DIR, srcFile);
      const destPath = join(MICRO_AGENT_DIR, destFile);

      try {
        // 检查目标文件是否存在
        const destExists = await this.pathExists(destPath);
        if (destExists) {
          skippedCount++;
          continue;
        }

        // 检查源文件是否存在
        const srcExists = await this.pathExists(srcPath);
        if (!srcExists) {
          continue;
        }

        // 复制文件
        await copyFile(srcPath, destPath);
        copiedCount++;
        logger.debug("复制模板文件", { file: srcFile, destPath });
      } catch (error) {
        // 复制失败不影响启动
        logger.warn("模板复制失败", { file: srcFile, error: String(error) });
      }
    }

    logMethodReturn(logger, {
      method: "copyTemplates",
      module: MODULE_NAME,
      result: { copiedCount, skippedCount },
      duration: timer(),
    });
  }

  // ============================================================================
  // 私有方法 - 配置加载
  // ============================================================================

  /**
   * 加载配置
   * @returns 配置对象
   */
  private async loadSettings(): Promise<Settings> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "loadSettings", module: MODULE_NAME, params: { configPath: this.configPath } });

    try {
      // 已设置配置对象
      if (this.settings) {
        logMethodReturn(logger, { method: "loadSettings", module: MODULE_NAME, result: { source: "cached" }, duration: timer() });
        return this.settings;
      }

      // 从文件加载
      const configPath = this.configPath ?? SETTINGS_FILE;
      logger.debug("加载配置文件", { configPath });
      this.settings = await loadSettings(configPath);

      logMethodReturn(logger, { method: "loadSettings", module: MODULE_NAME, result: { source: "file", configPath }, duration: timer() });
      return this.settings;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "loadSettings",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        params: { configPath: this.configPath },
        duration: timer(),
      });
      throw error;
    }
  }

  // ============================================================================
  // 私有方法 - Provider 创建
  // ============================================================================

  /**
   * 创建 Provider 实例
   * @param settings - 配置对象
   * @returns Provider 实例
   */
  private async createProvider(settings: Settings): Promise<IProviderExtended> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "createProvider", module: MODULE_NAME });

    try {
      // 使用自定义 Provider
      if (this.customProvider) {
        logger.debug("使用自定义 Provider", { hasCustomProvider: true });
        logMethodReturn(logger, { method: "createProvider", module: MODULE_NAME, result: { type: "custom" }, duration: timer() });
        return this.customProvider;
      }

      const providers = settings.providers ?? {};
      const model = settings.agents?.defaults?.model ?? "";

      // 解析模型名中的 provider 前缀
      const slashIndex = model.indexOf("/");
      let targetProviderName: string | null = null;

      if (slashIndex >= 0) {
        targetProviderName = model.substring(0, slashIndex);
      }

      // 根据 provider 前缀或默认选择 Provider
      let selectedProvider: [string, typeof providers[string]] | null = null;

      if (targetProviderName) {
        // 模型名包含 provider 前缀，直接查找该 provider
        const config = providers[targetProviderName];
        if (!config) {
          throw new Error(`模型 "${model}" 的 provider "${targetProviderName}" 不存在于 providers 配置中`);
        }
        if (!config.enabled) {
          throw new Error(`模型 "${model}" 的 provider "${targetProviderName}" 未启用，请设置 providers.${targetProviderName}.enabled: true`);
        }
        selectedProvider = [targetProviderName, config];
      } else {
        // 模型名不含 provider 前缀，选择第一个启用的 provider
        const enabledProvider = Object.entries(providers).find(
          ([_, config]) => config?.enabled === true
        );
        if (!enabledProvider) {
          throw new Error("未找到已启用的 Provider 配置");
        }
        selectedProvider = enabledProvider;
      }

      const [providerName, providerConfig] = selectedProvider;

      if (!providerConfig) {
        throw new Error(`Provider "${providerName}" 配置不存在`);
      }

      // 验证必填字段
      if (!providerConfig.baseUrl) {
        throw new Error(`Provider "${providerName}" 缺少 baseUrl 配置`);
      }
      if (!providerConfig.models || providerConfig.models.length === 0) {
        throw new Error(`Provider "${providerName}" 缺少 models 配置`);
      }

      logger.debug("创建 Provider", { providerName, type: providerConfig.type });

      // 根据 type 字段创建对应的 Provider
      let provider: IProviderExtended;
      switch (providerConfig.type) {
        case "openai":
          provider = createOpenAIProvider({
            name: providerName,
            displayName: providerName,
            baseUrl: providerConfig.baseUrl,
            ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
            models: providerConfig.models,
          });
          break;

        case "openai-response":
          provider = createOpenAIResponseProvider({
            name: providerName,
            displayName: providerName,
            baseUrl: providerConfig.baseUrl,
            ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
            models: providerConfig.models,
          });
          break;

        case "anthropic":
          provider = createAnthropicProvider({
            name: providerName,
            displayName: providerName,
            baseUrl: providerConfig.baseUrl,
            ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
            models: providerConfig.models,
          });
          break;

        case "ollama":
          provider = createOllamaProvider({
            baseUrl: providerConfig.baseUrl,
            models: providerConfig.models,
          });
          break;

        default:
          throw new Error(`未知的 Provider 类型: ${providerConfig.type}`);
      }

      logMethodReturn(logger, {
        method: "createProvider",
        module: MODULE_NAME,
        result: { providerName, type: providerConfig.type, modelsCount: providerConfig.models.length },
        duration: timer(),
      });

      return provider;
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "createProvider",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  // ============================================================================
  // 私有方法 - 工具注册
  // ============================================================================

  /**
   * 注册工具
   * @param settings - 配置对象
   */
  private async registerTools(settings: Settings): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "registerTools", module: MODULE_NAME });

    try {
      // 确定要注册的工具
      let toolNames = this.customToolNames;

      // 如果没有指定，使用配置中的工具列表或全部工具
      if (toolNames.length === 0) {
        const allToolNames = Object.keys(toolFactories);

        if (settings.tools) {
          const { enabled, disabled } = settings.tools;

          // 如果启用了特定工具，只注册这些工具
          if (enabled && enabled.length > 0) {
            toolNames = enabled.filter(
              (name) => allToolNames.includes(name) && !disabled.includes(name)
            );
          } else {
            // 否则注册所有工具，除了被禁用的
            toolNames = allToolNames.filter((name) => !disabled.includes(name));
          }
        } else {
          toolNames = allToolNames;
        }
      }

      logger.debug("注册工具", { toolNames, count: toolNames.length });

      // 注册工具
      for (const name of toolNames) {
        const factory = toolFactories[name];
        if (factory) {
          const tool = factory();
          if (tool) {
            this.tools.register(tool);
          }
        }
      }

      // 加载 MCP 工具
      await this.loadMCPTools();

      logMethodReturn(logger, {
        method: "registerTools",
        module: MODULE_NAME,
        result: { toolsCount: this.tools.list().length },
        duration: timer(),
      });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "registerTools",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        duration: timer(),
      });
      throw error;
    }
  }

  /**
   * 加载 MCP 工具
   */
  private async loadMCPTools(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "loadMCPTools", module: MODULE_NAME });

    try {
      // 加载 MCP 配置
      const config = await mcpManager.loadConfig();

      if (Object.keys(config.mcpServers).length === 0) {
        logMethodReturn(logger, { method: "loadMCPTools", module: MODULE_NAME, result: { serversCount: 0 }, duration: timer() });
        return;
      }

      logger.debug("加载 MCP 配置", { serversCount: Object.keys(config.mcpServers).length });

      // 连接所有启用的服务器并注册工具
      const results = await mcpManager.connectAll((tool, _serverName) => {
        this.tools.register(tool);
      });

      // 统计连接结果
      const connected = results.filter((r) => r.status === "connected").length;
      const errors = results.filter((r) => r.status === "error").length;
      const disconnected = results.filter((r) => r.status === "disconnected").length;

      logger.info("MCP 连接结果", { connected, errors, disconnected });

      logMethodReturn(logger, {
        method: "loadMCPTools",
        module: MODULE_NAME,
        result: { connected, errors, disconnected },
        duration: timer(),
      });
    } catch (err) {
      const error = err as Error;
      logger.warn("MCP 加载失败", { error: error.message });
      logMethodReturn(logger, { method: "loadMCPTools", module: MODULE_NAME, result: { error: error.message }, duration: timer() });
    }
  }

  // ============================================================================
  // 私有方法 - 技能加载
  // ============================================================================

  /**
   * 加载技能
   */
  private async loadSkills(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "loadSkills", module: MODULE_NAME, params: { skillsDir: SKILLS_DIR } });

    try {
      const loader = new FilesystemSkillLoader(SKILLS_DIR);
      const skills = await loader.listSkills();

      logger.debug("加载技能", { skillsDir: SKILLS_DIR, count: skills.length });

      for (const skill of skills) {
        this.skills.register(skill);
      }

      logMethodReturn(logger, {
        method: "loadSkills",
        module: MODULE_NAME,
        result: { skillsCount: skills.length },
        duration: timer(),
      });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "loadSkills",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        params: { skillsDir: SKILLS_DIR },
        duration: timer(),
      });
      throw error;
    }
  }

  // ============================================================================
  // 私有方法 - Agent 配置
  // ============================================================================

  /**
   * 创建 Agent 配置
   * @param settings - 配置对象
   * @returns Agent 配置
   */
  private createAgentConfig(settings: Settings): AgentConfig {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "createAgentConfig", module: MODULE_NAME });

    const agentDefaults = settings.agents.defaults;

    // 处理模型名：剥离 provider 前缀
    let model = this.agentConfig.model ?? agentDefaults.model ?? "default";
    const slashIndex = model.indexOf("/");
    if (slashIndex >= 0) {
      model = model.substring(slashIndex + 1);
      logger.debug("剥离模型 provider 前缀", { originalModel: this.agentConfig.model ?? agentDefaults.model, strippedModel: model });
    }

    const config: AgentConfig = {
      model,
      maxIterations: this.agentConfig.maxIterations ?? agentDefaults.maxToolIterations ?? DEFAULT_MAX_ITERATIONS,
      defaultTimeout: this.agentConfig.defaultTimeout ?? DEFAULT_TIMEOUT_MS,
      enableLogging: this.agentConfig.enableLogging ?? false,
    };

    logMethodReturn(logger, {
      method: "createAgentConfig",
      module: MODULE_NAME,
      result: sanitize(config),
      duration: timer(),
    });

    return config;
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建默认 Agent
 * @param configPath - 可选的配置文件路径
 * @returns 构建结果
 */
export async function createAgent(configPath?: string): Promise<AgentBuildResult> {
  const timer = createTimer();
  const logger = builderLogger();
  logMethodCall(logger, { method: "createAgent", module: MODULE_NAME, params: { configPath } });

  try {
    const builder = new AgentBuilder();
    if (configPath) {
      builder.withConfigPath(configPath);
    }
    const result = await builder.build();

    logMethodReturn(logger, {
      method: "createAgent",
      module: MODULE_NAME,
      result: { toolsCount: result.tools.list().length, skillsCount: result.skills.list().length },
      duration: timer(),
    });

    return result;
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "createAgent",
      module: MODULE_NAME,
      error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
      params: { configPath },
      duration: timer(),
    });
    throw error;
  }
}

/**
 * 初始化运行时目录
 * 仅创建目录结构，不构建 Agent
 */
export async function initRuntimeDirectories(): Promise<void> {
  const timer = createTimer();
  const logger = builderLogger();
  logMethodCall(logger, { method: "initRuntimeDirectories", module: MODULE_NAME });

  try {
    const builder = new AgentBuilder();
    // @ts-expect-error 访问私有方法进行初始化
    await builder.ensureDirectories();

    logMethodReturn(logger, { method: "initRuntimeDirectories", module: MODULE_NAME, result: { success: true }, duration: timer() });
  } catch (err) {
    const error = err as Error;
    logMethodError(logger, {
      method: "initRuntimeDirectories",
      module: MODULE_NAME,
      error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
      duration: timer(),
    });
    throw error;
  }
}
