// TODO: 迁移 AgentLoop 到 @microbot/runtime 后恢复测试
// AgentLoop 当前仍在 @microbot/core 中
import { describe, it, expect } from 'bun:test';

describe.skip('AgentLoop', () => {
  it('placeholder - AgentLoop 未迁移到新包', () => {
    expect(true).toBe(true);
  });
});
