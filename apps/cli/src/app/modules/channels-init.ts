/**
 * Channel 初始化模块
 *
 * 负责初始化消息通道
 */

import type { ChannelManager, MessageBus } from '@micro-agent/sdk';

/**
 * 初始化所有通道
 */
export function initChannels(
  config: any,
  channelManager: ChannelManager,
  messageBus: MessageBus,
  FeishuChannel: any
): void {
  const channels = config.channels;

  if (isFeishuChannelEnabled(channels.feishu)) {
    registerFeishuChannel(channels.feishu, channelManager, messageBus, FeishuChannel);
  }
}

/**
 * 检查飞书通道是否启用
 */
function isFeishuChannelEnabled(feishuConfig: any): boolean {
  return !!(
    feishuConfig?.enabled &&
    feishuConfig.appId &&
    feishuConfig.appSecret
  );
}

/**
 * 注册飞书通道
 */
function registerFeishuChannel(
  feishuConfig: any,
  channelManager: ChannelManager,
  messageBus: MessageBus,
  FeishuChannel: any
): void {
  const channel = new FeishuChannel(messageBus, {
    appId: feishuConfig.appId,
    appSecret: feishuConfig.appSecret,
    allowFrom: feishuConfig.allowFrom ?? [],
  });
  channelManager.register(channel);
}