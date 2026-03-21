/**
 * start 命令实现（重构后）
 *
 * 此文件保留用于向后兼容，实际实现已拆分到 start/ 目录
 *
 * 模块结构：
 * - start/initializer.ts - 运行时目录初始化
 * - start/provider-setup.ts - Provider 创建和验证
 * - start/channel-setup.ts - Channel 创建
 * - start/message-handler.ts - 消息处理逻辑
 * - start/agent-service.ts - Agent 服务运行
 * - start/index.ts - 命令入口
 * - start/types.ts - 类型定义
 */

export { startCommand, showStartHelp } from "./start/index.js";
export type { StartOptions, StartResult } from "./start/types.js";
