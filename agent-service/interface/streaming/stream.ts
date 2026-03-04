/**
 * 通用流式响应模块
 */

export { SSEStreamer, createSSEResponse } from './sse';
export type { StreamChunk, StreamHandler } from './sse';

/**
 * 创建响应流
 */
export function createStream<T>(
  handler: (yield: (chunk: T) => void) => Promise<void>
): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      try {
        await handler((chunk) => {
          controller.enqueue(chunk);
        });
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
