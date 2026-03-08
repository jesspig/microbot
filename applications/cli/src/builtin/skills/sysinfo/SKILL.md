---
name: sysinfo
description: 系统信息工具 - 获取 CPU/内存/磁盘/网络/进程等系统信息
dependencies:
  - bun>=1.0
compatibility: bun
always: true
allowed-tools: []
---

# 系统信息工具

多功能系统监控工具，支持获取各类系统资源信息。

## 执行方式

使用以下命令获取系统信息：

```bash
# CPU 信息
bun <skill-dir>/scripts/index.ts --type cpu

# 内存信息
bun <skill-dir>/scripts/index.ts --type mem

# 磁盘信息
bun <skill-dir>/scripts/index.ts --type disk

# 网络信息
bun <skill-dir>/scripts/index.ts --type network

# 进程信息
bun <skill-dir>/scripts/index.ts --type process

# 系统概览
bun <skill-dir>/scripts/index.ts --type sys

# 全部信息
bun <skill-dir>/scripts/index.ts --type all

# JSON 格式输出
bun <skill-dir>/scripts/index.ts --type cpu --json
```

## 命令行选项

| 选项 | 说明 |
|------|------|
| `--type, -t` | 信息类型: cpu/mem/disk/network/process/sys/all |
| `--json, -j` | JSON 格式输出 |

## 输出示例

### CPU 信息
```
CPU:
  cores: 8
  model: AMD Ryzen 7 5800X
  usage: 35.2%
  loadavg: 1.5,1.2,0.9
```

### 内存信息
```
内存:
  total: 32.00 GB
  used: 16.50 GB
  free: 15.50 GB
  usage: 51.6%
```

### 磁盘信息
```
磁盘:
  [0] {"drive":"C:","total":"500.00 GB","used":"320.50 GB","free":"179.50 GB","usage":"64.1%"}
```