# Agent - 智能代理

## 概述

Agent 实现了 ReAct（Reasoning + Acting）模式，是系统的核心智能组件。

## 工作流程

```
用户消息
    │
    ▼
┌─────────────────┐
│  构建上下文      │
│  - 记忆搜索     │
│  - 技能加载     │
│  - 历史会话     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  智能路由选择   │
│  - 意图分析     │
│  - 复杂度评估   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ReAct 循环     │
│  1. 调用 LLM    │
│  2. 如需工具    │
│  3. 执行工具    │
│  4. 循环直到完成│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  保存会话       │
└────────┬────────┘
         │
         ▼
    返回响应
```

## 配置

```typescript
interface AgentConfig {
  workspace: string;
  models?: {
    chat: string;
    check?: string;
  };
  maxIterations: number;
  generation?: GenerationConfig;
  auto?: boolean;
  max?: boolean;
  availableModels?: Map<string, ModelConfig[]>;
  routing?: RoutingConfig;
}
```

## 上下文构建

Agent 使用 ContextBuilder 构建 LLM 上下文：

1. 加载 always=true 的技能
2. 搜索相关记忆
3. 获取会话历史
4. 合并系统提示

## 智能路由

根据任务复杂度自动选择模型：

- **fast**: 简单问候、感谢
- **low**: 翻译、格式化
- **medium**: 常规对话、修改
- **high**: 调试、分析
- **ultra**: 架构设计、重构

## 源码位置

`packages/core/src/agent/`
