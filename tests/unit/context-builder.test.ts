// TODO: 迁移 ContextBuilder 到 @microbot/runtime 后恢复测试
// ContextBuilder 当前仍在 @microbot/core 中
import { describe, it, expect } from 'bun:test';

describe.skip('ContextBuilder', () => {
  it('placeholder - ContextBuilder 未迁移到新包', () => {
    expect(true).toBe(true);
  });
});
