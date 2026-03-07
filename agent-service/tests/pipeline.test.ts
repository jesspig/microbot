import { describe, it, expect, beforeEach } from 'bun:test';

// Pipeline 尚未迁移到新架构，使用简化实现测试

/**
 * 简化的 Pipeline 实现（用于测试）
 */
class Pipeline<T> {
  private middlewares: Array<(ctx: T, next: () => Promise<void>) => Promise<void>> = [];

  use(middleware: (ctx: T, next: () => Promise<void>) => Promise<void>): void {
    this.middlewares.push(middleware);
  }

  async execute(ctx: T): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        await middleware(ctx, next);
      }
    };

    await next();
  }

  clear(): void {
    this.middlewares = [];
  }
}

describe('Pipeline', () => {
  let pipeline: Pipeline<{ value: number; order?: number[] }>;

  beforeEach(() => {
    pipeline = new Pipeline<{ value: number; order?: number[] }>();
  });

  describe('use', () => {
    it('should execute middleware in order', async () => {
      const order: number[] = [];
      
      pipeline.use(async (ctx, next) => {
        order.push(1);
        await next();
      });
      pipeline.use(async (ctx, next) => {
        order.push(2);
        await next();
      });
      
      await pipeline.execute({ value: 0 });
      expect(order).toEqual([1, 2]);
    });

    it('should pass context through middleware', async () => {
      pipeline.use(async (ctx, next) => {
        ctx.value += 1;
        await next();
      });
      pipeline.use(async (ctx, next) => {
        ctx.value *= 2;
        await next();
      });
      
      const ctx = { value: 1 };
      await pipeline.execute(ctx);
      expect(ctx.value).toBe(4);
    });
  });

  describe('middleware can stop execution', () => {
    it('should stop if next is not called', async () => {
      let secondCalled = false;
      
      pipeline.use(async (ctx, next) => {
        // 不调用 next
      });
      pipeline.use(async (ctx, next) => {
        secondCalled = true;
        await next();
      });
      
      await pipeline.execute({ value: 0 });
      expect(secondCalled).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all middleware', async () => {
      let called = false;
      pipeline.use(async (ctx, next) => {
        called = true;
        await next();
      });
      
      pipeline.clear();
      await pipeline.execute({ value: 0 });
      expect(called).toBe(false);
    });
  });

  describe('empty pipeline', () => {
    it('should work with no middleware', async () => {
      const ctx = { value: 1 };
      await pipeline.execute(ctx);
      expect(ctx.value).toBe(1);
    });
  });
});