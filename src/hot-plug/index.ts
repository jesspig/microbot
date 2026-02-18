/**
 * 热插拔模块入口
 * 
 * 导出所有热插拔相关类型和类：
 * ```typescript
 * import { HotPlugManager, HotPluggable, ExtensionMeta } from '@microbot/sdk/hot-plug';
 * ```
 */

// 类型定义
export * from './types';

// 组件
export { ExtensionWatcher } from './watcher';
export { ExtensionLoader } from './loader';
export { ExtensionRegistry } from './registry';
export { HotPlugManager } from './manager';
