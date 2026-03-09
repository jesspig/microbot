/**
 * Agent Service Runtime 入口
 * 
 * 统一导出所有运行时模块
 */

// ============ Infrastructure Layer ============
// Container
export { ContainerImpl, container } from './infrastructure/container';

// Event Bus
export { EventBus, eventBus } from './infrastructure/event-bus';

// Message Bus
export { MessageBus } from './infrastructure/message-bus';

// Database
export { SessionStore } from './infrastructure/database';
export type { Session, SessionMessage, SessionMetadata, SessionStoreConfig } from './infrastructure/database';

// Memory Store (原 cache 模块)
export { KVMemoryStore } from './infrastructure/database';
export type { KVMemoryStoreConfig } from './infrastructure/database';

// Config
export {
  loadConfig,
  getConfigStatus,
  ConfigLevel,
  expandPath,
  findTemplateFile,
  createDefaultUserConfig,
} from './infrastructure/config';
export type {
  Config,
  AgentConfig,
  ModelsConfig,
  ModelConfig,
  ProviderConfig,
  ProviderEntry,
  MemoryConfig as RuntimeMemoryConfig,
  LoadConfigOptions,
  ConfigStatus,
} from './infrastructure/config';

// Logging
export {
  getLogger,
  initLogging,
  closeLogging,
  isLoggingInitialized,
  getLogFilePath,
  createModuleLogger,
  subscribeToLogs,
  getTracer,
  setTracer,
  traceMethod,
  traced,
} from './infrastructure/logging';
export type {
  LogLevel,
  LoggingConfig,
  TraceContext,
  LogType,
  BaseLogEntry,
  MethodCallLog,
  LLMCallLog,
  ToolCallLog,
  EventLog,
  LogEntry,
  TracerOptions,
  LogEventListener,
  ServiceLifecycleLog,
  SessionLifecycleLog,
  IPCMessageLog,
} from './infrastructure/logging';

// ============ Hook System ============
export { HookSystem, hookSystem } from './hook-system';
export type { Hook, HookContext, HookResult } from './hook-system';

// ============ Provider Layer ============
// LLM
export {
  ModelRouter,
  createModelRouter,
  createLLMProvider,
  AnthropicProvider,
  createAnthropicProvider,
} from './provider/llm';
export type {
  ModelRouterConfig,
  RouteResult,
  ModelConfig as LLMModelConfig,
  LLMProviderConfig,
  AnthropicConfig,
  LLMProvider,
  GenerationConfig,
  ProviderCapabilities,
} from './provider/llm';

// Embedding
export {
  OpenAIEmbeddingProvider,
  createOpenAIEmbeddingProvider,
  LocalEmbeddingProvider,
  createLocalEmbeddingProvider,
} from './provider/embedding';
export type {
  EmbeddingProvider,
  EmbeddingResult,
  OpenAIEmbeddingConfig,
  LocalEmbeddingConfig,
} from './provider/embedding';

// Vector DB
export {
  LanceDBProvider,
  createLanceDBProvider,
  LocalVectorProvider,
  createLocalVectorProvider,
} from './provider/vector-db';
export type {
  VectorDBProvider,
  VectorRecord,
  SearchResult,
  LanceDBConfig,
  LocalVectorConfig,
} from './provider/vector-db';

// Storage Provider
export type { StorageProvider, StorageConfig } from './provider/storage';
export {
  FileStorageProvider,
  MemoryStorageProvider,
  createFileStorageProvider,
  createMemoryStorageProvider,
} from './provider/storage';

// ============ Capability Layer ============
// Tool System
export { ToolRegistry, createToolRegistry } from './capability/tool-system';
export type { ToolRegistryConfig } from './capability/tool-system';

// Skill System
export { SkillRegistry, createSkillRegistry } from './capability/skill-system';
export type { SkillRegistryConfig, SkillDefinition, SkillExample, SkillMatch } from './capability/skill-system';

// MCP Client
export { MCPClient, createMCPClient } from './capability/mcp';
export type {
  MCPClientConfig,
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResult,
  MCPToolResultContent,
  MCPResource,
  MCPResourceContents,
  MCPServerCapabilities,
  MCPClientCapabilities,
} from './capability/mcp';

// Memory System - 基础能力
export {
  MemoryStore,
  OpenAIEmbedding,
  NoEmbedding,
  createEmbeddingService,
  MemorySearcher,
  forgettingCurve,
} from './capability/memory';
export type {
  MemoryEntry,
  MemoryMetadata,
  MemoryStats,
  SearchOptions,
  MemoryFilter,
} from './capability/memory';

// Memory System - SDK 高级封装（重导出）
export {
  MemoryManager,
  ConversationSummarizer,
  classifyMemory,
  type MemoryManagerConfig,
  type Summary,
  type SummarizerConfig,
} from './capability/memory';

// Knowledge System - 基础能力
export {
  KnowledgeRetriever,
  createDocumentScanner,
  createDocumentIndexer,
  createRetriever,
} from './capability/knowledge';
export type {
  KnowledgeBaseConfig,
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeSearchResult,
  RetrieverConfig,
} from './capability/knowledge';

// Knowledge System - SDK 高级封装（重导出）
export {
  KnowledgeBaseManager,
  setKnowledgeBase,
  getKnowledgeBase,
} from '@micro-agent/sdk';

// Plugin System
export {
  ExtensionRegistry,
  createExtensionRegistry,
  ExtensionDiscovery,
  createExtensionDiscovery,
  ExtensionLoader,
  createExtensionLoader,
  HotReloadManager,
  createHotReloadManager,
} from './capability/plugin-system';
export type {
  RegistryConfig,
  LoaderConfig,
  LoaderState,
  HotReloadConfig,
} from './capability/plugin-system';

// ============ Kernel Layer ============
// Orchestrator
export { AgentOrchestrator } from './kernel/orchestrator';
export type { OrchestratorConfig, StreamCallbacks } from './kernel/orchestrator';

// Planner
export { AgentPlanner } from './kernel/planner';
export type { PlannerConfig, PlanResult } from './kernel/planner';

// Execution Engine
export { ExecutionEngine } from './kernel/execution-engine';
export type { ExecutionEngineConfig, ExecutionResult } from './kernel/execution-engine';

// Context Manager
export { ContextManager } from './kernel/context-manager';
export type { ContextManagerConfig, ContextState } from './kernel/context-manager';
