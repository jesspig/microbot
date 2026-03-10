/**
 * 插件加载器
 *
 * 负责发现和加载用户插件
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { UserPlugin, PluginManifest } from './types';

/** 用户插件目录 */
const PLUGINS_DIR = join(homedir(), '.micro-agent', 'extensions');

/**
 * 发现所有可用的插件清单
 */
export async function discoverPlugins(): Promise<PluginManifest[]> {
  if (!existsSync(PLUGINS_DIR)) {
    return [];
  }

  const manifests: PluginManifest[] = [];
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(PLUGINS_DIR, entry.name, 'plugin.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const content = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;
      manifests.push(manifest);
    } catch (error) {
      console.warn(`Failed to load plugin manifest: ${entry.name}`, error);
    }
  }

  return manifests;
}

/**
 * 加载插件模块
 */
export async function loadPlugin(manifest: PluginManifest): Promise<UserPlugin | null> {
  const pluginDir = join(PLUGINS_DIR, manifest.id);
  const mainPath = join(pluginDir, manifest.main);

  try {
    const module = await import(mainPath);
    return module.default || module.plugin;
  } catch (error) {
    console.error(`Failed to load plugin: ${manifest.id}`, error);
    return null;
  }
}

/**
 * 获取插件目录路径
 */
export function getPluginsDir(): string {
  return PLUGINS_DIR;
}

/**
 * 获取单个插件的目录路径
 */
export function getPluginDir(pluginId: string): string {
  return join(PLUGINS_DIR, pluginId);
}
