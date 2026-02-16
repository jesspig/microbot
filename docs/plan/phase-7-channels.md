# 阶段 7：通道系统

**依赖**: 阶段 5（Provider）  
**预计文件数**: 7  
**预计代码行数**: ~500 行

## 目标

实现 5 个通道：飞书、QQ、邮箱、钉钉、企业微信。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| II. 组合优于继承 | ✅ | 接口 + DI 模式 |
| III. 开放封闭 | ✅ | 新增通道只需实现接口 |

## 文件清单

### 1. src/channels/base.ts

**职责**: 通道接口定义

```typescript
import type { InboundMessage, OutboundMessage } from '../bus/events';
import type { MessageBus } from '../bus/queue';

/** 通道类型 */
export type ChannelType = 'feishu' | 'qq' | 'email' | 'dingtalk' | 'wecom';

/** 通道接口 */
export interface IChannel {
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

/** 通道基类 */
export abstract class BaseChannel implements IChannel {
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

    await this.bus.publishInbound({
      channel: this.name,
      senderId,
      chatId,
      content,
      timestamp: new Date(),
      media,
      metadata,
    });
  }
}
```

**行数**: ~60 行

---

### 2. src/channels/feishu.ts

**职责**: 飞书通道

```typescript
import { BaseChannel, type ChannelType } from './base';
import type { OutboundMessage } from '../bus/events';
import type { MessageBus } from '../bus/queue';
import lark from '@larksuiteoapi/node-sdk';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  allowFrom: string[];
}

/**
 * 飞书通道
 * 
 * 使用 WebSocket 长连接接收消息。
 */
export class FeishuChannel extends BaseChannel {
  readonly name: ChannelType = 'feishu';
  private client: lark.Client | null = null;

  constructor(bus: MessageBus, private config: FeishuConfig) {
    super(bus, config.allowFrom);
  }

  async start(): Promise<void> {
    this.client = lark.newClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      appType: lark.AppType.SelfBuild,
    });

    // 订阅消息事件
    this.client.on('im.message.receive_v1', async (event) => {
      const message = event.event.message;
      const sender = event.event.sender;

      await this.handleInbound(
        sender.sender_id.open_id,
        message.chat_id,
        message.content,
        [],
        { messageType: message.message_type }
      );
    });

    this._running = true;
  }

  async stop(): Promise<void> {
    this._running = false;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('飞书通道未启动');
    }

    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: msg.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: msg.content }),
      },
    });
  }
}
```

**行数**: ~65 行

---

### 3. src/channels/qq.ts

**职责**: QQ 频道通道

```typescript
import { BaseChannel, type ChannelType } from './base';
import type { OutboundMessage } from '../bus/events';
import type { MessageBus } from '../bus/queue';

interface QQConfig {
  appId: string;
  secret: string;
  allowFrom: string[];
}

/**
 * QQ 频道通道
 */
export class QQChannel extends BaseChannel {
  readonly name: ChannelType = 'qq';
  private ws: WebSocket | null = null;

  constructor(bus: MessageBus, private config: QQConfig) {
    super(bus, config.allowFrom);
  }

  async start(): Promise<void> {
    // 连接 QQ 频道 WebSocket
    const wsUrl = await this.getWebSocketUrl();
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.t === 'AT_MESSAGE_CREATE') {
        await this.handleInbound(
          data.d.author.id,
          data.d.channel_id,
          this.parseContent(data.d.content),
        );
      }
    };

    this._running = true;
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this._running = false;
  }

  async send(msg: OutboundMessage): Promise<void> {
    // 发送消息到 QQ 频道
    const url = `https://api.sgroup.qq.com/channels/${msg.chatId}/messages`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.config.appId}.${this.config.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: msg.content }),
    });
  }

  private async getWebSocketUrl(): Promise<string> {
    // 获取 WebSocket 连接地址
    return 'wss://api.sgroup.qq.com/websocket';
  }

  private parseContent(content: string): string {
    // 移除 @ 提及
    return content.replace(/<@!\d+>/g, '').trim();
  }
}
```

**行数**: ~70 行

---

### 4. src/channels/email.ts

**职责**: 邮箱通道

```typescript
import { BaseChannel, type ChannelType } from './base';
import type { OutboundMessage } from '../bus/events';
import type { MessageBus } from '../bus/queue';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

interface EmailConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  allowFrom: string[];
}

/**
 * 邮箱通道
 */
export class EmailChannel extends BaseChannel {
  readonly name: ChannelType = 'email';
  private imapClient: ImapFlow | null = null;
  private smtpTransport: nodemailer.Transporter | null = null;
  private seenUids = new Set<string>();

  constructor(bus: MessageBus, private config: EmailConfig) {
    super(bus, config.allowFrom);
  }

  async start(): Promise<void> {
    // 初始化 IMAP
    this.imapClient = new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: true,
      auth: { user: this.config.user, pass: this.config.password },
    });

    // 初始化 SMTP
    this.smtpTransport = nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: true,
      auth: { user: this.config.user, pass: this.config.password },
    });

    await this.imapClient.connect();
    this.startPolling();
    this._running = true;
  }

  async stop(): Promise<void> {
    await this.imapClient?.logout();
    this.smtpTransport?.close();
    this._running = false;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.smtpTransport) {
      throw new Error('邮箱通道未启动');
    }

    await this.smtpTransport.sendMail({
      from: this.config.user,
      to: msg.chatId,
      subject: 'Re: ' + (msg.metadata.subject ?? ''),
      text: msg.content,
    });
  }

  private startPolling(): void {
    setInterval(() => this.poll(), 30000);
  }

  private async poll(): Promise<void> {
    if (!this.imapClient) return;

    await this.imapClient.mailboxOpen('INBOX');
    const messages = this.imapClient.fetch({ seen: false }, { uid: true, source: true });

    for await (const msg of messages) {
      if (this.seenUids.has(msg.uid.toString())) continue;
      this.seenUids.add(msg.uid.toString());

      // 解析邮件并处理
      const parsed = await this.parseEmail(msg.source.toString());
      await this.handleInbound(parsed.from, parsed.from, parsed.content);
    }
  }

  private async parseEmail(raw: string): Promise<{ from: string; content: string }> {
    // 简化实现，实际应使用邮件解析库
    return { from: '', content: raw };
  }
}
```

**行数**: ~95 行

---

### 5. src/channels/dingtalk.ts

**职责**: 钉钉通道

```typescript
import { BaseChannel, type ChannelType } from './base';
import type { OutboundMessage } from '../bus/events';
import type { MessageBus } from '../bus/queue';

interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
  allowFrom: string[];
}

/**
 * 钉钉通道
 */
export class DingTalkChannel extends BaseChannel {
  readonly name: ChannelType = 'dingtalk';

  constructor(bus: MessageBus, private config: DingTalkConfig) {
    super(bus, config.allowFrom);
  }

  async start(): Promise<void> {
    // 使用钉钉 Stream 模式
    this._running = true;
  }

  async stop(): Promise<void> {
    this._running = false;
  }

  async send(msg: OutboundMessage): Promise<void> {
    // 发送钉钉消息
  }
}
```

**行数**: ~35 行

---

### 6. src/channels/wecom.ts

**职责**: 企业微信通道

```typescript
import { BaseChannel, type ChannelType } from './base';
import type { OutboundMessage } from '../bus/events';
import type { MessageBus } from '../bus/queue';

interface WeComConfig {
  corpId: string;
  agentId: string;
  secret: string;
  token?: string;
  encodingAESKey?: string;
  allowFrom: string[];
}

/**
 * 企业微信通道
 */
export class WeComChannel extends BaseChannel {
  readonly name: ChannelType = 'wecom';

  constructor(bus: MessageBus, private config: WeComConfig) {
    super(bus, config.allowFrom);
  }

  async start(): Promise<void> {
    this._running = true;
  }

  async stop(): Promise<void> {
    this._running = false;
  }

  async send(msg: OutboundMessage): Promise<void> {
    // 发送企业微信消息
  }
}
```

**行数**: ~35 行

---

### 7. src/channels/manager.ts

**职责**: 通道管理器

```typescript
import type { IChannel, ChannelType } from './base';
import type { OutboundMessage } from '../bus/events';

/**
 * 通道管理器
 * 
 * 管理所有通道，提供统一的消息发送接口。
 */
export class ChannelManager {
  private channels = new Map<ChannelType, IChannel>();

  /** 注册通道 */
  register(channel: IChannel): void {
    this.channels.set(channel.name, channel);
  }

  /** 启动所有通道 */
  async startAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  /** 停止所有通道 */
  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }

  /** 发送消息到指定通道 */
  async send(msg: OutboundMessage): Promise<void> {
    const channel = this.channels.get(msg.channel);
    if (!channel) {
      throw new Error(`通道不存在: ${msg.channel}`);
    }
    await channel.send(msg);
  }

  /** 获取运行中的通道 */
  getRunningChannels(): ChannelType[] {
    return Array.from(this.channels.entries())
      .filter(([, ch]) => ch.isRunning)
      .map(([name]) => name);
  }
}
```

**行数**: ~50 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 定义通道接口 | `src/channels/base.ts` | ~60 |
| 2 | 实现飞书通道 | `src/channels/feishu.ts` | ~65 |
| 3 | 实现 QQ 通道 | `src/channels/qq.ts` | ~70 |
| 4 | 实现邮箱通道 | `src/channels/email.ts` | ~95 |
| 5 | 实现钉钉通道 | `src/channels/dingtalk.ts` | ~35 |
| 6 | 实现企业微信通道 | `src/channels/wecom.ts` | ~35 |
| 7 | 实现通道管理器 | `src/channels/manager.ts` | ~50 |

## 验收标准

- [ ] 飞书通道可连接并收发消息
- [ ] 通道管理器可以管理多个通道
- [ ] 消息可以路由到正确的通道

## 下一步

完成本阶段后，进入 [阶段 8：服务层](./phase-8-services.md)
