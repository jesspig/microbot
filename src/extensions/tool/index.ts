/**
 * Tool 扩展入口
 * 
 * 导出所有工具模块，支持独立导入：
 * ```typescript
 * import { ToolRegistry, FilesystemTool } from '@microbot/sdk/extensions/tool';
 * ```
 */

// 基础类型和接口
export { type Tool, type ToolDefinition, type ToolContext } from './base';

// 工具注册表
export { ToolRegistry } from './registry';

// 文件系统工具
export { ReadFileTool, WriteFileTool, ListDirTool } from './filesystem';

// Shell 工具
export { ExecTool } from './shell';

// Web 工具
export { WebSearchTool, WebFetchTool } from './web';

// 消息工具
export { MessageTool } from './message';
