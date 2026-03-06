/**
 * 调用链追踪器
 */

import type { TracerOptions, TraceContext } from './types';

let tracerOptions: TracerOptions = {
  enabled: false,
  sampleRate: 1,
};

/** 追踪器 */
export class Tracer {
  private options: TracerOptions;
  private spans: Map<string, TraceContext> = new Map();

  constructor(options: Partial<TracerOptions> = {}) {
    this.options = { ...tracerOptions, ...options };
  }

  /** 开始追踪 */
  startSpan(name: string, parent?: TraceContext): TraceContext {
    const spanId = crypto.randomUUID();
    const traceId = parent?.traceId || crypto.randomUUID();

    const ctx: TraceContext = {
      traceId,
      spanId,
      parentSpanId: parent?.spanId,
    };

    this.spans.set(spanId, ctx);
    return ctx;
  }

  /** 结束追踪 */
  endSpan(spanId: string): void {
    this.spans.delete(spanId);
  }

  /** 获取追踪上下文 */
  getContext(spanId: string): TraceContext | undefined {
    return this.spans.get(spanId);
  }
}

let globalTracer: Tracer | null = null;

/** 获取全局追踪器 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

/** 设置全局追踪器 */
export function setTracer(tracer: Tracer): void {
  globalTracer = tracer;
}

/** 方法追踪装饰器 */
export function traceMethod(module: string, method: string) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: unknown[]) => Promise<unknown>>
  ) {
    const original = descriptor.value;
    if (!original) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const tracer = getTracer();
      const ctx = tracer.startSpan(`${module}.${method}`);
      const start = Date.now();

      try {
        const result = await original.apply(this, args);
        return result;
      } finally {
        tracer.endSpan(ctx.spanId);
        const duration = Date.now() - start;
        console.debug(`[${module}] ${method} completed in ${duration}ms`);
      }
    };

    return descriptor;
  };
}

/** 追踪函数包装器 */
export function traced<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  module: string,
  method: string
): T {
  return (async (...args: Parameters<T>) => {
    const tracer = getTracer();
    const ctx = tracer.startSpan(`${module}.${method}`);
    const start = Date.now();

    try {
      const result = await fn(...args);
      return result;
    } finally {
      tracer.endSpan(ctx.spanId);
      const duration = Date.now() - start;
      console.debug(`[${module}] ${method} completed in ${duration}ms`);
    }
  }) as T;
}
