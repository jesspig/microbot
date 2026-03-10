/**
 * SDK Session 模块
 *
 * 提供会话相关的高级封装功能。
 *
 * @module sdk/session
 */

// TitleGenerator - 智能标题生成
export {
  TitleGenerator,
  generateSessionTitle,
  generateSessionSummary,
  type TitleGeneratorConfig,
  type TitleGenerationResult,
} from './title-generator';

// ContextInjector - 会话上下文注入
export {
  SessionContextInjector,
  buildContextMessage,
  ContextInjectorConfigSchema,
  type ContextInjectorConfig,
  type ContextInjectionResult,
  type MessageProvider,
  type SessionInfoProvider,
  type SimilarSessionResult,
  type SimilarSessionSearcher,
} from './context-injector';
