/**
 * 热插拔类型定义
 */

/** 扩展类型 */
export type ExtensionType = 'tool' | 'skill' | 'channel';

/** 扩展状态 */
export type ExtensionStatus = 'loaded' | 'failed' | 'unloaded';

/**
 * 热插拔接口
 * 
 * 所有可热插拔扩展必须实现此接口。
 */
export interface HotPluggable {
  /** 扩展类型标识 */
  readonly type: ExtensionType;
  /** 扩展名称（唯一标识） */
  readonly name: string;
  /** 扩展声明的 SDK 版本 */
  readonly sdkVersion?: string;
  /** 扩展加载时调用 */
  onLoad?(): Promise<void>;
  /** 扩展卸载时调用 */
  onUnload?(): Promise<void>;
}

/**
 * 扩展元数据
 */
export interface ExtensionMeta {
  /** 扩展名称 */
  name: string;
  /** 扩展类型 */
  type: ExtensionType;
  /** 扩展路径 */
  path: string;
  /** 加载状态 */
  status: ExtensionStatus;
  /** SDK 版本 */
  sdkVersion?: string;
  /** 加载时间 */
  loadedAt?: Date;
  /** 错误信息 */
  error?: string;
}

/** SDK 版本 */
export const SDK_VERSION = '1.0.0';
