/**
 * 文件系统工具扩展
 *
 * 提供文件读取、写入、目录列表功能。
 * 安全限制：只允许访问工作区目录，禁止访问 MicroAgent 安装目录。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, isAbsolute, normalize } from 'path';
import { defineTool } from '@micro-agent/sdk';
import type { Tool, JSONSchema, ToolContext } from '@micro-agent/types';

/** 敏感目录关键词（用于检测 MicroAgent 安装目录） */
const SENSITIVE_PATTERNS = [
  'micro-agent',
  '@micro-agent',
  'node_modules',
  '.micro-agent',
];

/**
 * 验证路径是否允许访问
 * @param targetPath 目标路径（已解析为绝对路径）
 * @param workspace 工作区路径
 * @returns 验证结果，失败时返回错误信息
 */
function validatePathAccess(targetPath: string, workspace: string): { allowed: boolean; error?: string } {
  const normalizedTarget = normalize(targetPath).toLowerCase();
  const normalizedWorkspace = normalize(workspace).toLowerCase();

  // 1. 检查是否在工作区内
  if (!normalizedTarget.startsWith(normalizedWorkspace)) {
    return {
      allowed: false,
      error: `访问被拒绝：路径必须在 workspace 内 (${workspace})`,
    };
  }

  // 2. 检查是否访问敏感目录（MicroAgent 安装目录）
  for (const pattern of SENSITIVE_PATTERNS) {
    // 检查路径中是否包含敏感关键词
    if (normalizedTarget.includes(pattern.toLowerCase())) {
      // 如果是工作区内的 .micro-agent 配置目录，允许访问
      if (pattern === '.micro-agent' && normalizedTarget.includes(normalizedWorkspace)) {
        continue;
      }
      return {
        allowed: false,
        error: `访问被拒绝：禁止访问系统目录 (${pattern})`,
      };
    }
  }

  return { allowed: true };
}

/** 读取文件工具 */
export const ReadFileTool = defineTool({
  name: 'read_file',
  description: '读取文件内容（仅限 workspace 目录）',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（相对 workspace 或绝对路径，但必须在 workspace 内）' },
      limit: { type: 'number', description: '最大行数' },
    },
    required: ['path'],
  } satisfies JSONSchema,
  execute: async (input: unknown, ctx: ToolContext) => {
    // 兼容多种输入格式
    let path: string;
    let limit: number | undefined;

    if (typeof input === 'string') {
      path = input;
    } else if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      path = String(obj.path ?? obj.action_input ?? '');
      if (typeof obj.limit === 'number') limit = obj.limit;
    } else {
      return '错误: 无效的输入格式';
    }

    const filePath = isAbsolute(path) ? path : resolve(ctx.workspace, path);

    // 验证路径访问权限
    const validation = validatePathAccess(filePath, ctx.workspace);
    if (!validation.allowed) {
      return `错误: ${validation.error}`;
    }

    if (!existsSync(filePath)) {
      return `错误: 文件不存在 ${path}`;
    }

    const content = readFileSync(filePath, 'utf-8');

    if (limit && limit > 0) {
      const lines = content.split('\n').slice(0, limit);
      return lines.join('\n');
    }

    return content;
  },
});

/** 写入文件工具 */
export const WriteFileTool = defineTool({
  name: 'write_file',
  description: '写入文件内容（仅限 workspace 目录）',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（相对 workspace 或绝对路径，但必须在 workspace 内）' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  } satisfies JSONSchema,
  execute: async (input: { path: string; content: string }, ctx: ToolContext) => {
    const filePath = isAbsolute(input.path) ? input.path : resolve(ctx.workspace, input.path);

    // 验证路径访问权限
    const validation = validatePathAccess(filePath, ctx.workspace);
    if (!validation.allowed) {
      return `错误: ${validation.error}`;
    }

    writeFileSync(filePath, input.content, 'utf-8');
    return `已写入 ${input.path}`;
  },
});

/** 列出目录工具 */
export const ListDirTool = defineTool({
  name: 'list_dir',
  description: '列出目录内容（仅限 workspace 目录）',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径（相对 workspace 或绝对路径，但必须在 workspace 内）' },
    },
    required: ['path'],
  } satisfies JSONSchema,
  execute: async (input: unknown, ctx: ToolContext) => {
    // 兼容多种输入格式
    let path: string;
    if (typeof input === 'string') {
      path = input;
    } else if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      path = String(obj.path ?? obj.action_input ?? '');
    } else {
      return '错误: 无效的输入格式';
    }

    const dirPath = isAbsolute(path) ? path : resolve(ctx.workspace, path);

    // 验证路径访问权限
    const validation = validatePathAccess(dirPath, ctx.workspace);
    if (!validation.allowed) {
      return `错误: ${validation.error}`;
    }

    if (!existsSync(dirPath)) {
      return `错误: 目录不存在 ${path}`;
    }

    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return `错误: ${path} 不是目录`;
    }

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const lines = entries.map(e => {
      const isDir = e.isDirectory();
      return `${isDir ? 'DIR' : 'FILE'} ${e.name}`;
    });

    return lines.length > 0 ? lines.join('\n') : '(空目录)';
  },
});

/** 文件系统工具类数组（用于兼容旧代码） */
export const filesystemTools: Tool[] = [ReadFileTool, WriteFileTool, ListDirTool];
