/**
 * Channel 创建模块
 *
 * 负责根据配置创建各种消息 Channel 实例
 */

import type { Settings } from "../../../config/loader.js";
import type { IChannelExtended } from "../../../../runtime/channel/contract.js";
import {
  createQQChannel,
  createFeishuChannel,
  createWechatWorkChannel,
  createDingTalkChannel,
} from "../../../channels/index.js";
import { cliLogger, createTimer, logMethodCall, logMethodReturn } from "../../../shared/logger.js";

const logger = cliLogger();
const MODULE_NAME = "ChannelSetup";

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 创建 Channel 实例
 */
export function createChannels(settings: Settings): IChannelExtended[] {
  const timer = createTimer();
  logMethodCall(logger, { method: "createChannels", module: MODULE_NAME, params: {} });

  const channels: IChannelExtended[] = [];
  const channelConfigs = settings.channels ?? {};

  // QQ Channel
  if (channelConfigs.qq?.enabled) {
    const qqConfig = channelConfigs.qq;
    if (qqConfig.appId && qqConfig.clientSecret) {
      try {
        const config = {
          id: "qq",
          type: "qq" as const,
          enabled: true,
          appId: qqConfig.appId,
          clientSecret: qqConfig.clientSecret,
          sandbox: qqConfig.sandbox,
          allowFrom: qqConfig.allowFrom,
          allowChannels: qqConfig.allowChannels,
        };
        const channel = createQQChannel(config as Parameters<typeof createQQChannel>[0]);
        channels.push(channel);
        logger.info("QQ Channel 创建成功", { sandbox: config.sandbox });
      } catch (err) {
        const error = err as Error;
        logger.error("QQ Channel 创建失败", { error: error.message });
      }
    }
  }

  // 飞书 Channel
  if (channelConfigs.feishu?.enabled) {
    const feishuConfig = channelConfigs.feishu;
    if (feishuConfig.appId && feishuConfig.appSecret) {
      try {
        const config = {
          id: "feishu",
          type: "feishu" as const,
          enabled: true,
          appId: feishuConfig.appId,
          appSecret: feishuConfig.appSecret,
          allowFrom: feishuConfig.allowFrom,
        };
        const channel = createFeishuChannel(config as Parameters<typeof createFeishuChannel>[0]);
        channels.push(channel);
        logger.info("飞书 Channel 创建成功");
      } catch (err) {
        const error = err as Error;
        logger.error("飞书 Channel 创建失败", { error: error.message });
      }
    }
  }

  // 企业微信 Channel
  if (channelConfigs.wechatWork?.enabled) {
    const wechatConfig = channelConfigs.wechatWork;
    if (wechatConfig.botId || wechatConfig.webhookKey) {
      try {
        const config = {
          id: "wechatWork",
          type: "wechat-work" as const,
          enabled: true,
          botId: wechatConfig.botId,
          secret: wechatConfig.secret,
          webhookKey: wechatConfig.webhookKey,
          corpId: wechatConfig.corpId,
          agentId: wechatConfig.agentId,
          allowFrom: wechatConfig.allowFrom,
        };
        const channel = createWechatWorkChannel(config as Parameters<typeof createWechatWorkChannel>[0]);
        channels.push(channel);
        logger.info("企业微信 Channel 创建成功");
      } catch (err) {
        const error = err as Error;
        logger.error("企业微信 Channel 创建失败", { error: error.message });
      }
    }
  }

  // 钉钉 Channel
  if (channelConfigs.dingtalk?.enabled) {
    const dingtalkConfig = channelConfigs.dingtalk;
    if (dingtalkConfig.clientId && dingtalkConfig.clientSecret) {
      try {
        const config = {
          id: "dingtalk",
          type: "dingtalk" as const,
          enabled: true,
          clientId: dingtalkConfig.clientId,
          clientSecret: dingtalkConfig.clientSecret,
          allowFrom: dingtalkConfig.allowFrom,
        };
        const channel = createDingTalkChannel(config as Parameters<typeof createDingTalkChannel>[0]);
        channels.push(channel);
        logger.info("钉钉 Channel 创建成功");
      } catch (err) {
        const error = err as Error;
        logger.error("钉钉 Channel 创建失败", { error: error.message });
      }
    }
  }

  logger.debug("Channel 创建完成", { channelCount: channels.length, channelIds: channels.map(c => c.id) });
  logMethodReturn(logger, { method: "createChannels", module: MODULE_NAME, result: { channelCount: channels.length }, duration: timer() });
  return channels;
}
