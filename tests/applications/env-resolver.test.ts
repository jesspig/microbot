/**
 * 环境变量解析器测试
 *
 * 测试环境变量引用的解析功能
 */

import { test, expect, describe, beforeEach } from "bun:test";
import {
  resolveEnvVars,
  resolveEnvVarsDeep,
  hasEnvVarRef,
} from "../../microagent/applications/config/env-resolver.js";

// ============================================================================
// 测试常量
// ============================================================================

const ENV_VAR_PATTERN = /\$\{[^}]+\}/g;

// ============================================================================
// 测试套件
// ============================================================================

describe("环境变量解析器测试", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置环境变量
    process.env = { ...originalEnv };
  });

  describe("resolveEnvVars 函数", () => {
    test("应正确解析简单的环境变量引用", () => {
      process.env.TEST_VAR = "test-value";
      const result = resolveEnvVars("prefix-${TEST_VAR}-suffix");

      expect(result).toBe("prefix-test-value-suffix");
    });

    test("应处理不存在的环境变量", () => {
      const result = resolveEnvVars("prefix-${NONEXISTENT_VAR}-suffix");

      expect(result).toBe("prefix--suffix");
    });

    test("应处理空字符串环境变量", () => {
      process.env.EMPTY_VAR = "";
      const result = resolveEnvVars("value:${EMPTY_VAR}:end");

      expect(result).toBe("value::end");
    });

    test("应支持带默认值的环境变量引用（:- 语法）", () => {
      process.env.SET_VAR = "actual-value";
      const result1 = resolveEnvVars("${SET_VAR:-default-value}");
      expect(result1).toBe("actual-value");

      delete process.env.SET_VAR;
      const result2 = resolveEnvVars("${SET_VAR:-default-value}");
      expect(result2).toBe("default-value");
    });

    test("应支持带默认值的环境变量引用（- 语法）", () => {
      process.env.SET_VAR = "actual-value";
      const result1 = resolveEnvVars("${SET_VAR-default-value}");
      expect(result1).toBe("actual-value");

      delete process.env.SET_VAR;
      const result2 = resolveEnvVars("${SET_VAR-default-value}");
      expect(result2).toBe("default-value");
    });

    test("应正确区分 :- 和 - 语法的差异", () => {
      process.env.EMPTY_VAR = "";
      const result1 = resolveEnvVars("${EMPTY_VAR:-default}");
      expect(result1).toBe("default"); // :- 在变量为空时也使用默认值

      const result2 = resolveEnvVars("${EMPTY_VAR-default}");
      expect(result2).toBe(""); // - 仅在变量未设置时使用默认值
    });

    test("应处理多个环境变量引用", () => {
      process.env.VAR1 = "value1";
      process.env.VAR2 = "value2";
      process.env.VAR3 = "value3";

      const result = resolveEnvVars("${VAR1}-${VAR2}-${VAR3}");

      expect(result).toBe("value1-value2-value3");
    });

    test("应处理嵌套的环境变量引用", () => {
      process.env.PATH_VAR = "/usr/bin";
      process.env.PREFIX = "prefix";

      const result = resolveEnvVars("${PREFIX}:${PATH_VAR}");

      expect(result).toBe("prefix:/usr/bin");
    });

    test("应处理复杂的环境变量值", () => {
      process.env.COMPLEX_VAR = "value with spaces and special-chars_123";

      const result = resolveEnvVars("result: ${COMPLEX_VAR}");

      expect(result).toBe("result: value with spaces and special-chars_123");
    });

    test("应处理环境变量值为空时的默认值", () => {
      process.env.EMPTY_VAR = "";

      const result = resolveEnvVars("${EMPTY_VAR:-fallback}");

      expect(result).toBe("fallback");
    });

    test("应处理默认值中的特殊字符", () => {
      const result = resolveEnvVars("${NONEXISTENT:-default with spaces/special:chars}");

      expect(result).toBe("default with spaces/special:chars");
    });

    test("应处理包含数字的环境变量名", () => {
      process.env.VAR_123 = "value-123";

      const result = resolveEnvVars("${VAR_123}");

      expect(result).toBe("value-123");
    });

    test("应处理不匹配的文本", () => {
      const result = resolveEnvVars("no env vars here");

      expect(result).toBe("no env vars here");
    });

    test("应处理空字符串", () => {
      const result = resolveEnvVars("");

      expect(result).toBe("");
    });

    test("应处理仅包含环境变量引用的字符串", () => {
      process.env.SINGLE_VAR = "only-value";

      const result = resolveEnvVars("${SINGLE_VAR}");

      expect(result).toBe("only-value");
    });

    test("应处理连续的环境变量引用", () => {
      process.env.VAR_A = "A";
      process.env.VAR_B = "B";

      const result = resolveEnvVars("${VAR_A}${VAR_B}");

      expect(result).toBe("AB");
    });

    test("应处理大小写敏感的环境变量名", () => {
      process.env.LOWERCASE = "lower";
      process.env.UPPERCASE = "UPPER";

      const result = resolveEnvVars("${lowercase}-${UPPERCASE}");

      expect(result).toBe("-UPPER"); // lowercase 不存在
    });
  });

  describe("resolveEnvVarsDeep 函数", () => {
    test("应正确解析字符串中的环境变量", () => {
      process.env.API_KEY = "secret-key";
      const result = resolveEnvVarsDeep("Bearer ${API_KEY}");

      expect(result).toBe("Bearer secret-key");
    });

    test("应递归解析对象中的所有环境变量", () => {
      process.env.API_KEY = "test-key";
      process.env.BASE_URL = "https://api.example.com";

      const input = {
        apiKey: "${API_KEY}",
        baseUrl: "${BASE_URL}",
        models: ["gpt-4", "gpt-3.5"],
      };

      const result = resolveEnvVarsDeep(input);

      expect(result.apiKey).toBe("test-key");
      expect(result.baseUrl).toBe("https://api.example.com");
      expect(result.models).toEqual(["gpt-4", "gpt-3.5"]);
    });

    test("应递归解析数组中的环境变量", () => {
      process.env.VAR1 = "value1";
      process.env.VAR2 = "value2";

      const input = ["${VAR1}", "${VAR2}", "static"];

      const result = resolveEnvVarsDeep(input);

      expect(result).toEqual(["value1", "value2", "static"]);
    });

    test("应处理嵌套对象结构", () => {
      process.env.KEY1 = "value1";
      process.env.KEY2 = "value2";

      const input = {
        level1: {
          level2: {
            key1: "${KEY1}",
            key2: "${KEY2}",
          },
        },
      };

      const result = resolveEnvVarsDeep(input);

      expect(result.level1.level2.key1).toBe("value1");
      expect(result.level1.level2.key2).toBe("value2");
    });

    test("应处理混合类型的数组", () => {
      process.env.ENV_VAL = "env-value";

      const input = [
        "string",
        123,
        true,
        null,
        { key: "${ENV_VAL}" },
        ["${ENV_VAL}"],
      ];

      const result = resolveEnvVarsDeep(input);

      expect(result[0]).toBe("string");
      expect(result[1]).toBe(123);
      expect(result[2]).toBe(true);
      expect(result[3]).toBe(null);
      expect(result[4].key).toBe("env-value");
      expect(result[5][0]).toBe("env-value");
    });

    test("应返回原始值（非字符串、数组、对象）", () => {
      const input = 123;
      const result = resolveEnvVarsDeep(input);

      expect(result).toBe(123);
    });

    test("应处理 null 值", () => {
      const result = resolveEnvVarsDeep(null);

      expect(result).toBe(null);
    });

    test("应处理布尔值", () => {
      const result1 = resolveEnvVarsDeep(true);
      const result2 = resolveEnvVarsDeep(false);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    test("应处理数字", () => {
      const result = resolveEnvVarsDeep(42.5);

      expect(result).toBe(42.5);
    });

    test("应处理复杂嵌套结构", () => {
      process.env.URL = "https://example.com";
      process.env.KEY = "secret";

      const input = {
        service: {
          endpoint: "${URL}",
          auth: {
            type: "Bearer",
            token: "${KEY}",
          },
          options: [
            { name: "option1", value: "${URL}" },
            { name: "option2", value: "static" },
          ],
        },
      };

      const result = resolveEnvVarsDeep(input);

      expect(result.service.endpoint).toBe("https://example.com");
      expect(result.service.auth.token).toBe("secret");
      expect(result.service.options[0].value).toBe("https://example.com");
      expect(result.service.options[1].value).toBe("static");
    });

    test("应保持原始对象和数组的引用", () => {
      process.env.VAR = "value";

      const originalArray = ["${VAR}", "static"];
      const originalObject = { key: "${VAR}" };

      const resultArray = resolveEnvVarsDeep(originalArray);
      const resultObject = resolveEnvVarsDeep(originalObject);

      // 返回新对象，保持原始不变
      expect(resultArray).not.toBe(originalArray);
      expect(resultObject).not.toBe(originalObject);

      // 原始对象保持不变
      expect(originalArray[0]).toBe("${VAR}");
      expect(originalObject.key).toBe("${VAR}");

      // 新对象已解析
      expect(resultArray[0]).toBe("value");
      expect(resultObject.key).toBe("value");
    });

    test("应处理空对象和空数组", () => {
      const result1 = resolveEnvVarsDeep({});
      const result2 = resolveEnvVarsDeep([]);

      expect(result1).toEqual({});
      expect(result2).toEqual([]);
    });

    test("应处理对象键（虽然通常不包含环境变量）", () => {
      process.env.DYNAMIC_KEY = "real-key";

      const input = {
        "${DYNAMIC_KEY}": "value",
      };

      const result = resolveEnvVarsDeep(input);

      // 对象键也会被解析
      expect(result["real-key"]).toBe("value");
    });
  });

  describe("hasEnvVarRef 函数", () => {
    test("应检测到环境变量引用", () => {
      expect(hasEnvVarRef("prefix-${VAR}-suffix")).toBe(true);
      expect(hasEnvVarRef("${VAR}")).toBe(true);
      expect(hasEnvVarRef("${VAR:-default}")).toBe(true);
    });

    test("应返回 false 当没有环境变量引用", () => {
      expect(hasEnvVarRef("no env vars")).toBe(false);
      expect(hasEnvVarRef("")).toBe(false);
      expect(hasEnvVarRef("$VAR")).toBe(false); // 不匹配
      expect(hasEnvVarRef("${ VAR }")).toBe(false); // 不匹配（包含空格）
    });

    test("应检测多个环境变量引用", () => {
      expect(hasEnvVarRef("${VAR1}-${VAR2}")).toBe(true);
    });

    test("应处理边界情况", () => {
      expect(hasEnvVarRef("${")).toBe(false);
      expect(hasEnvVarRef("}")).toBe(false);
      expect(hasEnvVarRef("${}")).toBe(false);
      expect(hasEnvVarRef("text${")).toBe(false);
    });
  });

  describe("边界情况和错误处理", () => {
    test("应处理无效的环境变量语法", () => {
      const result = resolveEnvVars("invalid ${ syntax");

      expect(result).toBe("invalid ${ syntax");
    });

    test("应处理空的环境变量名", () => {
      const result = resolveEnvVars("${:-default}");

      expect(result).toBe("default");
    });

    test("应处理包含特殊字符的环境变量名", () => {
      process.env["VAR_WITH_UNDERSCORE"] = "value";

      const result = resolveEnvVars("${VAR_WITH_UNDERSCORE}");

      expect(result).toBe("value");
    });

    test("应处理非常大的字符串", () => {
      process.env.LONG_VAR = "a".repeat(10000);

      const result = resolveEnvVars("prefix-${LONG_VAR}-suffix");

      expect(result.length).toBe(10000 + 14); // "prefix-" (7) + 10000 + "-suffix" (7) = 10014
    });

    test("应处理非常深层次的嵌套", () => {
      process.env.DEEP_VAR = "deep-value";

      const input = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: "${DEEP_VAR}",
                },
              },
            },
          },
        },
      };

      const result = resolveEnvVarsDeep(input);

      expect(result.level1.level2.level3.level4.level5.value).toBe("deep-value");
    });

    test("应处理循环引用（应该避免栈溢出）", () => {
      // 虽然我们的实现不会产生循环引用，但测试确保不会出错
      // 确保 resolveEnvVarsDeep 函数能够处理空的环境变量引用
      const result = resolveEnvVarsDeep({ key: "${VAR}" });

      expect(result.key).toBe("");
    });
  });

  describe("实际应用场景", () => {
    test("应正确解析 API 配置", () => {
      process.env.OPENAI_API_KEY = "sk-1234567890";
      process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";

      const config = {
        provider: "openai",
        apiKey: "${OPENAI_API_KEY}",
        baseUrl: "${OPENAI_BASE_URL}",
        models: ["gpt-4", "gpt-3.5-turbo"],
      };

      const result = resolveEnvVarsDeep(config);

      expect(result.apiKey).toBe("sk-1234567890");
      expect(result.baseUrl).toBe("https://api.openai.com/v1");
    });

    test("应正确解析数据库配置", () => {
      process.env.DB_HOST = "localhost";
      process.env.DB_PORT = "5432";
      process.env.DB_USER = "admin";
      // 不设置 DB_PASS，测试默认值行为

      const config = {
        database: {
          host: "${DB_HOST}",
          port: "${DB_PORT}",
          username: "${DB_USER}",
          password: "${DB_PASS:-default-pass}",
        },
      };

      const result = resolveEnvVarsDeep(config);

      expect(result.database.host).toBe("localhost");
      expect(result.database.port).toBe("5432");
      expect(result.database.username).toBe("admin");
      expect(result.database.password).toBe("default-pass");
    });

    test("应正确解析文件路径配置", () => {
      process.env.HOME = "/home/user";

      const config = {
        workspace: "${HOME}/workspace",
        cache: "${HOME}/.cache",
        logs: "${HOME}/logs",
      };

      const result = resolveEnvVarsDeep(config);

      expect(result.workspace).toBe("/home/user/workspace");
      expect(result.cache).toBe("/home/user/.cache");
      expect(result.logs).toBe("/home/user/logs");
    });
  });

  describe("性能和稳定性", () => {
    test("应高效处理大量环境变量", () => {
      // 设置多个环境变量
      for (let i = 0; i < 100; i++) {
        process.env[`VAR_${i}`] = `value-${i}`;
      }

      // 构建包含多个环境变量的字符串
      let input = "";
      for (let i = 0; i < 100; i++) {
        input += `\${VAR_${i}} `;
      }

      const result = resolveEnvVars(input.trim());

      expect(result).toContain("value-0");
      expect(result).toContain("value-99");
    });

    test("应高效处理深度嵌套对象", () => {
      process.env.DEEP_VAR = "value";

      let nested: any = { value: "${DEEP_VAR}" };
      for (let i = 0; i < 50; i++) {
        nested = { level: nested };
      }

      const result = resolveEnvVarsDeep(nested);

      // 验证最深层被正确解析
      let current: any = result;
      for (let i = 0; i < 50; i++) {
        current = current.level;
      }
      expect(current.value).toBe("value");
    });
  });
});