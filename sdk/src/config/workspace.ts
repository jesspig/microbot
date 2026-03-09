/**
 * 工作区访问控制
 */

import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import type { WorkspaceConfig } from './types';
import {
  USER_CONFIG_DIR,
  USER_KNOWLEDGE_DIR,
  USER_WORKSPACE_DIR,
} from './defaults';

// 重新导出 USER_CONFIG_DIR 供外部使用
export { USER_CONFIG_DIR } from './defaults';

/**
 * 展开路径（支持 ~ 前缀）
 */
export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

/**
 * 解析工作区路径列表
 */
export function resolveWorkspacePaths(workspaces: WorkspaceConfig[]): string[] {
  return workspaces.map(w => expandPath(w.path));
}

/** 访问控制配置 */
export interface AccessControlConfig {
  /** 工作区路径 */
  workspace?: string;
  /** 知识库路径 */
  knowledgeBase?: string;
  /** 额外允许的工作区 */
  workspaces?: WorkspaceConfig[];
}

/**
 * 验证工作区访问权限
 *
 * MicroAgent 是隔离的，只能读写指定目录内的文件：
 * - 工作区目录（默认 ~/.micro-agent/workspace）
 * - 知识库目录（默认 ~/.micro-agent/knowledge）
 * - 额外配置的工作区
 */
export function validateWorkspaceAccess(
  targetPath: string,
  config: AccessControlConfig = {}
): void {
  const normalizedTarget = resolve(expandPath(targetPath));

  // 允许访问的路径
  const allowedPaths: string[] = [
    // 工作区
    config.workspace ? expandPath(config.workspace) : USER_WORKSPACE_DIR,
    // 知识库
    config.knowledgeBase ? expandPath(config.knowledgeBase) : USER_KNOWLEDGE_DIR,
    // 额外配置的工作区
    ...(config.workspaces ? resolveWorkspacePaths(config.workspaces) : []),
  ];

  for (const allowed of allowedPaths) {
    const normalizedAllowed = resolve(allowed);
    // 精确匹配或子路径匹配
    if (normalizedTarget === normalizedAllowed) return;
    if (normalizedTarget.startsWith(normalizedAllowed + '/')) return;
    if (normalizedTarget.startsWith(normalizedAllowed + '\\')) return;
  }

  // 构建错误信息
  const allowedList = allowedPaths.map(p => '  - ' + p).join('\n');

  throw new Error(
    '工作区访问被拒绝: ' + targetPath + '\n' +
    '允许访问的目录:\n' + allowedList + '\n' +
    '如需访问其他路径，请在 settings.yaml 中配置 workspaces'
  );
}

/**
 * 检查工作区是否可访问
 */
export function canAccessWorkspace(
  targetPath: string,
  config: AccessControlConfig = {}
): boolean {
  try {
    validateWorkspaceAccess(targetPath, config);
    return true;
  } catch {
    return false;
  }
}

/** 配置文件名 */
const CONFIG_FILE_NAME = 'settings.yaml';

/**
 * 获取用户配置文件路径
 */
export function getUserConfigPath(): string {
  return resolve(USER_CONFIG_DIR, CONFIG_FILE_NAME);
}

/**
 * 创建默认用户配置
 */
export function createDefaultUserConfig(systemDefaultsDir: string): void {
  const configPath = getUserConfigPath();
  if (existsSync(configPath)) return;

  const configDir = dirname(configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // 查找模板文件
  const templatePath = resolve(systemDefaultsDir, 'settings.example.yaml');
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, 'utf-8');
    writeFileSync(configPath, template, 'utf-8');
  } else {
    writeFileSync(configPath, getMinimalConfig(), 'utf-8');
  }
}

/**
 * 获取最小配置（无模板时的备用）
 */
function getMinimalConfig(): string {
  return `# MicroAgent 配置文件
# 文档: https://micro-agent.dev/config

agents:
  models:
    # chat: ollama/qwen3  # 必填

providers:
  # ollama:
  #   baseUrl: http://localhost:11434/v1
  #   models:
  #     - qwen3
`;
}
