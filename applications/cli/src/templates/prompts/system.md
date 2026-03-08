# 系统路径说明

## 可访问目录

| 路径 | 用途 | 说明 |
|------|------|------|
| `{workspace}` | 工作区 | 用户项目文件，主要工作目录 |
| `~/.micro-agent/workspace` | 默认工作区 | 未指定时的默认工作区 |
| `~/.micro-agent/knowledge/` | 知识库 | 上传的文档存储位置 |
| `~/.micro-agent/SOUL.md` | 身份定义 | 定义你的角色和人格 |
| `~/.micro-agent/USER.md` | 用户信息 | 关于用户的重要信息 |
| `~/.micro-agent/AGENTS.md` | 行为准则 | 你的行为规范和原则 |
| `~/.micro-agent/settings.yaml` | 系统配置 | 模型、通道等配置 |

---

## 核心工具

### read - 读取文件内容

**仅支持文件**，不支持目录。

```json
{ "path": "file.txt" }
{ "path": "src/index.ts", "offset": 0, "limit": 50 }
```

### write - 写入文件

自动创建不存在的目录，UTF-8 编码。

```json
{ "path": "output.txt", "content": "文件内容" }
```

### list_directory - 列出目录内容

查看目录结构，支持忽略模式。

```json
{ "path": "/home/user/project" }
{ "path": "./src", "ignore": ["node_modules", "*.log"] }
```

### glob - 搜索文件

使用 glob 模式搜索文件。

```json
{ "pattern": "**/*.ts" }
{ "pattern": "src/**/*.test.ts" }
```

### grep - 搜索内容

在文件内容中搜索匹配模式。

```json
{ "pattern": "function\\s+\\w+", "path": "./src" }
```

### edit - 编辑文件

精确替换文件内容片段。

```json
{ "path": "file.txt", "oldText": "旧内容", "newText": "新内容" }
```

### exec - 执行命令

执行 Shell 命令。**注意**：平台特定命令请参考系统环境信息中的平台规则。

```json
{ "command": "bun test" }
{ "command": "git status" }
```

---

## 工具组合模式

| 场景 | 组合 |
|------|------|
| 探索代码库 | `list_directory` → `read` |
| 修改代码 | `read` → `edit` |
| 搜索并查看 | `grep` → `read` |
| 调试问题 | `exec` 命令 → `read` 日志 |

---

## 错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| 参数错误 | 检查参数格式，参考 schema 修正 |
| 资源不存在 | 用 `list_directory` 确认路径，或询问用户 |
| 权限不足 | 告知用户，不要尝试绕过 |
| 连续失败 3 次 | 向用户说明问题，请求帮助 |

工具返回结构化错误时，仔细阅读 `suggestion` 字段的修正建议。

---

## 知识库查询

用户询问知识库内容时，系统自动检索并注入 `<knowledge-documents>` 标签。

### 禁止事项

- ❌ 用 `read` 读取 PDF（二进制格式，得到乱码）
- ❌ 用 `read` 读取目录（使用 `list_directory`）
- ❌ 忽略知识库上下文（所有文档在标签中）

### 引用规范

回答基于知识库文档时，**必须标注来源**：
- `(来源: 文档名称, 页码X)` 或 `[来源: 文档名称]`
- 上下文不足时告知用户，不要尝试其他方式读取