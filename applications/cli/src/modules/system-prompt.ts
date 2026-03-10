/**
 * 系统提示词构建模块
 *
 * 提示词分为两类：
 * - 系统级（不可修改）：system.md - 从模板目录加载
 * - 用户级（可修改）：SOUL.md, USER.md, AGENTS.md - 从 ~/.micro-agent/ 加载
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, hostname, platform, arch, release, tmpdir, totalmem, cpus, userInfo } from 'os';
import { cwd } from 'process';

/** 用户级配置目录 */
const USER_CONFIG_DIR = resolve(homedir(), '.micro-agent');

// ============================================================================
// 系统信息收集
// ============================================================================

/**
 * 获取系统信息
 *
 * 收集静态的操作系统、硬件、环境信息，帮助 Agent 了解当前环境。
 * 动态信息（CPU/内存/磁盘占用）请使用 sysinfo 技能实时获取。
 *
 * 注意：不使用缓存，确保每次调用都获取当前环境的正确信息
 */
export function getSystemInfo(): string {

  const lines: string[] = [];

  // 1. 操作系统信息
  const platformMap: Record<string, string> = {
    'darwin': 'macOS',
    'win32': 'Windows',
    'linux': 'Linux',
  };
  const osName = platformMap[platform()] || platform();

  lines.push('## 操作系统');
  lines.push(`- 平台: ${osName}`);
  lines.push(`- 架构: ${arch()}`);
  lines.push(`- 内核版本: ${release()}`);
  lines.push(`- 主机名: ${hostname()}`);

  // 2. 硬件信息（静态）
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model || '未知';
  const cpuCores = cpuList.length;
  const totalMemGB = (totalmem() / 1024 / 1024 / 1024).toFixed(1);

  lines.push('');
  lines.push('## 硬件');
  lines.push(`- CPU: ${cpuModel} (${cpuCores} 核心)`);
  lines.push(`- 内存: ${totalMemGB}GB`);
  lines.push(`- 提示: 使用 sysinfo 技能获取实时占用信息`);

  // 3. 环境信息
  lines.push('');
  lines.push('## 环境');
  lines.push(`- 当前用户: ${userInfo().username}`);
  lines.push(`- 家目录: ${homedir()}`);
  lines.push(`- 临时目录: ${tmpdir()}`);
  lines.push(`- 工作目录: ${cwd()}`);

  // 4. 可用命令（检测常用工具）
  lines.push('');
  lines.push('## 可用工具');

  const tools: { name: string; command: string; description: string }[] = [];

  // 包管理器
  if (hasCommand('bun')) tools.push({ name: 'Bun', command: 'bun', description: 'JavaScript 运行时和包管理器' });
  if (hasCommand('node')) tools.push({ name: 'Node.js', command: 'node', description: 'JavaScript 运行时' });
  if (hasCommand('npm')) tools.push({ name: 'npm', command: 'npm', description: 'Node.js 包管理器' });
  if (hasCommand('pnpm')) tools.push({ name: 'pnpm', command: 'pnpm', description: '快速磁盘节省型包管理器' });
  if (hasCommand('yarn')) tools.push({ name: 'Yarn', command: 'yarn', description: 'Node.js 包管理器' });

  // 编程语言
  if (hasCommand('python3')) tools.push({ name: 'Python 3', command: 'python3', description: 'Python 编程语言' });
  if (hasCommand('python')) tools.push({ name: 'Python', command: 'python', description: 'Python 编程语言' });
  if (hasCommand('rustc')) tools.push({ name: 'Rust', command: 'rustc', description: 'Rust 编程语言' });
  if (hasCommand('go')) tools.push({ name: 'Go', command: 'go', description: 'Go 编程语言' });

  // 常用工具
  if (hasCommand('git')) tools.push({ name: 'Git', command: 'git', description: '版本控制' });
  if (hasCommand('curl')) tools.push({ name: 'curl', command: 'curl', description: 'HTTP 客户端' });
  if (hasCommand('wget')) tools.push({ name: 'wget', command: 'wget', description: '文件下载' });
  if (hasCommand('docker')) tools.push({ name: 'Docker', command: 'docker', description: '容器运行时' });
  if (hasCommand('ffmpeg')) tools.push({ name: 'FFmpeg', command: 'ffmpeg', description: '音视频处理' });

  // Shell
  const shell = process.env.SHELL || process.env.ComSpec || '/bin/sh';
  const shellName = shell.split('/').pop() || shell;
  tools.push({ name: 'Shell', command: shellName, description: `命令行终端 (${shell})` });

  if (tools.length > 0) {
    for (const tool of tools) {
      lines.push(`- ${tool.name} (\`${tool.command}\`): ${tool.description}`);
    }
  } else {
    lines.push('- Shell 环境');
  }

  // 5. 包管理建议
  lines.push('');
  lines.push('## 命令建议');
  lines.push('- 安装包: 优先使用 `bun add`，其次是 `npm install`');
  lines.push('- 运行脚本: 优先使用 `bun run`，其次是 `npm run`');
  lines.push('- 执行 TypeScript: 直接 `bun file.ts`，无需编译');
  lines.push('- 执行 Python: 使用 `python3` 或 `python`');

  // 6. 平台特定规则（从模板文件加载）
  const platformPrompt = loadPlatformPrompt();
  if (platformPrompt) {
    lines.unshift('');
    lines.unshift('');
    lines.unshift(platformPrompt);
  }

  return lines.join('\n');
}

/**
 * 检查命令是否可用（跨平台）
 */
function hasCommand(cmd: string): boolean {
  try {
    // Windows 使用 where，Unix 使用 which
    const checker = platform() === 'win32' ? 'where' : 'which';
    const result = Bun.spawnSync([checker, cmd], { timeout: 1000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 加载平台特定提示词
 *
 * 从模板目录加载 windows.md 或 unix.md
 */
function loadPlatformPrompt(): string {
  const templatesPath = getTemplatesPath();
  const platformFile = platform() === 'win32' ? 'windows.md' : 'unix.md';
  const platformPath = resolve(templatesPath, platformFile);

  if (existsSync(platformPath)) {
    return readFileSync(platformPath, 'utf-8');
  }

  return '';
}

/** 用户级提示词文件（可修改） */
const USER_PROMPT_FILES = [
  { file: 'SOUL.md', description: '身份定义' },
  { file: 'USER.md', description: '用户信息' },
  { file: 'AGENTS.md', description: '行为准则' },
] as const;

/**
 * 获取模板目录路径
 */
function getTemplatesPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // applications/cli/src/modules -> applications/cli/src/templates/prompts
  return resolve(currentDir, '../templates/prompts');
}

/**
 * 确保用户级配置文件存在
 *
 * 首次启动时从模板复制 SOUL.md、USER.md、AGENTS.md 到 ~/.micro-agent/
 * system.md 不会被复制，始终从模板目录加载
 */
export function ensureUserConfigFiles(): { created: string[]; existed: string[] } {
  const created: string[] = [];
  const existed: string[] = [];

  // 确保用户配置目录存在
  if (!existsSync(USER_CONFIG_DIR)) {
    mkdirSync(USER_CONFIG_DIR, { recursive: true });
  }

  const templatesPath = resolve(getTemplatesPath(), 'agent');

  for (const item of USER_PROMPT_FILES) {
    const targetPath = resolve(USER_CONFIG_DIR, item.file);
    const templatePath = resolve(templatesPath, item.file);

    if (existsSync(targetPath)) {
      existed.push(item.file);
    } else if (existsSync(templatePath)) {
      copyFileSync(templatePath, targetPath);
      created.push(item.file);
    }
  }

  return { created, existed };
}

/**
 * 获取用户级提示词文件状态
 */
export function getSystemPromptFiles(): { name: string; path: string; exists: boolean; description: string }[] {
  return USER_PROMPT_FILES.map((item) => {
    const path = resolve(USER_CONFIG_DIR, item.file);
    return {
      name: item.file,
      path,
      exists: existsSync(path),
      description: item.description,
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
 * 加载系统级提示词（不可修改）
 *
 * 从模板目录加载 system.md
 */
export function loadSystemPromptTemplate(workspace: string): string {
  const templatesPath = getTemplatesPath();
  const systemPath = resolve(templatesPath, 'system.md');

  if (existsSync(systemPath)) {
    let content = readFileSync(systemPath, 'utf-8');
    // 替换工作区占位符
    content = content.replace(/{workspace}/g, workspace);
    return content;
  }

  // 回退：使用默认内容
  return `# 系统路径说明

工作区: ${workspace}
`;
}

/**
 * 加载用户级提示词（可修改）
 *
 * 优先级：用户级 ~/.micro-agent/ > workspace/
 */
export function loadUserPrompts(workspace?: string): string {
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

  return '';
}

/**
 * 加载完整系统提示词
 *
 * 组合顺序：
 * 1. 用户级提示词（SOUL.md, USER.md, AGENTS.md）
 * 2. 系统级提示词（system.md）
 * 3. 系统信息（操作系统、硬件、可用工具）
 * 4. Always 技能内容
 * 5. 技能摘要
 *
 * @param workspace 工作区路径
 * @param skillsLoader 技能加载器（可选）
 */
export function loadSystemPrompt(
  workspace: string,
  skillsLoader: {
    buildSkillsSummary: () => string;
    buildAlwaysSkillsContent: () => string;
    getAlwaysSkillNames: () => string[];
    getOnDemandSkills: () => Array<{ name: string; description: string; path: string }>;
    count: number;
  } | null
): string {
  const parts: string[] = [];

  // 1. 用户级提示词（可修改）
  const userPrompts = loadUserPrompts(workspace);
  if (userPrompts) {
    parts.push(userPrompts);
  }

  // 2. 系统级提示词（不可修改）
  const systemPrompt = loadSystemPromptTemplate(workspace);
  if (systemPrompt) {
    parts.push(systemPrompt);
  }

  // 3. 系统信息
  const systemInfo = getSystemInfo();
  if (systemInfo) {
    parts.push(`# 系统环境信息\n\n${systemInfo}`);
  }

  // 4. Always 技能内容（直接注入上下文）
  if (skillsLoader && skillsLoader.count > 0) {
    const alwaysContent = skillsLoader.buildAlwaysSkillsContent();
    if (alwaysContent) {
      parts.push(alwaysContent);
    }
  }

  // 5. 技能摘要
  if (skillsLoader && skillsLoader.count > 0) {
    const alwaysSkillNames = skillsLoader.getAlwaysSkillNames();
    const onDemandSkills = skillsLoader.getOnDemandSkills();

    // 构建 always 技能说明
    if (alwaysSkillNames.length > 0) {
      parts.push(`# 已加载技能

以下技能已直接加载到上下文中，可以直接使用：

${alwaysSkillNames.map(name => `- **${name}**：指令已注入，直接按照技能说明执行即可`).join('\n')}`);
    }

    // 构建按需加载技能说明
    if (onDemandSkills.length > 0) {
      const onDemandSummary = onDemandSkills
        .map(s => `| ${s.name} | ${s.description || '-'} |`)
        .join('\n');

      parts.push(`# 可用技能

以下技能可以扩展你的能力，需要时按需加载。

**使用规则：**
1. 当用户请求与某个技能的 description 关键词匹配时，先使用 \`read\` 工具读取该技能的完整内容
2. 读取路径下的 SKILL.md 文件：\`read({ path: "技能路径/SKILL.md" })\`
3. 按照 SKILL.md 中的指导执行操作

| 名称 | 描述 |
|------|------|
${onDemandSummary}

**技能位置：**
${onDemandSkills.map(s => `- \`${s.name}\`: ${s.path}`).join('\n')}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 获取用户配置目录路径
 */
export function getUserConfigDir(): string {
  return USER_CONFIG_DIR;
}