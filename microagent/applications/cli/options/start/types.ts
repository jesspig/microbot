/**
 * start 命令类型定义
 */

/**
 * start 命令选项
 */
export interface StartOptions {
  /** 配置文件路径 */
  config?: string;
  /** 覆盖配置中的模型 */
  model?: string;
  /** 启用调试模式 */
  debug?: boolean;
}

/**
 * start 命令结果
 */
export interface StartResult {
  /** 是否成功启动 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}
