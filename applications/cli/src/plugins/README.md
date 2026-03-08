# 用户插件系统

用户可以在 `~/.micro-agent/extensions/` 目录中开发功能性扩展插件。

## 目录结构

```
~/.micro-agent/extensions/
├── my-plugin/
│   ├── plugin.json    # 插件清单
│   └── index.ts       # 插件入口
```

## 插件清单 (plugin.json)

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "插件描述",
  "main": "index.ts",
  "commands": [
    {
      "id": "my-plugin.hello",
      "name": "hello",
      "description": "打招呼命令"
    }
  ],
  "hooks": ["onMessage", "onResponse"]
}
```

## 插件入口 (index.ts)

```typescript
import type { UserPlugin, PluginContext } from '@micro-agent/cli/plugins';

const plugin: UserPlugin = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '示例插件',

  async activate(context: PluginContext) {
    context.log('info', `插件已激活: ${context.pluginDir}`);

    // 注册命令
    context.registerCommand({
      id: 'my-plugin.hello',
      name: 'hello',
      description: '打招呼命令',
      handler: async (args) => {
        console.log('Hello from my plugin!', args);
      },
    });

    // 注册钩子
    context.registerHook({
      event: 'onMessage',
      handler: async (data) => {
        context.log('debug', `收到消息: ${JSON.stringify(data)}`);
      },
    });
  },

  async deactivate() {
    console.log('插件已停用');
  },
};

export default plugin;
```

## API 参考

### UserPlugin

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 插件唯一标识 |
| name | string | 是 | 插件名称 |
| version | string | 是 | 插件版本 |
| description | string | 否 | 插件描述 |
| activate | function | 是 | 激活函数 |
| deactivate | function | 否 | 停用函数 |

### PluginContext

| 属性 | 类型 | 说明 |
|------|------|------|
| pluginDir | string | 插件所在目录 |
| homeDir | string | 用户主目录 |
| workspace | string | 工作区目录 |
| registerCommand | function | 注册命令 |
| registerHook | function | 注册钩子 |
| log | function | 日志输出 |

## 内置事件钩子

- `onMessage`: 收到用户消息时触发
- `onResponse`: 发送响应前触发
- `onToolCall`: 调用工具时触发
- `onError`: 发生错误时触发
