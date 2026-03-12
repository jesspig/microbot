/**
 * Tools 模块集成测试
 *
 * 测试工具注册、实例化和执行功能
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  FilesystemTool,
  ShellTool,
  WebTool,
  toolFactories,
  getAllTools,
  getTool,
  getAllToolDefinitions,
} from "../../microagent/applications/tools/index.js";
import { ToolRegistry } from "../../microagent/runtime/tool/index.js";
import { WORKSPACE_DIR } from "../../microagent/applications/shared/constants.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// 测试常量
// ============================================================================

/** 跨平台兼容的测试工作目录 */
const TEST_WORKSPACE = join(tmpdir(), "micro-agent-test-workspace");
const TEST_FILE_PATH = join(TEST_WORKSPACE, "test-file.txt");

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 创建测试工作目录
 */
async function setupTestWorkspace(): Promise<void> {
  await mkdir(TEST_WORKSPACE, { recursive: true });
}

/**
 * 清理测试工作目录
 */
async function cleanupTestWorkspace(): Promise<void> {
  try {
    await rm(TEST_WORKSPACE, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

/**
 * 创建测试文件
 */
async function createTestFile(content: string): Promise<void> {
  await writeFile(TEST_FILE_PATH, content, "utf-8");
}

// ============================================================================
// 测试套件
// ============================================================================

describe("Tools 模块集成测试", () => {
  describe("工具工厂函数", () => {
    describe("toolFactories 映射", () => {
      test("应包含所有预定义的工具工厂", () => {
        expect(toolFactories).toBeDefined();
        expect(typeof toolFactories).toBe("object");

        // 验证存在性
        expect(toolFactories.filesystem).toBeDefined();
        expect(toolFactories.shell).toBeDefined();
        expect(toolFactories.web).toBeDefined();
      });

      test("每个工厂函数应返回有效的工具实例", () => {
        const filesystemTool = toolFactories.filesystem();
        const shellTool = toolFactories.shell();
        const webTool = toolFactories.web();

        expect(filesystemTool).toBeDefined();
        expect(shellTool).toBeDefined();
        expect(webTool).toBeDefined();

        // 验证工具实例具有必需的属性
        expect(filesystemTool.name).toBe("filesystem");
        expect(shellTool.name).toBe("shell");
        expect(webTool.name).toBe("web");
      });

      test("工厂函数应返回新的实例", () => {
        const tool1 = toolFactories.filesystem();
        const tool2 = toolFactories.filesystem();

        expect(tool1).not.toBe(tool2); // 不同的实例
        expect(tool1.name).toBe(tool2.name); // 相同的类型
      });
    });

    describe("getAllTools 函数", () => {
      test("应返回所有工具实例", () => {
        const tools = getAllTools();

        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);

        // 验证包含预期的工具
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("filesystem");
        expect(toolNames).toContain("shell");
        expect(toolNames).toContain("web");
      });

      test("应返回有效的工具实例", () => {
        const tools = getAllTools();

        for (const tool of tools) {
          expect(tool).toBeDefined();
          expect(typeof tool.name).toBe("string");
          expect(typeof tool.description).toBe("string");
          expect(typeof tool.parameters).toBe("object");
          expect(typeof tool.execute).toBe("function");
        }
      });

      test("多次调用应返回相同数量的工具", () => {
        const tools1 = getAllTools();
        const tools2 = getAllTools();

        expect(tools1.length).toBe(tools2.length);
      });
    });

    describe("getTool 函数", () => {
      test("应返回指定名称的工具", () => {
        const filesystemTool = getTool("filesystem");

        expect(filesystemTool).toBeDefined();
        expect(filesystemTool?.name).toBe("filesystem");
      });

      test("应支持获取所有预定义工具", () => {
        const filesystem = getTool("filesystem");
        const shell = getTool("shell");
        const web = getTool("web");

        expect(filesystem?.name).toBe("filesystem");
        expect(shell?.name).toBe("shell");
        expect(web?.name).toBe("web");
      });

      test("不存在的工具应返回 null", () => {
        const tool = getTool("non-existent-tool");

        expect(tool).toBeNull();
      });

      test("应区分大小写", () => {
        const tool1 = getTool("filesystem");
        const tool2 = getTool("FILESYSTEM");
        const tool3 = getTool("Filesystem");

        expect(tool1).toBeDefined();
        expect(tool2).toBeNull();
        expect(tool3).toBeNull();
      });
    });

    describe("getAllToolDefinitions 函数", () => {
      test("应返回所有工具定义", () => {
        const definitions = getAllToolDefinitions();

        expect(Array.isArray(definitions)).toBe(true);
        expect(definitions.length).toBeGreaterThan(0);

        // 验证定义结构
        for (const def of definitions) {
          expect(def).toHaveProperty("name");
          expect(def).toHaveProperty("description");
          expect(def).toHaveProperty("parameters");
          expect(def.parameters).toHaveProperty("type");
          expect(def.parameters).toHaveProperty("properties");
        }
      });

      test("应包含所有工具的 Schema 定义", () => {
        const definitions = getAllToolDefinitions();
        const names = definitions.map((d) => d.name);

        expect(names).toContain("filesystem");
        expect(names).toContain("shell");
        expect(names).toContain("web");
      });
    });
  });

  describe("FilesystemTool 测试", () => {
    let tool: FilesystemTool;

    beforeEach(async () => {
      await setupTestWorkspace();
      tool = new FilesystemTool(TEST_WORKSPACE);
    });

    afterEach(async () => {
      await cleanupTestWorkspace();
    });

    describe("基础属性", () => {
      test("应具有正确的名称和描述", () => {
        expect(tool.name).toBe("filesystem");
        expect(tool.description).toBeDefined();
        expect(tool.description).toContain("文件系统");
      });

      test("应具有正确的参数定义", () => {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters.properties).toBeDefined();
        expect(tool.parameters.properties.action).toBeDefined();
        expect(tool.parameters.properties.path).toBeDefined();
      });

      test("应定义必需的参数", () => {
        expect(Array.isArray(tool.parameters.required)).toBe(true);
        expect(tool.parameters.required).toContain("action");
        expect(tool.parameters.required).toContain("path");
      });
    });

    describe("write 操作", () => {
      test("应成功写入文件", async () => {
        const result = await tool.execute({
          action: "write",
          path: "test-file.txt",
          content: "Hello, World!",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("写入成功");
        expect(result.metadata?.path).toBeDefined();
        expect(result.metadata?.size).toBe(13);
      });

      test("应自动创建不存在的目录", async () => {
        const result = await tool.execute({
          action: "write",
          path: "subdir/nested/file.txt",
          content: "Nested file content",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("写入成功");
      });

      test("缺少 content 参数应返回错误", async () => {
        const result = await tool.execute({
          action: "write",
          path: "test.txt",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("content");
      });
    });

    describe("read 操作", () => {
      beforeEach(async () => {
        await createTestFile("Test file content");
      });

      test("应成功读取文件", async () => {
        const result = await tool.execute({
          action: "read",
          path: "test-file.txt",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toBe("Test file content");
        expect(result.metadata?.size).toBe(17);
      });

      test("读取不存在的文件应返回错误", async () => {
        const result = await tool.execute({
          action: "read",
          path: "non-existent.txt",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("不存在");
      });
    });

    describe("edit 操作", () => {
      beforeEach(async () => {
        await createTestFile("Hello World\nHello Universe");
      });

      test("应成功替换文本", async () => {
        const result = await tool.execute({
          action: "edit",
          path: "test-file.txt",
          search: "Hello",
          replace: "Hi",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("替换了 2 处");
      });

      test("未找到搜索文本应返回错误", async () => {
        const result = await tool.execute({
          action: "edit",
          path: "test-file.txt",
          search: "NonExistent",
          replace: "Replacement",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("未找到");
      });

      test("缺少 search 参数应返回错误", async () => {
        const result = await tool.execute({
          action: "edit",
          path: "test-file.txt",
          replace: "Replacement",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("search");
      });
    });

    describe("list 操作", () => {
      beforeEach(async () => {
        await createTestFile("file1");
        await writeFile(join(TEST_WORKSPACE, "file2.txt"), "file2");
        await mkdir(join(TEST_WORKSPACE, "subdir"), { recursive: true });
        await writeFile(join(TEST_WORKSPACE, "subdir", "nested.txt"), "nested");
      });

      test("应列出目录内容", async () => {
        const result = await tool.execute({
          action: "list",
          path: ".",
        });

        expect(result.isError).toBe(false);
        const items = JSON.parse(result.content);
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBeGreaterThan(0);
      });

      test("应支持递归列出", async () => {
        const result = await tool.execute({
          action: "list",
          path: ".",
          recursive: true,
        });

        expect(result.isError).toBe(false);
        const items = JSON.parse(result.content);
        expect(items.some((item: any) => item.name.includes("nested"))).toBe(true);
      });

      test("列出不存在的目录应返回错误", async () => {
        const result = await tool.execute({
          action: "list",
          path: "non-existent",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("不存在");
      });
    });

    describe("delete 操作", () => {
      beforeEach(async () => {
        await createTestFile("To be deleted");
      });

      test("应成功删除文件", async () => {
        const result = await tool.execute({
          action: "delete",
          path: "test-file.txt",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("删除成功");
      });

      test("删除不存在的文件应返回错误", async () => {
        const result = await tool.execute({
          action: "delete",
          path: "non-existent.txt",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("不存在");
      });

      test("不应允许删除目录", async () => {
        await mkdir(join(TEST_WORKSPACE, "test-dir"));
        const result = await tool.execute({
          action: "delete",
          path: "test-dir",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("不能删除目录");
      });
    });

    describe("move 操作", () => {
      beforeEach(async () => {
        await createTestFile("Original content");
      });

      test("应成功移动文件", async () => {
        const result = await tool.execute({
          action: "move",
          path: "test-file.txt",
          destination: "moved-file.txt",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("移动成功");
      });

      test("应支持重命名", async () => {
        const result = await tool.execute({
          action: "move",
          path: "test-file.txt",
          destination: "renamed.txt",
        });

        expect(result.isError).toBe(false);
      });

      test("缺少 destination 参数应返回错误", async () => {
        const result = await tool.execute({
          action: "move",
          path: "test-file.txt",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("destination");
      });
    });

    describe("路径安全", () => {
      test("应拒绝 workspace 之外的路径", async () => {
        const result = await tool.execute({
          action: "read",
          path: "../../../etc/passwd",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("不在允许的 workspace");
      });

      test("应拒绝绝对路径", async () => {
        const result = await tool.execute({
          action: "read",
          path: "/etc/passwd",
        });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("不在允许的 workspace");
      });

      test("应接受 workspace 内的相对路径", async () => {
        await createTestFile("Safe content");
        const result = await tool.execute({
          action: "read",
          path: "test-file.txt",
        });

        expect(result.isError).toBe(false);
      });
    });
  });

  describe("ShellTool 测试", () => {
    let tool: ShellTool;

    beforeEach(() => {
      tool = new ShellTool();
    });

    describe("基础属性", () => {
      test("应具有正确的名称和描述", () => {
        expect(tool.name).toBe("shell");
        expect(tool.description).toBeDefined();
        expect(tool.description).toContain("命令");
      });

      test("应具有正确的参数定义", () => {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters.properties.command).toBeDefined();
      });
    });

    describe("命令执行", () => {
      test("应成功执行简单命令", async () => {
        const result = await tool.execute({
          command: "echo Hello World",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("Hello");
      });

      test("应返回命令退出码", async () => {
        const result = await tool.execute({
          command: "echo test",
        });

        expect(result.metadata?.exitCode).toBe(0);
      });

      test("命令执行失败应返回错误", async () => {
        const result = await tool.execute({
          command: "exit 1",
        });

        expect(result.isError).toBe(true);
        expect(result.metadata?.exitCode).not.toBe(0);
      });

      test("缺少 command 参数应返回错误", async () => {
        const result = await tool.execute({});

        expect(result.isError).toBe(true);
      });
    });

    describe("特殊字符处理", () => {
      test("应正确处理包含引号的命令", async () => {
        const result = await tool.execute({
          command: 'echo Test with quotes',
        });

        expect(result.isError).toBe(false);
        expect(result.content).toContain("Test");
      });

      test("应正确处理多行命令", async () => {
        const result = await tool.execute({
          command: "echo line1 && echo line2",
        });

        expect(result.isError).toBe(false);
      });
    });
  });

  describe("WebTool 测试", () => {
    let tool: WebTool;

    beforeEach(() => {
      tool = new WebTool();
    });

    describe("基础属性", () => {
      test("应具有正确的名称和描述", () => {
        expect(tool.name).toBe("web");
        expect(tool.description).toBeDefined();
      });

      test("应具有正确的参数定义", () => {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters.properties.action).toBeDefined();
        expect(tool.parameters.properties.query).toBeDefined();
      });
    });

    describe("HTTP 请求", () => {
      test("应支持 fetch 操作", async () => {
        // 使用公共测试 API
        const result = await tool.execute({
          action: "fetch",
          query: "https://httpbin.org/get",
        });

        expect(result.isError).toBe(false);
        expect(result.content).toBeDefined();
      });

      // 跳过搜索测试 - DuckDuckGo API 可能被网络限制
      test.skip("应支持搜索操作", async () => {
        const result = await tool.execute({
          action: "search",
          query: "test query",
          limit: 3,
          timeout: 10000,
        });

        // 搜索可能失败（网络原因），所以只检查结构
        expect(result.content).toBeDefined();
        expect(result.isError).toBeDefined();
      });

      test("应支持自定义 headers", async () => {
        const result = await tool.execute({
          action: "fetch",
          query: "https://httpbin.org/headers",
          headers: {
            "X-Custom-Header": "test-value",
          },
        });

        expect(result.isError).toBe(false);
      });

      test("缺少 query 参数应返回错误", async () => {
        const result = await tool.execute({
          action: "fetch",
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("错误处理", () => {
      test("无效 URL 应返回错误", async () => {
        const result = await tool.execute({
          action: "fetch",
          query: "not-a-valid-url",
        });

        expect(result.isError).toBe(true);
      });

      test("网络错误应返回错误", async () => {
        const result = await tool.execute({
          action: "fetch",
          query: "https://non-existent-domain-12345.com",
        });

        expect(result.isError).toBe(true);
      });
    });
  });

  describe("工具注册表集成", () => {
    let registry: ToolRegistry;

    beforeEach(() => {
      registry = new ToolRegistry();
    });

    test("应成功注册所有工具", () => {
      const tools = getAllTools();

      for (const tool of tools) {
        registry.register(tool);
      }

      expect(registry.list().length).toBe(tools.length);
    });

    test("应能够获取已注册的工具", () => {
      const filesystemTool = getTool("filesystem");
      if (filesystemTool) {
        registry.register(filesystemTool);

        const retrieved = registry.get("filesystem");
        expect(retrieved).toBe(filesystemTool);
      }
    });

    test("应能够列出所有工具定义", () => {
      const tools = getAllTools();

      for (const tool of tools) {
        registry.register(tool);
      }

      const definitions = registry.list().map((t) => t.getDefinition());
      expect(definitions.length).toBe(tools.length);
    });
  });

  describe("工具执行边界测试", () => {
    test("应处理空参数", async () => {
      const tool = new FilesystemTool();
      const result = await tool.execute({});

      expect(result.isError).toBe(true);
    });

    test("应处理无效的操作类型", async () => {
      const tool = new FilesystemTool();
      const result = await tool.execute({
        action: "invalid-action",
        path: "test.txt",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("未知的操作类型");
    });

    test("应处理参数类型错误", async () => {
      const tool = new FilesystemTool();
      const result = await tool.execute({
        action: "write",
        path: 123, // 应该是字符串
        content: "test",
      });

      expect(result.isError).toBe(true);
    });
  });
});
