# 阶段 4：工具系统

**依赖**: 阶段 3（存储层）  
**预计文件数**: 6  
**预计代码行数**: ~300 行

## 目标

实现工具注册表和基础工具：文件系统、Shell、Web、消息工具。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 代码即文档 | ✅ | 工具接口清晰 |
| III. 开放封闭 | ✅ | Registry 模式支持扩展 |

## 文件清单

### 1. src/tools/base.ts

**职责**: 工具基类和接口

```typescript
import type { ZodSchema } from 'zod';

/** 工具执行上下文 */
export interface ToolContext {
  channel: string;
  chatId: string;
  workspace: string;
  sendToBus: (msg: unknown) => Promise<void>;
}

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodSchema;
}

/** 工具接口 */
export interface ITool extends ToolDefinition {
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}

/** 工具基类 */
export abstract class BaseTool implements ITool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: ZodSchema;
  abstract execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}
```

**行数**: ~30 行

---

### 2. src/tools/registry.ts

**职责**: 工具注册表

```typescript
import type { ITool, ToolContext } from './base';

/**
 * 工具注册表
 * 
 * 管理所有可用工具，提供注册、查找、执行功能。
 */
export class ToolRegistry {
  /** 已注册的工具 */
  private tools = new Map<string, ITool>();

  /**
   * 注册工具
   * @param tool - 工具实例
   */
  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具已存在: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取工具
   */
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * 执行工具
   * @param name - 工具名称
   * @param input - 输入参数
   * @param ctx - 执行上下文
   */
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `错误: 未找到工具 ${name}`;
    }

    // 验证输入
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return `参数错误: ${parsed.error.message}`;
    }

    try {
      const result = await tool.execute(parsed.data, ctx);
      return this.formatResult(result);
    } catch (error) {
      return `执行错误: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** 获取所有工具定义（用于 LLM） */
  getDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }> {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /** 格式化结果 */
  private formatResult(result: unknown): string {
    if (typeof result === 'string') return result;
    return JSON.stringify(result, null, 2);
  }
}
```

**行数**: ~65 行

---

### 3. src/tools/filesystem.ts

**职责**: 文件系统工具

```typescript
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { BaseTool, type ToolContext } from './base';

/** 读取文件工具 */
export class ReadFileTool extends BaseTool {
  readonly name = 'read_file';
  readonly description = '读取文件内容';
  readonly inputSchema = z.object({
    path: z.string().describe('文件路径'),
    limit: z.number().optional().describe('最大行数'),
  });

  constructor(private allowedDir?: string) {
    super();
  }

  async execute(input: { path: string; limit?: number }, ctx: ToolContext): Promise<string> {
    const filePath = this.resolvePath(input.path, ctx.workspace);
    if (!existsSync(filePath)) {
      return `错误: 文件不存在 ${input.path}`;
    }
    
    const content = readFileSync(filePath, 'utf-8');
    if (input.limit) {
      const lines = content.split('\n').slice(0, input.limit);
      return lines.join('\n');
    }
    return content;
  }

  private resolvePath(path: string, workspace: string): string {
    return isAbsolute(path) ? path : resolve(workspace, path);
  }
}

/** 写入文件工具 */
export class WriteFileTool extends BaseTool {
  readonly name = 'write_file';
  readonly description = '写入文件内容';
  readonly inputSchema = z.object({
    path: z.string().describe('文件路径'),
    content: z.string().describe('文件内容'),
  });

  async execute(input: { path: string; content: string }, ctx: ToolContext): Promise<string> {
    const filePath = isAbsolute(input.path) ? input.path : resolve(ctx.workspace, input.path);
    writeFileSync(filePath, input.content, 'utf-8');
    return `已写入 ${input.path}`;
  }
}

/** 列出目录工具 */
export class ListDirTool extends BaseTool {
  readonly name = 'list_dir';
  readonly description = '列出目录内容';
  readonly inputSchema = z.object({
    path: z.string().describe('目录路径'),
  });

  async execute(input: { path: string }, ctx: ToolContext): Promise<string> {
    const dirPath = isAbsolute(input.path) ? input.path : resolve(ctx.workspace, input.path);
    if (!existsSync(dirPath)) {
      return `错误: 目录不存在 ${input.path}`;
    }

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const lines = entries.map(e => {
      const isDir = e.isDirectory();
      return `${isDir ? 'DIR' : 'FILE'} ${e.name}`;
    });
    return lines.join('\n');
  }
}
```

**行数**: ~75 行

---

### 4. src/tools/shell.ts

**职责**: Shell 命令执行工具

```typescript
import { z } from 'zod';
import { $ } from 'bun';
import { BaseTool, type ToolContext } from './base';

/** Shell 执行工具 */
export class ExecTool extends BaseTool {
  readonly name = 'exec';
  readonly description = '执行 Shell 命令';
  readonly inputSchema = z.object({
    command: z.string().describe('命令'),
    timeout: z.number().default(30000).describe('超时时间（毫秒）'),
  });

  constructor(
    private workingDir: string,
    private defaultTimeout: number = 30000
  ) {
    super();
  }

  async execute(input: { command: string; timeout?: number }): Promise<string> {
    const timeout = input.timeout ?? this.defaultTimeout;

    try {
      const result = await $`${input.command}`.cwd(this.workingDir).timeout(timeout);
      return result.stdout.toString() || '(无输出)';
    } catch (error) {
      if (error instanceof Error) {
        return `执行失败: ${error.message}`;
      }
      return `执行失败: ${String(error)}`;
    }
  }
}
```

**行数**: ~35 行

---

### 5. src/tools/web.ts

**职责**: Web 搜索和获取工具

```typescript
import { z } from 'zod';
import { BaseTool, type ToolContext } from './base';

/** Web 搜索工具 */
export class WebSearchTool extends BaseTool {
  readonly name = 'web_search';
  readonly description = 'Web 搜索（需要 Brave API Key）';
  readonly inputSchema = z.object({
    query: z.string().describe('搜索关键词'),
    maxResults: z.number().default(5).describe('最大结果数'),
  });

  constructor(private apiKey?: string) {
    super();
  }

  async execute(input: { query: string; maxResults?: number }): Promise<string> {
    if (!this.apiKey) {
      return '错误: 未配置 Brave API Key';
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', input.query);
    url.searchParams.set('count', String(input.maxResults ?? 5));

    const response = await fetch(url.toString(), {
      headers: { 'X-Subscription-Token': this.apiKey },
    });

    const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    const results = data.web?.results ?? [];

    return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join('\n\n');
  }
}

/** Web 获取工具 */
export class WebFetchTool extends BaseTool {
  readonly name = 'web_fetch';
  readonly description = '获取网页内容';
  readonly inputSchema = z.object({
    url: z.string().describe('网页 URL'),
  });

  async execute(input: { url: string }): Promise<string> {
    try {
      const response = await fetch(input.url);
      const html = await response.text();
      // 简单提取文本（实际项目可用 cheerio）
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
      return text;
    } catch (error) {
      return `获取失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
```

**行数**: ~55 行

---

### 6. src/tools/message.ts

**职责**: 消息发送工具

```typescript
import { z } from 'zod';
import { BaseTool, type ToolContext } from './base';

/** 消息工具 */
export class MessageTool extends BaseTool {
  readonly name = 'message';
  readonly description = '发送消息到指定通道';
  readonly inputSchema = z.object({
    channel: z.string().describe('通道名称'),
    chatId: z.string().describe('聊天 ID'),
    content: z.string().describe('消息内容'),
  });

  private currentChannel?: string;
  private currentChatId?: string;

  /** 设置当前上下文 */
  setContext(channel: string, chatId: string): void {
    this.currentChannel = channel;
    this.currentChatId = chatId;
  }

  async execute(input: { channel: string; chatId: string; content: string }, ctx: ToolContext): Promise<string> {
    await ctx.sendToBus({
      channel: input.channel,
      chatId: input.chatId,
      content: input.content,
    });
    return `消息已发送到 ${input.channel}:${input.chatId}`;
  }
}
```

**行数**: ~35 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 定义工具基类 | `src/tools/base.ts` | ~30 |
| 2 | 实现工具注册表 | `src/tools/registry.ts` | ~65 |
| 3 | 实现文件系统工具 | `src/tools/filesystem.ts` | ~75 |
| 4 | 实现 Shell 工具 | `src/tools/shell.ts` | ~35 |
| 5 | 实现 Web 工具 | `src/tools/web.ts` | ~55 |
| 6 | 实现消息工具 | `src/tools/message.ts` | ~35 |

## 验收标准

- [ ] 工具注册表可以注册和执行工具
- [ ] 文件工具支持读写和列表
- [ ] Shell 工具支持超时配置
- [ ] Web 工具支持搜索和获取
- [ ] 消息工具可以发送消息

## 下一步

完成本阶段后，进入 [阶段 5：LLM Provider](./phase-5-provider.md)
