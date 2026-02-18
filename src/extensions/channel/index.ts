/**
 * Channel 扩展入口
 * 
 * 导出所有通道模块，支持独立导入：
 * ```typescript
 * import { FeishuChannel, QQChannel, ChannelManager } from '@microbot/sdk/extensions/channel';
 * ```
 */

// 通道接口和基类
export { BaseChannel, type Channel } from './base';

// 通道管理器
export { ChannelManager } from './manager';
export { ChannelHelper } from './helper';

// 通道实现
export { FeishuChannel } from './feishu';
export { QQChannel } from './qq';
export { DingTalkChannel } from './dingtalk';
export { WeComChannel } from './wecom';
