# Provider - LLM 提供商

## 概述

Provider 抽象了 LLM 调用接口，支持 OpenAI 兼容的各种后端。

## 任务类型路由

基于任务类型选择模型：

| 类型 | 适用场景 | 模型配置 |
|------|----------|----------|
| vision | 图片识别、图像理解 | `agents.models.vision` |
| coder | 代码编写、程序开发 | `agents.models.coder` |
| chat | 常规对话、问答 | `agents.models.chat` |

### 路由流程

1. **图片检测**：检测消息中是否包含图片
2. **意图识别**：通过 LLM 判断任务类型
3. **模型选择**：根据任务类型选择对应模型
4. **回退机制**：未配置专用模型时使用 chat 模型

## 接口定义

```typescript
interface LLMProvider {
  readonly name: string;
  
  chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    model?: string,
    config?: GenerationConfig
  ): Promise<LLMResponse>;
  
  getDefaultModel(): string;
  isAvailable(): Promise<boolean>;
  getModelCapabilities(modelId: string): ModelConfig;
  listModels(): Promise<string[] | null>;
}
```

## 类型定义

### LLMMessage

```typescript
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface LLMMessage {
  role: MessageRole;
  content: MessageContent;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
```

### GenerationConfig

```typescript
interface GenerationConfig {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  frequencyPenalty?: number;
}
```

### LLMResponse

```typescript
interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  hasToolCalls: boolean;
  reasoning?: string;      // 深度思考模型的推理过程
  usage?: UsageStats;      // Token 使用统计
  usedProvider?: string;
  usedModel?: string;
}
```

## 内置 Provider

### OpenAICompatibleProvider

支持 OpenAI API 兼容的所有后端：

| Provider | baseUrl | 特点 |
|----------|---------|------|
| Ollama | `http://localhost:11434/v1` | 本地运行，无需 apiKey |
| GLM (智谱) | `https://open.bigmodel.cn/api/paas/v4` | 国产大模型 |
| DeepSeek | `https://api.deepseek.com/v1` | 深度推理模型 |
| MiniMax | `https://api.minimax.chat/v1` | 海螺 AI |
| Kimi (Moonshot) | `https://api.moonshot.cn/v1` | 长上下文 |
| OpenAI | `https://api.openai.com/v1` | GPT 系列 |

```typescript
import { OpenAICompatibleProvider } from '@microbot/sdk/providers';

const provider = new OpenAICompatibleProvider({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: 'deepseek-chat',
});
```

## 协议支持

| 协议 | 用途 | 说明 |
|------|------|------|
| ACP | IDE 集成 | 支持 Cursor、Claude Desktop 等 IDE 集成 |
| A2A | Agent 通信 | Agent 间通信协议 |
| MCP | 工具接入 | Model Context Protocol，外部工具/资源接入 |

## 源码位置

- 接口定义: `packages/providers/src/base.ts`
- OpenAI 兼容: `packages/providers/src/openai-compatible.ts`
- 模型网关: `packages/providers/src/gateway.ts`
- 智能路由: `packages/providers/src/router.ts`