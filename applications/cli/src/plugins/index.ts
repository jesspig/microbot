/**
 * 用户插件系统入口
 *
 * 导出插件系统的所有公共 API
 */

export * from './types';
export * from './loader';
export * from './registry';

export { discoverPlugins, loadPlugin, getPluginsDir, getPluginDir } from './loader';
export { pluginRegistry } from './registry';
