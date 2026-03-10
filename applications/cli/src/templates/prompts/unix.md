# 跨平台命令指南

> **当前系统**: Unix-like (Linux/macOS)

## 工具选择优先级（最高优先级）

| 任务 | ✅ 优先使用 | ❌ 不要使用 |
|------|------------|-------------|
| 查看目录内容 | `list_directory` 工具 | `exec ls` 命令 |
| 读取文件内容 | `read` 工具 | `exec cat` 命令 |
| 搜索文件 | `glob` 工具 | `exec find` 命令 |
| 搜索内容 | `grep` 工具 | `exec grep` 命令 |
| 编辑文件 | `edit` 工具 | `exec sed` 命令 |
| 写入文件 | `write` 工具 | `exec` 命令 |

**`exec` 工具仅用于**：构建、测试、git、安装包等系统命令。

---

## 常用命令（仅用于 exec 工具）

当需要使用 `exec` 工具执行系统命令时：

```bash
# 列出目录
ls -la /home/user/workspace

# 查看文件（如果 read 工具不可用）
cat ~/.micro-agent/settings.yaml

# 搜索文件
find . -name "*.ts"

# 搜索内容
grep -r "pattern" ./src
```

---

## 路径格式

- 家目录：`~/.micro-agent/`
- 工作目录：`./` 或相对路径
- 绝对路径：`/home/user/project`
