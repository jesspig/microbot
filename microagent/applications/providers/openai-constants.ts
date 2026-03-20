/**
 * OpenAI Provider 常量定义
 *
 * 集中管理魔法数字和配置常量
 */

/** 默认重试基数延迟（毫秒） */
export const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

/** 默认请求超时时间（毫秒） */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

/** 默认最大重试次数 */
export const DEFAULT_MAX_RETRIES = 3;

/** 默认最大上下文 Token 数 */
export const DEFAULT_MAX_CONTEXT_TOKENS = 128000;

/** 默认温度参数 */
export const DEFAULT_TEMPERATURE = 0.7;

/** 日志文本截断长度 */
export const LOG_TRUNCATE_LENGTH = 1000;
