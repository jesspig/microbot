/**
 * 飞书通道扩展
 * 
 * 使用 WebSocket 长连接接收消息，无需公网 IP。
 */
import type { OutboundMessage } from '../../../src/core/bus/events';
import type { MessageBus } from '../../../src/core/bus/queue';
import type { ChannelType } from '../../../src/core/types/interfaces';
import type { Channel, ChannelHelper } from '../../../src/core/channel';
import * as lark from '@larksuiteoapi/node-sdk';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['feishu']);

/** 飞书通道配置 */
interface FeishuConfig {
  appId: string;
  appSecret: string;
  allowFrom: string[];
}

/** 消息类型显示映射 */
const MSG_TYPE_MAP: Record<string, string> = {
  image: '[图片]',
  audio: '[语音]',
  file: '[文件]',
  sticker: '[表情]',
  video: '[视频]',
};

/** 飞书消息事件数据 */
interface FeishuMessageData {
  event: {
    message: {
      message_id: string;
      chat_id: string;
      chat_type: 'p2p' | 'group';
      message_type: string;
      content: string;
    };
    sender: {
      sender_type: string;
      sender_id?: {
        open_id?: string;
      };
    };
  };
}

/**
 * 飞书通道
 */
export class FeishuChannel implements Channel {
  readonly name: ChannelType = 'feishu';
  private client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private processedMessageIds = new Set<string>();
  private readonly MAX_PROCESSED_IDS = 500;
  private _running = false;

  constructor(
    private bus: MessageBus,
    private config: FeishuConfig,
    private helper: ChannelHelper
  ) {}

  get isRunning(): boolean {
    return this._running;
  }

  async start(): Promise<void> {
    const baseConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    };

    this.client = new lark.Client(baseConfig);

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        await this.handleMessage(data as FeishuMessageData);
      },
    });

    this.wsClient = new lark.WSClient({
      ...baseConfig,
      loggerLevel: lark.LoggerLevel.error,
    });

    this.wsClient.start({ eventDispatcher });
    this._running = true;
    log.info('飞书通道已启动 (WebSocket 长连接)');
  }

  async stop(): Promise<void> {
    this.wsClient = null;
    this.client = null;
    this._running = false;
    log.info('飞书通道已停止');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('飞书通道未启动');
    }

    const receiveIdType = msg.chatId.startsWith('ou_') ? 'open_id' : 'chat_id';
    const content = lark.messageCard.defaultCard({
      title: '',
      content: msg.content,
    });

    try {
      const response = await this.client.im.message.create({
        params: { receive_id_type: receiveIdType as 'chat_id' | 'open_id' },
        data: {
          receive_id: msg.chatId,
          content,
          msg_type: 'interactive',
        },
      });
      if (response.code !== 0) {
        log.error('发送失败: {msg}', { msg: response.msg });
      }
    } catch (error) {
      log.error('发送飞书消息失败: {error}', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      let message: { message_id: string; chat_id: string; chat_type: string; message_type: string; content: string } | undefined;
      let sender: { sender_type?: string; sender_id?: { open_id?: string } } | undefined;

      const dataObj = data as Record<string, unknown>;
      
      if (dataObj.message) {
        message = dataObj.message as typeof message;
        sender = dataObj.sender as typeof sender;
      } else if (dataObj.event) {
        const event = dataObj.event as Record<string, unknown>;
        message = event.message as typeof message;
        sender = event.sender as typeof sender;
      }

      if (!message) {
        log.error('无法解析消息数据');
        return;
      }

      const messageId = message.message_id;
      if (this.processedMessageIds.has(messageId)) return;
      this.processedMessageIds.add(messageId);

      if (this.processedMessageIds.size > this.MAX_PROCESSED_IDS) {
        const ids = Array.from(this.processedMessageIds);
        this.processedMessageIds = new Set(ids.slice(-this.MAX_PROCESSED_IDS / 2));
      }

      if (sender?.sender_type === 'bot') return;

      const senderId = sender?.sender_id?.open_id || 'unknown';
      const chatId = message.chat_id;
      const chatType = message.chat_type;
      const msgType = message.message_type;

      await this.addReaction(messageId, 'THUMBSUP');

      let content = '';
      if (msgType === 'text') {
        try {
          const parsed = JSON.parse(message.content || '{}');
          content = parsed.text || '';
        } catch {
          content = message.content || '';
        }
      } else {
        content = MSG_TYPE_MAP[msgType] || `[${msgType}]`;
      }

      if (!content.trim()) return;

      const replyTo = chatType === 'group' ? chatId : senderId;
      const chatTypeLabel = chatType === 'p2p' ? '私聊' : '群聊';
      log.info('飞书消息 [{type}]: "{content}"', { type: chatTypeLabel, content: content.slice(0, 30) });

      await this.helper.handleInbound(this.name, senderId, replyTo, content, [], {
        messageId,
        chatType,
        msgType,
      });
    } catch (error) {
      log.error('处理飞书消息失败: {error}', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async addReaction(messageId: string, emojiType: string): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: { emoji_type: emojiType },
        },
      });
    } catch {
      // 忽略反应失败
    }
  }
}
