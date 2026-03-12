/**
 * 配置模块集成测试
 *
 * 测试配置加载、解析和验证功能
 */

import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import {
  loadSettings,
  getDefaultSettings,
  mergeSettings,
  ConfigLoadError,
  ConfigValidationError,
} from "../../microagent/applications/config/index.js";
import { SETTINGS_FILE } from "../../microagent/applications/shared/constants.js";
import type { Settings } from "../../microagent/applications/config/index.js";

// ============================================================================
// 测试常量
// ============================================================================

const VALID_YAML_CONFIG = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"
    model: "openai/gpt-4"
    maxTokens: 8192
    temperature: 0.7
    maxToolIterations: 40
    heartbeatInterval: 30

tools:
  enabled: ["filesystem", "shell", "web"]
  disabled: []
  config:
    shell:
      allowedCommands: ["ls", "cat"]
      blockedCommands: ["rm"]

providers:
  openai:
    type: openai
    enabled: true
    baseUrl: "https://api.openai.com/v1"
    apiKey: "sk-test-key"
    models: ["gpt-4", "gpt-3.5-turbo"]

  anthropic:
    type: anthropic
    enabled: false
    baseUrl: "https://api.anthropic.com/v1"
    apiKey: "sk-ant-test"
    models: ["claude-3-opus"]

channels:
  feishu:
    enabled: false
    appId: ""
    appSecret: ""
`;

const INVALID_YAML_SYNTAX = `
agents:
  defaults:
    workspace: [invalid yaml syntax
`;

const INVALID_SCHEMA_CONFIG = `
agents:
  defaults:
    workspace: ""
    maxTokens: -1
    temperature: 2.0
`;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建测试配置文件
 */
async function createTestConfigFile(content: string, path: string): Promise<void> {
  const file = Bun.file(path);
  await Bun.write(path, content);
}

/**
 * 删除测试配置文件
 */
async function removeTestConfigFile(path: string): Promise<void> {
  try {
    await Bun.$`rm -f ${path}`;
  } catch {
    // 忽略删除失败
  }
}

// ============================================================================
// 配置加载测试
// ============================================================================

describe("配置模块集成测试", () => {
  const originalEnv = process.env;
  const testConfigPath = "/tmp/test-config.yaml";

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await removeTestConfigFile(testConfigPath);
  });

  describe("loadSettings 函数", () => {
    test("应成功加载有效的 YAML 配置", async () => {
      await createTestConfigFile(VALID_YAML_CONFIG, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings).toBeDefined();
      expect(settings.agents.defaults.workspace).toBe("~/.micro-agent/workspace");
      expect(settings.agents.defaults.model).toBe("openai/gpt-4");
      expect(settings.agents.defaults.maxTokens).toBe(8192);
      expect(settings.agents.defaults.temperature).toBe(0.7);
    });

    test("应正确解析嵌套的配置结构", async () => {
      await createTestConfigFile(VALID_YAML_CONFIG, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      // 验证 tools 配置
      expect(settings.tools).toBeDefined();
      expect(settings.tools?.enabled).toEqual(["filesystem", "shell", "web"]);
      expect(settings.tools?.disabled).toEqual([]);

      // 验证 providers 配置
      expect(settings.providers).toBeDefined();
      expect(settings.providers?.openai?.enabled).toBe(true);
      expect(settings.providers?.openai?.apiKey).toBe("sk-test-key");
      expect(settings.providers?.anthropic?.enabled).toBe(false);

      // 验证 channels 配置
      expect(settings.channels).toBeDefined();
      expect(settings.channels?.feishu?.enabled).toBe(false);
    });

    test("配置文件不存在时应返回默认配置", async () => {
      const settings = await loadSettings("/non-existent/config.yaml");

      expect(settings).toBeDefined();
      expect(settings.agents.defaults.workspace).toBe("~/.micro-agent/workspace");
      expect(settings.tools?.enabled).toEqual([]);
    });

    test("YAML 语法错误时应抛出 ConfigLoadError", async () => {
      await createTestConfigFile(INVALID_YAML_SYNTAX, testConfigPath);

      await expect(loadSettings(testConfigPath)).rejects.toThrow(ConfigLoadError);
      await expect(loadSettings(testConfigPath)).rejects.toThrow("YAML 解析失败");
    });

    test("Schema 验证失败时应抛出 ConfigValidationError", async () => {
      await createTestConfigFile(INVALID_SCHEMA_CONFIG, testConfigPath);

      await expect(loadSettings(testConfigPath)).rejects.toThrow(ConfigValidationError);
      await expect(loadSettings(testConfigPath)).rejects.toThrow("配置验证失败");
    });

    test("应正确解析环境变量引用", async () => {
      process.env.TEST_API_KEY = "env-api-key-123";
      process.env.TEST_MODEL = "env-model";
      process.env.TEST_WORKSPACE = "/home/test/workspace";

      const envConfig = `
agents:
  defaults:
    workspace: "\${TEST_WORKSPACE}"
    model: "\${TEST_MODEL}"

providers:
  openai:
    type: openai
    enabled: true
    baseUrl: "https://api.openai.com/v1"
    apiKey: "\${TEST_API_KEY}"
    models: ["gpt-4"]
`;

      await createTestConfigFile(envConfig, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings.providers?.openai?.apiKey).toBe("env-api-key-123");
      expect(settings.agents.defaults.model).toBe("env-model");
      expect(settings.agents.defaults.workspace).toBe("/home/test/workspace");
    });

    test("应支持带默认值的环境变量引用", async () => {
      const configWithDefault = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"

providers:
  openai:
    type: openai
    enabled: true
    baseUrl: "https://api.openai.com/v1"
    apiKey: "\${MISSING_KEY:-default-api-key}"
    models: ["gpt-4"]
`;

      await createTestConfigFile(configWithDefault, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings.providers?.openai?.apiKey).toBe("default-api-key");
    });
  });

  describe("getDefaultSettings 函数", () => {
    test("应返回默认配置对象", () => {
      const defaults = getDefaultSettings();

      expect(defaults).toBeDefined();
      expect(defaults.agents.defaults.workspace).toBe("~/.micro-agent/workspace");
      expect(defaults.agents.defaults.maxTokens).toBe(8192);
      expect(defaults.agents.defaults.temperature).toBe(0.7);
      expect(defaults.agents.defaults.maxToolIterations).toBe(40);
      expect(defaults.agents.defaults.heartbeatInterval).toBe(30);
    });

    test("默认配置应包含空的工具列表", () => {
      const defaults = getDefaultSettings();

      expect(defaults.tools.enabled).toEqual([]);
      expect(defaults.tools.disabled).toEqual([]);
    });

    test("默认配置应包含空的 providers 和 channels", () => {
      const defaults = getDefaultSettings();

      expect(defaults.providers).toEqual({});
      expect(defaults.channels).toEqual({});
    });

    test("多次调用应返回相同结构的对象", () => {
      const defaults1 = getDefaultSettings();
      const defaults2 = getDefaultSettings();

      expect(defaults1).toEqual(defaults2);
    });
  });

  describe("mergeSettings 函数", () => {
    test("应正确合并配置对象", () => {
      const base = getDefaultSettings();
      const override: Partial<Settings> = {
        agents: {
          defaults: {
            ...base.agents.defaults,
            model: "custom-model",
            maxTokens: 4096,
          },
        },
        tools: {
          enabled: ["filesystem"],
          disabled: ["shell"],
        },
      };

      const merged = mergeSettings(base, override);

      expect(merged.agents.defaults.model).toBe("custom-model");
      expect(merged.agents.defaults.maxTokens).toBe(4096);
      // 保留未覆盖的值
      expect(merged.agents.defaults.temperature).toBe(0.7);
      expect(merged.tools.enabled).toEqual(["filesystem"]);
      expect(merged.tools.disabled).toEqual(["shell"]);
    });

    test("应处理部分覆盖", () => {
      const base = getDefaultSettings();
      const override: Partial<Settings> = {
        agents: {
          defaults: {
            ...base.agents.defaults,
            model: "new-model",
          },
        },
      };

      const merged = mergeSettings(base, override);

      expect(merged.agents.defaults.model).toBe("new-model");
      expect(merged.agents.defaults.maxTokens).toBe(8192);
    });

    test("空覆盖配置应返回原配置", () => {
      const base = getDefaultSettings();
      const merged = mergeSettings(base, {});

      expect(merged).toEqual(base);
    });

    test("应正确处理 providers 覆盖", () => {
      const base = getDefaultSettings();
      const override: Partial<Settings> = {
        providers: {
          openai: {
            type: "openai",
            enabled: true,
            baseUrl: "https://api.openai.com/v1",
            apiKey: "test-key",
            models: ["gpt-4"],
          },
        },
      };

      const merged = mergeSettings(base, override);

      expect(merged.providers?.openai?.enabled).toBe(true);
      expect(merged.providers?.openai?.apiKey).toBe("test-key");
    });
  });

  describe("ConfigLoadError", () => {
    test("应正确存储错误信息", () => {
      const error = new ConfigLoadError("测试错误", "/test/path.yaml");

      expect(error.message).toBe("测试错误");
      expect(error.filePath).toBe("/test/path.yaml");
      expect(error.name).toBe("ConfigLoadError");
    });

    test("应正确序列化", () => {
      const error = new ConfigLoadError("测试错误", "/test/path.yaml");

      const json = JSON.stringify(error);
      expect(json).toContain("测试错误");
      expect(json).toContain("/test/path.yaml");
    });
  });

  describe("ConfigValidationError", () => {
    test("应正确存储错误信息", () => {
      const error = new ConfigValidationError("验证失败", "/test/path.yaml");

      expect(error.message).toBe("验证失败");
      expect(error.filePath).toBe("/test/path.yaml");
      expect(error.name).toBe("ConfigValidationError");
    });
  });

  describe("配置完整性和边界测试", () => {
    test("应正确处理可选字段缺失", async () => {
      const minimalConfig = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"
`;

      await createTestConfigFile(minimalConfig, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings.agents.defaults.workspace).toBe("~/.micro-agent/workspace");
      // 使用默认值
      expect(settings.agents.defaults.maxTokens).toBe(8192);
      expect(settings.agents.defaults.temperature).toBe(0.7);
    });

    test("应正确处理空字符串值", async () => {
      const emptyStringConfig = `
agents:
  defaults:
    workspace: ""
    model: ""

tools:
  enabled: []
`;

      await createTestConfigFile(emptyStringConfig, testConfigPath);

      await expect(loadSettings(testConfigPath)).rejects.toThrow();
    });

    test("应正确处理数组类型的配置", async () => {
      const arrayConfig = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"

tools:
  enabled: ["filesystem", "shell", "web"]
  disabled: ["test"]

providers:
  openai:
    type: openai
    enabled: true
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models: ["gpt-4", "gpt-3.5-turbo", "gpt-4-turbo"]
`;

      await createTestConfigFile(arrayConfig, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(Array.isArray(settings.tools?.enabled)).toBe(true);
      expect(settings.tools?.enabled).toHaveLength(3);
      expect(Array.isArray(settings.providers?.openai?.models)).toBe(true);
      expect(settings.providers?.openai?.models).toHaveLength(3);
    });

    test("应正确处理布尔值类型的配置", async () => {
      const booleanConfig = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"

providers:
  openai:
    type: openai
    enabled: true
    baseUrl: "https://api.openai.com/v1"
    apiKey: "test-key"
    models: ["gpt-4"]

  anthropic:
    type: anthropic
    enabled: false
    baseUrl: "https://api.anthropic.com/v1"
    apiKey: "test-key"
    models: ["claude-3"]
`;

      await createTestConfigFile(booleanConfig, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings.providers?.openai?.enabled).toBe(true);
      expect(settings.providers?.anthropic?.enabled).toBe(false);
    });
  });

  describe("特殊字符和边界值测试", () => {
    test("应正确处理路径中的特殊字符", async () => {
      const specialPathConfig = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace-with_special.chars"
`;

      await createTestConfigFile(specialPathConfig, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings.agents.defaults.workspace).toBe("~/.micro-agent/workspace-with_special.chars");
    });

    test("应正确处理数值边界", async () => {
      const boundaryConfig = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"
    maxTokens: 1
    temperature: 0
    maxToolIterations: 1
    heartbeatInterval: 1
`;

      await createTestConfigFile(boundaryConfig, testConfigPath);

      const settings = await loadSettings(testConfigPath);

      expect(settings.agents.defaults.maxTokens).toBe(1);
      expect(settings.agents.defaults.temperature).toBe(0);
      expect(settings.agents.defaults.maxToolIterations).toBe(1);
      expect(settings.agents.defaults.heartbeatInterval).toBe(1);
    });

    test("应拒绝无效的数值边界", async () => {
      const invalidBoundaryConfig = `
agents:
  defaults:
    workspace: "~/.micro-agent/workspace"
    maxTokens: 0
    temperature: 1.5
`;

      await createTestConfigFile(invalidBoundaryConfig, testConfigPath);

      await expect(loadSettings(testConfigPath)).rejects.toThrow();
    });
  });

  describe("类型导出测试", () => {
    test("应正确导出所有配置类型", async () => {
      await createTestConfigFile(VALID_YAML_CONFIG, testConfigPath);

      const settings: Settings = await loadSettings(testConfigPath);

      // 验证类型正确性
      expect(typeof settings.agents.defaults.workspace).toBe("string");
      expect(typeof settings.agents.defaults.maxTokens).toBe("number");
      expect(typeof settings.agents.defaults.temperature).toBe("number");
      expect(typeof settings.tools?.enabled).toBeDefined();
      expect(typeof settings.providers?.openai?.enabled).toBe("boolean");
    });
  });
});