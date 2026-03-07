/**
 * 插件系统模块入口
 */

// Types
export * from './types';

// Registry
export { ExtensionRegistry, createExtensionRegistry } from './registry';
export type { RegistryConfig } from './registry';

// Discovery
export { ExtensionDiscovery, createExtensionDiscovery } from './discovery';

// Loader
export { ExtensionLoader, createExtensionLoader } from './loader';
export type { LoaderConfig, LoaderState } from './loader';

// Hot Reload
export { HotReloadManager, createHotReloadManager } from './hot-reload';
export type { HotReloadConfig } from './hot-reload';
