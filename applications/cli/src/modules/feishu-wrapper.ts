/**
 * 飞书通道封装
 * 
 * 使用 @larksuiteoapi/node-sdk 的 WSClient 实现长连接。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { Channel, InboundMessage, MessageContent } from './message-router';

/**
 * 飞书配置
 */
export interface FeishuConfig {
  /** 应用 ID */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 加密密钥 */
  encryptKey?: string;
  /** 验证令牌 */
  verificationToken?: string;
}

/**
 * 飞书通道实现
 */
export class FeishuWrapper implements Channel {
  readonly type = 'feishu';
  
  private config: FeishuConfig;
  private client: Lark.Client;
  private wsClient: Lark.WSClient | null = null;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private _connected = false;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * 启动飞书通道
   */
  async start(): Promise<void> {
    console.log('[Feishu] 正在启动长连接...');

    try {
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: Lark.LoggerLevel.info,
      });

      // 启动长连接
      this.wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          // 处理接收消息事件
          'im.message.receive_v1': async (data: any) => {
            try {
              console.log('[Feishu] 收到原始事件:', JSON.stringify(data).slice(0, 500));
              const msg = this.mapToInboundMessage(data);
              if (msg && this.messageHandler) {
                this.messageHandler(msg);
              }
            } catch (error) {
              console.error('[Feishu] 处理消息失败:', error);
              if (this.errorHandler) {
                this.errorHandler(error as Error);
              }
            }
          },
        }),
      });

      this._connected = true;
      console.log('[Feishu] 长连接已启动');
    } catch (error) {
      console.error('[Feishu] 启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止飞书通道
   */
  async stop(): Promise<void> {
    if (this.wsClient) {
      this.wsClient = null;
    }
    this._connected = false;
    console.log('[Feishu] 通道已停止');
  }

  /**
   * 设置消息处理器
   */
  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * 设置错误处理器
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /**
   * 发送消息
   */
  async send(chatId: string, content: MessageContent): Promise<void> {
    try {
      // 解析内容
      let msgContent: string;
      if (content.type === 'text') {
        msgContent = JSON.stringify({ text: content.text });
      } else {
        msgContent = JSON.stringify(content);
      }

      // 发送消息
      await this.client.im.v1.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: msgContent,
        },
      });

      console.log('[Feishu] 消息已发送:', chatId);
    } catch (error) {
      console.error('[Feishu] 发送消息失败:', error);
      throw error;
    }
  }

  /**
   * 映射飞书事件到入站消息
   */
  private mapToInboundMessage(data: any): InboundMessage | null {
    // 飞书 v2.0 事件结构: { event: { sender, message } }
    const event = data.event || data;
    const message = event.message;
    const sender = event.sender;

    if (!message) {
      console.log('[Feishu] 事件无消息内容');
      return null;
    }

    // 解析消息内容
    let content: MessageContent;
    try {
      const parsed = typeof message.content === 'string' 
        ? JSON.parse(message.content) 
        : message.content;
      content = {
        type: 'text',
        text: parsed.text || message.content,
      };
    } catch {
      content = {
        type: 'text',
        text: typeof message.content === 'string' ? message.content : '',
      };
    }

    const result: InboundMessage = {
      id: message.message_id || crypto.randomUUID(),
      chatId: message.chat_id,
      userId: sender?.sender_id?.open_id || sender?.sender_id?.union_id || 'unknown',
      content,
      channelType: 'feishu',
      timestamp: new Date(parseInt(message.create_time) || Date.now()),
      metadata: {
        message_type: message.message_type,
        create_time: message.create_time,
        tenant_key: sender?.tenant_key,
      },
    };

    console.log('[Feishu] 解析消息:', result.id, result.chatId, result.content.text?.slice(0, 50));
    return result;
  }
}