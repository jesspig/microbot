/**
 * Builder 模块导出
 *
 * 提供 Agent 构建器和相关组件的统一导出
 */

// 主要导出
export { AgentBuilder, createAgent, initRuntimeDirectories } from "./agent-builder.js";
export type { AgentBuildResult } from "./agent-builder.js";

// 专职组件导出
export { ConfigManager } from "./config-manager.js";
export { RuntimeInitializer } from "./runtime-initializer.js";
export { ProviderFactory, ProviderConfigError } from "./provider-factory.js";
export { ToolManager, type IMCPManager } from "./tool-manager.js";
export { SkillManager } from "./skill-manager.js";

// 重导出 runtime 层相关类型（便于外部使用）
export { AgentLoop, SessionManager, ToolRegistry, SkillRegistry } from "../../runtime/index.js";
export type { AgentConfig, AgentEventHandler } from "../../runtime/index.js";
