/**
 * 流式响应处理器
 * 
 * 提供 SSE 和自定义流式响应支持。
 */

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'thinking' | 'error' | 'done';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface StreamHandler {
  (chunk: StreamChunk): void;
}

/**
 * SSE 流式响应生成器
 */
export class SSEStreamer {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private closed = false;

  /**
   * 创建 SSE 响应流
   */
  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });
  }

  /**
   * 发送块
   */
  send(chunk: StreamChunk): void {
    if (this.closed || !this.controller) return;

    const data = `data: ${JSON.stringify(chunk)}\n\n`;
    this.controller.enqueue(this.encoder.encode(data));
  }

  /**
   * 发送文本块
   */
  sendText(content: string): void {
    this.send({
      type: 'text',
      content,
      timestamp: new Date(),
    });
  }

  /**
   * 发送工具调用块
   */
  sendToolCall(toolName: string, args: unknown): void {
    this.send({
      type: 'tool_call',
      content: JSON.stringify({ toolName, args }),
      timestamp: new Date(),
    });
  }

  /**
   * 发送思考块
   */
  sendThinking(content: string): void {
    this.send({
      type: 'thinking',
      content,
      timestamp: new Date(),
    });
  }

  /**
   * 发送错误块
   */
  sendError(error: string): void {
    this.send({
      type: 'error',
      content: error,
      timestamp: new Date(),
    });
  }

  /**
   * 发送完成块
   */
  sendDone(): void {
    this.send({
      type: 'done',
      content: '',
      timestamp: new Date(),
    });
    this.close();
  }

  /**
   * 关闭流
   */
  close(): void {
    if (this.closed || !this.controller) return;
    this.closed = true;
    this.controller.close();
  }
}

/**
 * 创建 SSE 响应
 */
export function createSSEResponse(
  handler: (streamer: SSEStreamer) => Promise<void>
): Response {
  const streamer = new SSEStreamer();
  const stream = streamer.createStream();

  // 异步处理
  handler(streamer).catch((error) => {
    streamer.sendError(String(error));
    streamer.close();
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
