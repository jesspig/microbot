/**
 * 系统提示词构建模块
 *
 * 负责构建系统提示词
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import type { SkillsLoader } from '@micro-agent/sdk';

/** 用户级配置目录 */
const USER_CONFIG_DIR = resolve(homedir(), '.micro-agent');

/**
 * 获取模板路径
 */
function getTemplatesPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '../../../../templates/prompts/agent');
}

/**
 * 确保用户级配置文件存在
 *
 * 首次启动时创建默认的 SOUL.md、USER.md、AGENTS.md
 */
export function ensureUserConfigFiles(): { created: string[] } {
  const created: string[] = [];

  // 确保用户配置目录存在
  if (!existsSync(USER_CONFIG_DIR)) {
    mkdirSync(USER_CONFIG_DIR, { recursive: true });
  }

  const templatesPath = getTemplatesPath();
  const files = [
    { name: 'SOUL.md', template: 'soul.md' },
    { name: 'USER.md', template: 'user.md' },
    { name: 'AGENTS.md', template: 'agents.md' },
  ];

  for (const file of files) {
    const targetPath = resolve(USER_CONFIG_DIR, file.name);
    const templatePath = resolve(templatesPath, file.template);

    // 文件不存在且模板存在时创建
    if (!existsSync(targetPath) && existsSync(templatePath)) {
      copyFileSync(templatePath, targetPath);
      created.push(file.name);
    }
  }

  return { created };
}

/**
 * 加载系统提示词
 *
 * 优先级：用户级 ~/.micro-agent/ > workspace/
 */
export function loadSystemPromptFromUserConfig(workspace: string): string {
  const parts: string[] = [];

  // 1. 加载 SOUL.md（身份）
  const soulPaths = [
    resolve(USER_CONFIG_DIR, 'SOUL.md'),
    resolve(workspace, 'SOUL.md'),
  ];

  for (const soulPath of soulPaths) {
    if (existsSync(soulPath)) {
      parts.push(readFileSync(soulPath, 'utf-8'));
      break;
    }
  }

  // 2. 加载 USER.md（用户信息）
  const userPaths = [
    resolve(USER_CONFIG_DIR, 'USER.md'),
    resolve(workspace, 'USER.md'),
  ];

  for (const userPath of userPaths) {
    if (existsSync(userPath)) {
      parts.push('\n\n---\n\n' + readFileSync(userPath, 'utf-8'));
      break;
    }
  }

  // 3. 加载 AGENTS.md（行为指南）
  const agentsPaths = [
    resolve(USER_CONFIG_DIR, 'AGENTS.md'),
    resolve(workspace, 'AGENTS.md'),
  ];

  for (const agentsPath of agentsPaths) {
    if (existsSync(agentsPath)) {
      parts.push('\n\n---\n\n' + readFileSync(agentsPath, 'utf-8'));
      break;
    }
  }

  if (parts.length > 0) {
    return parts.join('');
  }

  // 默认提示词
  return '你是一个有帮助的 AI 助手。';
}

/**
 * 加载系统提示词（包含技能信息）
 */
export function loadSystemPrompt(
  workspace: string,
  skillsLoader: SkillsLoader | null
): string {
  const basePrompt = loadSystemPromptFromUserConfig(workspace);
  const parts: string[] = [];

  parts.push(buildPathExplanation(workspace));
  appendAlwaysSkills(parts, skillsLoader);
  appendSkillsSummary(parts, skillsLoader);

  if (parts.length > 0) {
    return basePrompt + '\n\n---\n\n' + parts.join('\n\n---\n\n');
  }

  return basePrompt;
}

/**
 * 构建系统路径说明
 */
function buildPathExplanation(workspace: string): string {
  return `# 系统路径说明

## 可访问目录（使用文件工具读写）

| 路径 | 用途 | 说明 |
|------|------|------|
| \`\${workspace}\` | 工作区 | 用户项目文件，主要工作目录 |
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

## 知识库查询

用户询问知识库内容时，系统会自动检索相关文档并注入上下文，**无需手动读取文件**。

### 重要：禁止使用 web_fetch 读取本地文件

- **禁止**：使用 \`web_fetch\` 工具读取本地 PDF、文档
- **正确**：如果需要了解文档详细内容，请从检索到的记忆上下文中获取
- 如果记忆中没有相关内容，请告知用户"知识库中没有找到相关内容"或建议用户上传文档`;
}

/**
 * 添加 Always 技能内容
 */
function appendAlwaysSkills(parts: string[], skillsLoader: SkillsLoader | null): void {
  if (!skillsLoader || skillsLoader.count === 0) return;

  const alwaysContent = skillsLoader.buildAlwaysSkillsContent();
  if (alwaysContent) {
    parts.push(alwaysContent);
  }
}

/**
 * 添加技能摘要内容
 */
function appendSkillsSummary(parts: string[], skillsLoader: SkillsLoader | null): void {
  if (!skillsLoader || skillsLoader.count === 0) return;

  const skillsSummary = skillsLoader.buildSkillsSummary();
  if (skillsSummary) {
    parts.push(`# 技能

以下技能可以扩展你的能力。

**使用规则：**
1. 当用户请求与某个技能的 description 关键词匹配时（如"创建XX技能"、"获取天气"等），必须先使用 \`read_file\` 读取该技能的完整内容
2. 读取 location 路径下的 SKILL.md 文件
3. 按照 SKILL.md 中的指导执行操作，而不是直接写代码

\${skillsSummary}`);
  }
}