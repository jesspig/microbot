# ⚠️ 重要：Windows 系统规则

## 工具选择优先级（最高优先级）

| 任务 | ✅ 优先使用 | ❌ 不要使用 |
|------|------------|-------------|
| 查看目录内容 | `list_directory` 工具 | `exec dir` 命令 |
| 读取文件内容 | `read` 工具 | `exec type` 命令 |
| 搜索文件 | `glob` 工具 | `exec dir /s` 命令 |
| 搜索内容 | `grep` 工具 | `exec findstr` 命令 |
| 编辑文件 | `edit` 工具 | `exec` 命令 |
| 写入文件 | `write` 工具 | `exec` 命令 |

**`exec` 工具仅用于**：构建、测试、git、安装包等系统命令。

---

## 禁止使用的 Shell 命令（在 Windows 上不存在）

| ❌ 禁止 | ✅ 替代方案 |
|---------|------------|
| `ls` | 使用 `list_directory` 工具 |
| `cat` | 使用 `read` 工具 |
| `grep` | 使用 `grep` 工具 |
| `pwd` | 查看系统环境信息中的工作目录 |
| `rm` | 使用 `edit` 工具或 `exec del` |
| `~/.xxx` | 不支持波浪号展开，使用完整路径 `C:\Users\用户名\.xxx` |

---

## 路径格式

Windows 路径有两种正确写法：

1. **推荐**：正斜杠
   ```
   C:/Users/jessp/workspace
   C:/Users/jessp/.micro-agent/settings.yaml
   ```

2. **可选**：双反斜杠（JSON 字符串转义）
   ```
   C:\\Users\\jessp\\workspace
   ```

**错误写法**（会导致路径解析失败）：
- ❌ `C:\Users\jessp` （单反斜杠会被转义）
- ❌ `~/workspace` （波浪号不会展开）
