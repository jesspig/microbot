/**
 * 通道基础类型
 */

import type { Channel, ChannelType } from '@micro-agent/types';

// 重新导出类型
export type { Channel, ChannelType };

/**
 * 创建通道类型
 *
 * @param name - 通道名称
 * @returns 类型安全的通道类型标识
 *
 * @example
 * const myChannelType = createChannelType('wechat');
 * // myChannelType: ChannelType
 */
export function createChannelType(name: string): ChannelType {
  return name as ChannelType;
}
