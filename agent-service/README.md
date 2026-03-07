# Agent Service

Agent 运行时服务 - 纯 Agent 逻辑执行环境。

## 职责

- **不负责**: 认证、多用户管理、API 网关、配置持久化
- **负责**: Agent 逻辑执行、工具调用、记忆管理、知识检索

## 结构

```
agent-service/
├── interface/          # 通信层
│   ├── ipc/           # IPC 内部通信（主要）
│   ├── http/          # HTTP 调试接口（可选）
│   └── streaming/     # 流式响应
├── runtime/           # 运行时层
│   ├── kernel/        # 内核（编排/规划/执行/上下文）
│   ├── capability/    # 能力层（工具/技能/MCP/记忆/知识）
│   ├── provider/      # 提供者层（LLM/嵌入/向量/存储）
│   └── infrastructure/# 基础设施（数据库/缓存/日志）
└── types/             # 类型定义
```

## 使用

通过 SDK 调用，不直接暴露 API。

## 测试

```bash
bun test agent-service/tests/
```
