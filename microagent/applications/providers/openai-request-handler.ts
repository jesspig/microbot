/**
 * OpenAI HTTP 请求处理器
 *
 * 负责处理 HTTP 请求的发送和接收
 */

import { providersLogger, createTimer, logMethodCall, logMethodReturn, logMethodError } from "../shared/logger.js";

const logger = providersLogger();
const MODULE_NAME = "OpenAIRequestHandler";

/**
 * 请求配置
 */
export interface RequestConfig {
  /** 请求 URL */
  url: string;
  /** 请求体 */
  body: unknown;
  /** 请求头 */
  headers: Record<string, string>;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * HTTP 响应
 */
export interface HTTPResponse {
  /** 原始响应体 */
  json: unknown;
  /** HTTP 状态码 */
  status: number;
  /** 状态文本 */
  statusText: string;
  /** 响应是否成功 */
  ok: boolean;
}

/**
 * OpenAI 请求处理器
 * 负责处理 HTTP 请求的发送和接收
 */
export class OpenAIRequestHandler {
  /**
   * 发送 HTTP 请求
   * @param config - 请求配置
   * @returns HTTP 响应
   */
  async sendRequest(config: RequestConfig): Promise<HTTPResponse> {
    const timer = createTimer();
    logMethodCall(logger, { method: "sendRequest", module: MODULE_NAME, params: { url: config.url } });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    // 如果提供了外部 signal，则组合使用
    if (config.signal) {
      config.signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: config.headers,
        body: JSON.stringify(config.body),
        signal: controller.signal,
      });

      const json: unknown = await response.json();

      logMethodReturn(logger, {
        method: "sendRequest",
        module: MODULE_NAME,
        result: { status: response.status, ok: response.ok },
        duration: timer(),
      });

      return {
        json,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logMethodError(logger, {
        method: "sendRequest",
        module: MODULE_NAME,
        error: { name: err.name, message: err.message, ...(err.stack ? { stack: err.stack } : {}) },
        params: { url: config.url },
        duration: timer(),
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 检查响应是否为错误
   * @param response - HTTP 响应
   * @returns 是否为错误响应
   */
  isError(response: HTTPResponse): boolean {
    return !response.ok || response.status >= 400;
  }

  /**
   * 从响应中提取错误消息
   * @param response - HTTP 响应
   * @returns 错误消息
   */
  extractErrorMessage(response: HTTPResponse): string {
    const json = response.json;

    if (typeof json === "object" && json !== null) {
      const obj = json as Record<string, unknown>;
      if (obj.error && typeof obj.error === "object") {
        const error = obj.error as Record<string, unknown>;
        if (typeof error.message === "string") return error.message;
      }
      if (typeof obj.message === "string") return obj.message;
      if (typeof obj.msg === "string") return obj.msg;
    }

    return response.statusText || "未知错误";
  }
}
