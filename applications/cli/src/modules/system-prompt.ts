/**
 * 系统提示词构建模块
 *
 * 负责构建和管理系统提示词
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

/** 用户级配置目录 */
const USER_CONFIG_DIR = resolve(homedir(), '.micro-agent');

/** 系统提示词文件列表 */
const PROMPT_FILES = [
  { name: 'SOUL.md', description: '身份定义' },
  { name: 'USER.md', description: '用户信息' },
  { name: 'AGENTS.md', description: '行为准则' },
] as const;

/** 默认提示词模板 */
const DEFAULT_PROMPTS: Record<string, string> = {
  'SOUL.md': `# 身份定义

你是一个智能助手，具备以下特质：

- 专业、友好、高效
- 善于理解用户意图
- 提供准确、有帮助的回答
- 在不确定时会主动询问澄清

## 核心能力

- 代码编写与调试
- 文档撰写与整理
- 问题分析与解决
- 任务规划与执行
`,
  'USER.md': `# 用户信息

请在这里填写关于你的信息，帮助我更好地为你服务：

- 你的工作领域：
- 你的技术栈：
- 你的偏好：
- 其他重要信息：
`,
  'AGENTS.md': `# 行为准则

## 基本原则

1. **准确性优先**：确保提供的信息准确可靠
2. **用户友好**：用清晰易懂的方式表达
3. **主动沟通**：遇到不确定的问题主动询问
4. **持续改进**：从反馈中学习和改进

## 工作流程

1. 理解用户需求
2. 制定执行计划
3. 分步实施
4. 验证结果
5. 总结反馈
`,
};

/**
 * 获取模板路径
 */
function getTemplatesPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // 尝试多个可能的模板路径
  const possiblePaths = [
    resolve(currentDir, '../../../../templates/prompts'),
    resolve(currentDir, '../../../../../templates/prompts'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return possiblePaths[0];
}

/**
 * 确保用户级配置文件存在
 *
 * 首次启动时创建默认的 SOUL.md、USER.md、AGENTS.md
 */
export function ensureUserConfigFiles(): { created: string[]; existed: string[] } {
  const created: string[] = [];
  const existed: string[] = [];

  // 确保用户配置目录存在
  if (!existsSync(USER_CONFIG_DIR)) {
    mkdirSync(USER_CONFIG_DIR, { recursive: true });
  }

  for (const file of PROMPT_FILES) {
    const targetPath = resolve(USER_CONFIG_DIR, file.name);

    if (existsSync(targetPath)) {
      existed.push(file.name);
    } else {
      // 使用默认模板创建文件
      writeFileSync(targetPath, DEFAULT_PROMPTS[file.name] || '', 'utf-8');
      created.push(file.name);
    }
  }

  return { created, existed };
}

/**
 * 获取系统提示词文件状态
 */
export function getSystemPromptFiles(): { name: string; path: string; exists: boolean; description: string }[] {
  return PROMPT_FILES.map((file) => {
    const path = resolve(USER_CONFIG_DIR, file.name);
    return {
      name: file.name,
      path,
      exists: existsSync(path),
      description: file.description,
    };
  });
}

/**
 * 加载单个提示词文件
 */
function loadPromptFile(name: string, searchPaths: string[]): string | null {
  for (const basePath of searchPaths) {
    const filePath = resolve(basePath, name);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
  }
  return null;
}

/**
 * 加载系统提示词（从用户配置）
 *
 * 优先级：用户级 ~/.micro-agent/ > workspace/
 */
export function loadSystemPromptFromUserConfig(workspace?: string): string {
  const searchPaths = [USER_CONFIG_DIR];
  if (workspace) {
    searchPaths.push(workspace);
  }

  const parts: string[] = [];

  // 1. 加载 SOUL.md（身份）
  const soulContent = loadPromptFile('SOUL.md', searchPaths);
  if (soulContent) {
    parts.push(soulContent);
  }

  // 2. 加载 USER.md（用户信息）
  const userContent = loadPromptFile('USER.md', searchPaths);
  if (userContent) {
    parts.push('\n\n---\n\n' + userContent);
  }

  // 3. 加载 AGENTS.md（行为准则）
  const agentsContent = loadPromptFile('AGENTS.md', searchPaths);
  if (agentsContent) {
    parts.push('\n\n---\n\n' + agentsContent);
  }

  if (parts.length > 0) {
    return parts.join('');
  }

  // 默认提示词
  return '你是一个有帮助的 AI 助手。';
}

/**
 * 构建系统路径说明
 */
function buildPathExplanation(workspace: string): string {
  return `# 系统路径说明

## 可访问目录（使用文件工具读写）

| 路径 | 用途 | 说明 |
|------|------|------|
| \`${workspace}\` | 工作区 | 用户项目文件，主要工作目录 |
| \`~/.micro-agent/workspace\` | 默认工作区 | 未指定时的默认工作区 |
| \`~/.micro-agent/knowledge/\` | 知识库 | 上传的文档存储位置 |
| \`~/.micro-agent/SOUL.md\` | 身份定义 | 定义你的角色和人格 |
| \`~/.micro-agent/USER.md\` | 用户信息 | 关于用户的重要信息 |
| \`~/.micro-agent/AGENTS.md\` | 行为准则 | 你的行为规范和原则 |
| \`~/.micro-agent/settings.yaml\` | 系统配置 | 模型、通道等配置 |

## 文件工具使用规则

1. 路径相对于工作区：\`read_file("file.txt")\` 或 \`list_dir(".")\`
2. 子目录使用相对路径：\`read_file("src/index.ts")\`
3. 访问系统目录使用绝对路径或 ~ 开头：\`read_file("~/.micro-agent/USER.md")\`
`;
}

/**
 * 加载系统提示词（完整版本）
 *
 * @param workspace 工作区路径
 * @param skillsInfo 技能信息（可选）
 */
export function loadSystemPrompt(
  workspace: string,
  skillsInfo?: { names: string[]; summary?: string }
): string {
  const basePrompt = loadSystemPromptFromUserConfig(workspace);
  const parts: string[] = [];

  // 添加路径说明
  parts.push(buildPathExplanation(workspace));

  // 添加技能摘要
  if (skillsInfo && skillsInfo.names.length > 0) {
    const skillsSection = `# 可用技能

以下技能可以扩展你的能力：

${skillsInfo.names.map((name) => `- ${name}`).join('\n')}

${skillsInfo.summary || ''}
`;
    parts.push(skillsSection);
  }

  if (parts.length > 0) {
    return basePrompt + '\n\n---\n\n' + parts.join('\n\n---\n\n');
  }

  return basePrompt;
}

/**
 * 获取用户配置目录路径
 */
export function getUserConfigDir(): string {
  return USER_CONFIG_DIR;
}
