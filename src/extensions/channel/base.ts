import type { ChannelType } from '../../core/types/interfaces';
import type { InboundMessage, OutboundMessage } from '../../core/bus/events';
import type { MessageBus } from '../../core/bus/queue';

/**
 * 通道接口
 * 
 * 定义所有通道必须实现的方法。
 */
export interface Channel {
  /** 通道名称 */
  readonly name: ChannelType;

  /** 启动通道 */
  start(): Promise<void>;

  /** 停止通道 */
  stop(): Promise<void>;

  /** 发送消息 */
  send(msg: OutboundMessage): Promise<void>;

  /** 检查是否运行中 */
  readonly isRunning: boolean;
}

/**
 * @deprecated 请使用 ChannelHelper 组合模式
 * 
 * 通道基类（已废弃）
 * 
 * 提供通用的辅助方法，子类只需实现核心逻辑。
 * 建议使用组合模式：通过构造函数注入 ChannelHelper。
 */
export abstract class BaseChannel implements Channel {
  abstract readonly name: ChannelType;
  protected _running = false;

  constructor(
    protected bus: MessageBus,
    protected allowFrom: string[] = []
  ) {}

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  get isRunning(): boolean {
    return this._running;
  }

  /** 检查发送者是否被允许 */
  protected isAllowed(senderId: string): boolean {
    if (this.allowFrom.length === 0) return true;
    return this.allowFrom.includes(senderId);
  }

  /** 处理入站消息 */
  protected async handleInbound(
    senderId: string,
    chatId: string,
    content: string,
    media: string[] = [],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.isAllowed(senderId)) {
      return;
    }

    const msg: InboundMessage = {
      channel: this.name,
      senderId,
      chatId,
      content,
      timestamp: new Date(),
      media,
      metadata,
    };

    await this.bus.publishInbound(msg);
  }
}
