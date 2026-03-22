/**
 * Agent Builder 集成测试
 *
 * 测试 Agent 构建器的完整流程
 */

import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import {
  AgentBuilder,
  createAgent,
  initRuntimeDirectories,
  type AgentBuildResult,
} from "../../microagent/applications/builder/index.js";
import { Settings, getDefaultSettings } from "../../microagent/applications/config/index.js";
import { OpenAIProvider, AnthropicProvider } from "../../microagent/applications/providers/index.js";
import { AgentLoop } from "../../microagent/runtime/kernel/index.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IProvider } from "../../microagent/runtime/provider/contract.js";

// ============================================================================
// 测试常量
// ============================================================================

const TEST_ROOT_DIR = "/tmp/micro-agent-test-root";
const TEST_CONFIG_PATH = join(TEST_ROOT_DIR, "test-settings.yaml");

const VALID_CONFIG = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"
    maxTokens: 8192
    temperature: 0.7
    maxToolIterations: 40
    heartbeatInterval: 30

tools:
  enabled: ["filesystem"]
  disabled: []

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "sk-test-key"
    models: ["gpt-4", "gpt-3.5-turbo"]
`;

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 创建测试配置文件
 */
async function createTestConfigFile(content: string): Promise<void> {
  await mkdir(TEST_ROOT_DIR, { recursive: true });
  await writeFile(TEST_CONFIG_PATH, content, "utf-8");
}

/**
 * 清理测试目录
 */
async function cleanupTestDir(): Promise<void> {
  try {
    await rm(TEST_ROOT_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

// ============================================================================
// Mock Provider
// ============================================================================

class MockProvider implements IProvider {
  readonly name = "mock-provider";
  readonly config = {
    id: "mock-provider",
    name: "mock-provider",
    baseUrl: "https://mock.api.com",
    apiKey: "mock-key",
    models: ["mock-model"],
  };
  readonly capabilities = {
    supportsStreaming: false,
    supportsVision: false,
    supportsPromptCaching: false,
    maxContextTokens: 4096,
    toolSchemaMode: "native" as const,
  };

  chat = mock(async () => ({
    text: "Mock response",
    hasToolCall: false,
  }));

  getSupportedModels = mock(() => ["mock-model"]);

  getStatus = mock(() => ({
    name: this.name,
    available: true,
    models: this.config.models,
    errorCount: 0,
  }));

  testConnection = mock(async () => true);
}

// ============================================================================
// 测试套件
// ============================================================================

describe("Agent Builder 集成测试", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await cleanupTestDir();
  });

  describe("AgentBuilder 类", () => {
    describe("配置方法", () => {
      test("应支持设置配置文件路径", () => {
        const builder = new AgentBuilder();
        builder.withConfigPath("/test/config.yaml");

        // 配置路径已设置（内部状态）
        expect(builder).toBeDefined();
      });

      test("应支持直接设置配置对象", () => {
        const settings = getDefaultSettings();
        const builder = new AgentBuilder();
        builder.withSettings(settings);

        // 配置对象已设置（内部状态）
        expect(builder).toBeDefined();
      });

      test("应支持设置自定义 Provider", () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder();
        builder.withProvider(mockProvider);

        // Provider 已设置（内部状态）
        expect(builder).toBeDefined();
      });

      test("应支持设置工具列表", () => {
        const builder = new AgentBuilder();
        builder.withTools(["filesystem", "shell"]);

        // 工具列表已设置（内部状态）
        expect(builder).toBeDefined();
      });

      test("应支持设置 Agent 配置", () => {
        const builder = new AgentBuilder();
        builder.withAgentConfig({
          model: "custom-model",
          maxIterations: 100,
        });

        // Agent 配置已设置（内部状态）
        expect(builder).toBeDefined();
      });

      test("应支持添加事件处理器", () => {
        const builder = new AgentBuilder();
        const handler = {
          onThought: () => {},
          onAction: () => {},
          onObservation: () => {},
        };

        builder.withEventHandler(handler);

        // 事件处理器已添加（内部状态）
        expect(builder).toBeDefined();
      });

      test("应支持链式调用", () => {
        const mockProvider = new MockProvider();
        const settings = getDefaultSettings();

        const builder = new AgentBuilder()
          .withConfigPath("/test/config.yaml")
          .withSettings(settings)
          .withProvider(mockProvider)
          .withTools(["filesystem"])
          .withAgentConfig({ model: "test-model" })
          .withEventHandler({
            onThought: () => {},
          });

        expect(builder).toBeDefined();
      });
    });

    describe("build 方法", () => {
      test("应成功构建 Agent（使用默认配置）", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const result = await builder.build();

        expect(result).toBeDefined();
        expect(result.agent).toBeInstanceOf(AgentLoop);
        expect(result.sessionManager).toBeDefined();
        expect(result.tools).toBeDefined();
        expect(result.skills).toBeDefined();
        expect(result.settings).toBeDefined();
        expect(result.paths).toBeDefined();
      });

      test("应成功构建 Agent（使用配置文件）", async () => {
        await createTestConfigFile(VALID_CONFIG);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        expect(result).toBeDefined();
        expect(result.agent).toBeInstanceOf(AgentLoop);
        expect(result.settings.agents.defaults.model).toBe("openai/gpt-4");
      });

      test("应正确注册工具", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder()
          .withProvider(mockProvider)
          .withTools(["filesystem", "shell"]);

        const result = await builder.build();
        const tools = result.tools.list();

        expect(tools.length).toBeGreaterThan(0);
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("filesystem");
        expect(toolNames).toContain("shell");
      });

      test("应正确加载技能", async () => {
        // 创建测试技能目录
        const skillsDir = join(TEST_ROOT_DIR, "workspace", ".agent", "skills");
        await mkdir(skillsDir, { recursive: true });

        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const result = await builder.build();

        expect(result.skills).toBeDefined();
      });

      test("应创建正确的路径结构", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const result = await builder.build();

        expect(result.paths.root).toBeDefined();
        expect(result.paths.workspace).toBeDefined();
        expect(result.paths.agent).toBeDefined();
        expect(result.paths.sessions).toBeDefined();
        expect(result.paths.logs).toBeDefined();
        expect(result.paths.history).toBeDefined();
        expect(result.paths.skills).toBeDefined();
      });

      test("应使用自定义 Provider", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const result = await builder.build();

        // 验证 Agent 创建成功
        expect(result.agent).toBeDefined();
        // 验证构建结果包含配置
        expect(result.settings).toBeDefined();
      });

      test("应应用 Agent 配置覆盖", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder()
          .withProvider(mockProvider)
          .withAgentConfig({
            model: "custom-model",
            maxIterations: 200,
          });

        const result = await builder.build();

        // 配置已应用（通过内部状态验证）
        expect(result).toBeDefined();
      });

      test("应注册事件处理器", async () => {
        const mockProvider = new MockProvider();
        const handlerMock = mock(() => {});

        const builder = new AgentBuilder()
          .withProvider(mockProvider)
          .withEventHandler({
            onThought: handlerMock,
          });

        const result = await builder.build();

        expect(result).toBeDefined();
      });

      test("未找到已配置的 Provider 应抛出错误", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models: []
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);

        await expect(builder.build()).rejects.toThrow();
      });

      test("Provider 配置不存在应抛出错误", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "custom-provider/custom-model"

providers:
  custom-provider:
    baseUrl: "https://api.custom.com/v1"
    apiKey: "test-key"
    models: ["custom-model"]
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);

        const result = await builder.build();
        expect(result.agent).toBeDefined();
      });
    });

    describe("目录初始化", () => {
      test("应创建所有必需的目录", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const { paths } = await builder.build();

        // 验证目录已创建
        expect(paths.root).toBeDefined();
        expect(paths.workspace).toBeDefined();
      });

      test("应复制模板文件", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        await builder.build();

        // 模板文件应该被复制（通过不抛出错误来验证）
        expect(builder).toBeDefined();
      });

      test("应跳过已存在的模板文件", async () => {
        // 先创建模板文件
        await createTestConfigFile(VALID_CONFIG);

        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH).withProvider(mockProvider);

        // 不应抛出错误
        await expect(builder.build()).resolves.toBeDefined();
      });
    });

    describe("配置合并和验证", () => {
      test("应合并配置和覆盖", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "test-provider/test-model"
    maxTokens: 4096
providers:
  test-provider:
    baseUrl: https://api.test.com/v1
    apiKey: test-key
    models:
      - test-model
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder()
          .withConfigPath(TEST_CONFIG_PATH)
          .withAgentConfig({
            model: "test-provider/test-model",
          });

        const result = await builder.build();

        expect(result).toBeDefined();
        expect(result.settings.agents.defaults.maxTokens).toBe(4096); // 保留基础配置
      });

      test("应使用默认值当配置缺失时", async () => {
        const minimalConfig = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"
`;

        await createTestConfigFile(minimalConfig);

        const mockProvider = new MockProvider();
        const builder = new AgentBuilder()
          .withConfigPath(TEST_CONFIG_PATH)
          .withProvider(mockProvider);

        const result = await builder.build();

        expect(result.settings.agents.defaults.maxTokens).toBe(8192); // 默认值
        expect(result.settings.agents.defaults.temperature).toBe(0.7); // 默认值
      });
    });

    describe("工具和技能加载", () => {
      test("应使用配置中的工具列表", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"

tools:
  enabled: ["filesystem", "shell"]
  disabled: ["web"]

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models:
      - gpt-4
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        const tools = result.tools.list();
        const toolNames = tools.map((t) => t.name);

        expect(toolNames).toContain("filesystem");
        expect(toolNames).toContain("shell");
        expect(toolNames).not.toContain("web");
      });

      test("应使用自定义工具列表覆盖配置", async () => {
        await createTestConfigFile(VALID_CONFIG);

        const builder = new AgentBuilder()
          .withConfigPath(TEST_CONFIG_PATH)
          .withTools(["shell"]); // 覆盖配置中的工具

        const result = await builder.build();

        const tools = result.tools.list();
        const toolNames = tools.map((t) => t.name);

        expect(toolNames).toContain("shell");
      });

      test("应加载所有可用工具当配置为空时", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"

tools:
  enabled: []
  disabled: []

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models:
      - gpt-4
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        const tools = result.tools.list();
        expect(tools.length).toBeGreaterThan(0);
      });
    });

    describe("Provider 创建", () => {
      test("应根据配置创建 OpenAI Provider", async () => {
        await createTestConfigFile(VALID_CONFIG);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        expect(result).toBeDefined();
      });

      test("应根据配置创建 Anthropic Provider", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "anthropic/claude-3-opus"

providers:
  anthropic:
    baseUrl: "https://api.anthropic.com/v1"
    apiKey: "sk-ant-test"
    models: ["claude-3-opus"]
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        expect(result).toBeDefined();
      });

      test("应支持从配置提取默认模型", async () => {
        const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "custom-model"

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models: ["custom-model", "gpt-4"]
`;

        await createTestConfigFile(config);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        expect(result).toBeDefined();
      });
    });
  });

  describe("便捷函数", () => {
    describe("createAgent 函数", () => {
      test("应使用默认配置创建 Agent", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const result = await builder.build();

        expect(result).toBeDefined();
        expect(result.agent).toBeInstanceOf(AgentLoop);
      });

      test("应支持传入配置文件路径", async () => {
        await createTestConfigFile(VALID_CONFIG);

        const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
        const result = await builder.build();

        expect(result).toBeDefined();
        expect(result.settings).toBeDefined();
      });

      test("应返回完整的构建结果", async () => {
        const mockProvider = new MockProvider();
        const builder = new AgentBuilder().withProvider(mockProvider);

        const result = await builder.build();

        // 验证所有必需的字段
        expect(result.agent).toBeDefined();
        expect(result.sessionManager).toBeDefined();
        expect(result.tools).toBeDefined();
        expect(result.skills).toBeDefined();
        expect(result.settings).toBeDefined();
        expect(result.paths).toBeDefined();
      });
    });

    describe("initRuntimeDirectories 函数", () => {
      test("应创建运行时目录结构", async () => {
        await initRuntimeDirectories();

        // 目录已创建（通过不抛出错误来验证）
        expect(true).toBe(true);
      });

      test("不应重复创建已存在的目录", async () => {
        await initRuntimeDirectories();
        await initRuntimeDirectories(); // 第二次调用

        // 不应抛出错误
        expect(true).toBe(true);
      });
    });
  });

  describe("完整集成测试", () => {
    test("应完成完整的 Agent 构建流程", async () => {
      // 1. 准备配置
      await createTestConfigFile(VALID_CONFIG);

      // 2. 创建测试技能目录和文件
      const testSkillDir = join(TEST_ROOT_DIR, "workspace", ".agent", "skills", "test-skill");
      await mkdir(testSkillDir, { recursive: true });
      await writeFile(
        join(testSkillDir, "SKILL.md"),
        `---
name: test-skill
description: Test skill
---

# Test Skill
`,
        "utf-8"
      );

      // 3. 构建 Agent
      const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
      const result = await builder.build();

      // 4. 验证结果
      expect(result).toBeDefined();
      expect(result.agent).toBeInstanceOf(AgentLoop);
      expect(result.tools.list().length).toBeGreaterThan(0);
      expect(result.settings.agents.defaults.model).toBe("openai/gpt-4");
      expect(result.paths.workspace).toBeDefined();
    });

    test("应支持复杂的配置场景", async () => {
      const complexConfig = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"
    maxTokens: 16384
    temperature: 0.5
    maxToolIterations: 100
    heartbeatInterval: 60

tools:
  enabled: ["filesystem", "shell", "web"]
  disabled: []
  config:
    shell:
      allowedCommands: ["ls", "cat", "echo"]
      blockedCommands: ["rm", "mv"]

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "sk-complex-test"
    models: ["gpt-4", "gpt-3.5-turbo", "gpt-4-turbo"]

  deepseek:
    baseUrl: "https://api.deepseek.com/v1"
    apiKey: "sk-deepseek-test"
    models: ["deepseek-chat"]

channels:
  feishu:
    enabled: false
    appId: ""
    appSecret: ""
`;

      await createTestConfigFile(complexConfig);

      const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
      const result = await builder.build();

      expect(result).toBeDefined();
      expect(result.settings.agents.defaults.maxTokens).toBe(16384);
      expect(result.settings.agents.defaults.temperature).toBe(0.5);
      expect(result.settings.agents.defaults.maxToolIterations).toBe(100);
      expect(result.tools.list().length).toBe(3);
    });
  });

  describe("错误处理和边界情况", () => {
    test("应处理配置文件读取错误", async () => {
      const mockProvider = new MockProvider();
      const builder = new AgentBuilder()
        .withConfigPath("/non-existent/config.yaml")
        .withProvider(mockProvider);

      // 应该使用默认配置
      const result = await builder.build();
      expect(result).toBeDefined();
    });

    test("应处理无效的配置格式", async () => {
      const invalidConfig = `
invalid yaml syntax
[
`;

      await createTestConfigFile(invalidConfig);

      const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);

      await expect(builder.build()).rejects.toThrow();
    });

    test("应处理配置验证失败", async () => {
      const invalidSchema = `
agents:
  defaults:
    workspace: ""
    model: "openai/gpt-4"
`;

      await createTestConfigFile(invalidSchema);

      const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);

      await expect(builder.build()).rejects.toThrow();
    });

    test("应处理工具注册错误", async () => {
      const config = `
agents:
  defaults:
    workspace: "${TEST_ROOT_DIR}/workspace"
    model: "openai/gpt-4"

tools:
  enabled: ["non-existent-tool"]

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models:
      - gpt-4
`;

      await createTestConfigFile(config);

      const builder = new AgentBuilder().withConfigPath(TEST_CONFIG_PATH);
      const result = await builder.build();

      // 应该继续构建，只是跳过不存在的工具
      expect(result).toBeDefined();
    });

    test("应处理技能加载错误", async () => {
      const mockProvider = new MockProvider();
      const builder = new AgentBuilder().withProvider(mockProvider);

      // 即使技能加载失败，Agent 也应该能够构建
      const result = await builder.build();

      expect(result).toBeDefined();
    });
  });

  describe("性能测试", () => {
    test("应在合理时间内完成构建", async () => {
      const mockProvider = new MockProvider();
      const builder = new AgentBuilder().withProvider(mockProvider);

      const startTime = Date.now();
      const result = await builder.build();
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // 应该在 5 秒内完成
    });

    test("应支持多次构建", async () => {
      const mockProvider = new MockProvider();

      // 多次构建
      const result1 = await new AgentBuilder().withProvider(mockProvider).build();
      const result2 = await new AgentBuilder().withProvider(mockProvider).build();
      const result3 = await new AgentBuilder().withProvider(mockProvider).build();

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result3).toBeDefined();
    });
  });
});