# 阶段 5：LLM Provider

**依赖**: 阶段 1（基础设施）  
**预计文件数**: 7  
**预计代码行数**: ~400 行

## 目标

实现 LLM Provider 系统，支持 Ollama、LM Studio、vLLM 和 OpenAI Compatible，并通过 Gateway 聚合。

## 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| V. 本地优先 | ✅ | 默认支持本地 LLM |
| III. 开放封闭 | ✅ | Provider 接口可扩展 |

## 文件清单

### 1. src/providers/base.ts

**职责**: Provider 基类和接口

```typescript
/** LLM 消息 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  hasToolCalls: boolean;
}

/** 工具定义（LLM 格式） */
export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Provider 接口 */
export interface ILLMProvider {
  /** Provider 名称 */
  readonly name: string;
  
  /** 聊天完成 */
  chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse>;
  
  /** 获取默认模型 */
  getDefaultModel(): string;
  
  /** 检查是否可用 */
  isAvailable(): Promise<boolean>;
}
```

**行数**: ~45 行

---

### 2. src/providers/ollama.ts

**职责**: Ollama Provider

```typescript
import type { ILLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './base';

/** Ollama 配置 */
interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
}

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434/v1',
  defaultModel: 'qwen3',
};

/**
 * Ollama Provider
 * 
 * 通过 OpenAI 兼容 API 连接本地 Ollama。
 */
export class OllamaProvider implements ILLMProvider {
  readonly name = 'ollama';

  constructor(private config: OllamaConfig = DEFAULT_CONFIG) {}

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model ?? this.config.defaultModel,
        messages,
        tools: tools?.length ? tools : undefined,
      }),
    });

    const data = await response.json() as { choices: Array<{ message: { content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const choice = data.choices[0];

    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message.content,
      toolCalls,
      hasToolCalls: !!toolCalls?.length,
    };
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl.replace('/v1', '')}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

**行数**: ~60 行

---

### 3. src/providers/lm-studio.ts

**职责**: LM Studio Provider

```typescript
import type { ILLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './base';

interface LMStudioConfig {
  baseUrl: string;
  defaultModel: string;
}

const DEFAULT_CONFIG: LMStudioConfig = {
  baseUrl: 'http://localhost:1234/v1',
  defaultModel: 'local-model',
};

/**
 * LM Studio Provider
 */
export class LMStudioProvider implements ILLMProvider {
  readonly name = 'lm-studio';

  constructor(private config: LMStudioConfig = DEFAULT_CONFIG) {}

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model ?? this.config.defaultModel,
        messages,
        tools: tools?.length ? tools : undefined,
      }),
    });

    const data = await response.json() as { choices: Array<{ message: { content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const choice = data.choices[0];

    return {
      content: choice.message.content,
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      hasToolCalls: !!choice.message.tool_calls?.length,
    };
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

**行数**: ~55 行

---

### 4. src/providers/vllm.ts

**职责**: vLLM Provider

```typescript
import type { ILLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './base';

interface VLLMConfig {
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
}

/**
 * vLLM Provider
 */
export class VLLMProvider implements ILLMProvider {
  readonly name = 'vllm';

  constructor(private config: VLLMConfig) {}

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model ?? this.config.defaultModel,
        messages,
        tools: tools?.length ? tools : undefined,
      }),
    });

    const data = await response.json() as { choices: Array<{ message: { content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const choice = data.choices[0];

    return {
      content: choice.message.content,
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      hasToolCalls: !!choice.message.tool_calls?.length,
    };
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

**行数**: ~55 行

---

### 5. src/providers/openai-compatible.ts

**职责**: 通用 OpenAI Compatible Provider

```typescript
import type { ILLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './base';

interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

/**
 * OpenAI Compatible Provider
 * 
 * 支持 OpenAI、DeepSeek、Gemini 等云服务。
 */
export class OpenAICompatibleProvider implements ILLMProvider {
  readonly name = 'openai-compatible';

  constructor(private config: OpenAICompatibleConfig) {}

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: model ?? this.config.defaultModel,
        messages,
        tools: tools?.length ? tools : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`API 错误: ${response.status}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const choice = data.choices[0];

    return {
      content: choice.message.content,
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      hasToolCalls: !!choice.message.tool_calls?.length,
    };
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }
}
```

**行数**: ~55 行

---

### 6. src/providers/gateway.ts

**职责**: LLM Gateway（多 Provider 聚合）

```typescript
import type { ILLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './base';

/** Provider 配置 */
interface ProviderEntry {
  provider: ILLMProvider;
  models: string[];
  priority: number;
}

/** Gateway 配置 */
interface GatewayConfig {
  defaultProvider: string;
  fallbackEnabled: boolean;
}

/**
 * LLM Gateway
 * 
 * 聚合多个 Provider，支持自动路由和故障转移。
 */
export class LLMGateway {
  private providers = new Map<string, ProviderEntry>();

  constructor(private config: GatewayConfig = { defaultProvider: 'ollama', fallbackEnabled: true }) {}

  /** 注册 Provider */
  registerProvider(name: string, provider: ILLMProvider, models: string[], priority: number = 100): void {
    this.providers.set(name, { provider, models, priority });
  }

  /** 聊天（自动路由到合适的 Provider） */
  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], model?: string): Promise<LLMResponse> {
    const providerName = this.findProvider(model);
    const entry = this.providers.get(providerName);

    if (!entry) {
      throw new Error(`未找到 Provider: ${providerName}`);
    }

    try {
      return await entry.provider.chat(messages, tools, model);
    } catch (error) {
      if (this.config.fallbackEnabled) {
        return this.fallback(messages, tools, model, providerName);
      }
      throw error;
    }
  }

  /** 故障转移 */
  private async fallback(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    model?: string,
    failedProvider: string
  ): Promise<LLMResponse> {
    const sorted = Array.from(this.providers.entries())
      .filter(([name]) => name !== failedProvider)
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [name, entry] of sorted) {
      if (await entry.provider.isAvailable()) {
        return entry.provider.chat(messages, tools, model);
      }
    }

    throw new Error('所有 Provider 不可用');
  }

  /** 查找支持指定模型的 Provider */
  private findProvider(model?: string): string {
    if (!model) return this.config.defaultProvider;

    for (const [name, entry] of this.providers) {
      if (entry.models.includes(model) || entry.models.includes('*')) {
        return name;
      }
    }

    return this.config.defaultProvider;
  }

  getDefaultModel(): string {
    const entry = this.providers.get(this.config.defaultProvider);
    return entry?.provider.getDefaultModel() ?? 'qwen3';
  }

  async isAvailable(): Promise<boolean> {
    for (const entry of this.providers.values()) {
      if (await entry.provider.isAvailable()) return true;
    }
    return false;
  }
}
```

**行数**: ~85 行

---

### 7. src/providers/registry.ts

**职责**: Provider 注册表

```typescript
import type { ILLMProvider } from './base';
import { OllamaProvider } from './ollama';
import { LMStudioProvider } from './lm-studio';
import { VLLMProvider } from './vllm';
import { OpenAICompatibleProvider } from './openai-compatible';
import { LLMGateway } from './gateway';
import type { ProviderConfig } from '../config/schema';

/**
 * 创建 Provider 注册表
 */
export function createProviderRegistry(config: ProviderConfig): LLMGateway {
  const gateway = new LLMGateway();

  // Ollama
  if (config.ollama) {
    gateway.registerProvider('ollama', new OllamaProvider({
      baseUrl: config.ollama.baseUrl,
      defaultModel: 'qwen3',
    }), config.ollama.models ?? ['qwen3'], 1);
  }

  // LM Studio
  if (config.lmStudio) {
    gateway.registerProvider('lm-studio', new LMStudioProvider({
      baseUrl: config.lmStudio.baseUrl,
      defaultModel: 'local-model',
    }), config.lmStudio.models ?? ['*'], 2);
  }

  // vLLM
  if (config.vllm) {
    gateway.registerProvider('vllm', new VLLMProvider({
      baseUrl: config.vllm.baseUrl,
      defaultModel: config.vllm.models?.[0] ?? 'default',
    }), config.vllm.models ?? [], 3);
  }

  // OpenAI Compatible
  if (config.openaiCompatible) {
    gateway.registerProvider('openai-compatible', new OpenAICompatibleProvider({
      baseUrl: config.openaiCompatible.baseUrl,
      apiKey: config.openaiCompatible.apiKey,
      defaultModel: config.openaiCompatible.models?.[0] ?? 'gpt-4',
    }), config.openaiCompatible.models ?? [], 10);
  }

  return gateway;
}
```

**行数**: ~55 行

---

## 任务清单

| # | 任务 | 文件 | 行数 |
|---|------|------|------|
| 1 | 定义 Provider 接口 | `src/providers/base.ts` | ~45 |
| 2 | 实现 Ollama Provider | `src/providers/ollama.ts` | ~60 |
| 3 | 实现 LM Studio Provider | `src/providers/lm-studio.ts` | ~55 |
| 4 | 实现 vLLM Provider | `src/providers/vllm.ts` | ~55 |
| 5 | 实现 OpenAI Compatible | `src/providers/openai-compatible.ts` | ~55 |
| 6 | 实现 LLM Gateway | `src/providers/gateway.ts` | ~85 |
| 7 | 实现 Provider 注册表 | `src/providers/registry.ts` | ~55 |

## 验收标准

- [ ] Ollama Provider 可连接本地 Ollama
- [ ] Gateway 支持自动路由
- [ ] Gateway 支持故障转移
- [ ] 所有 Provider 实现统一接口

## 下一步

完成本阶段后，进入 [阶段 6：Agent 核心](./phase-6-agent.md)
