---
name: time
description: 时间处理工具 - 获取时间、时区转换、时间差计算、时间戳转换
dependencies:
  - bun>=1.0
compatibility: bun
always: true
allowed-tools: []
---

# 时间处理工具

多功能时间工具，支持时区转换、时间差计算、时间戳转换等。

## 执行方式

```bash
# 获取当前时间
bun <skill-dir>/scripts/index.ts

# 指定时区
bun <skill-dir>/scripts/index.ts --timezone Asia/Tokyo

# 自定义格式
bun <skill-dir>/scripts/index.ts --format "YYYY年MM月DD日 dddd"

# 计算时间差
bun <skill-dir>/scripts/index.ts --diff "2026-12-31"

# 时间戳转日期
bun <skill-dir>/scripts/index.ts --timestamp 1700000000

# 输出 Unix 时间戳
bun <skill-dir>/scripts/index.ts --unix
```

## 命令行选项

| 选项 | 说明 |
|------|------|
| `--timezone` | 指定时区 (如: Asia/Shanghai, America/New_York) |
| `--format` | 自定义格式 |
| `--diff` | 计算时间差 (日期字符串) |
| `--timestamp` | 时间戳转日期 |
| `--unix` | 输出当前 Unix 时间戳 |

## 格式占位符

| 占位符 | 说明 |
|--------|------|
| YYYY | 四位年份 |
| YY | 两位年份 |
| MM | 月份 (01-12) |
| DD | 日期 (01-31) |
| HH | 小时 (00-23) |
| mm | 分钟 (00-59) |
| ss | 秒 (00-59) |
| SSS | 毫秒 |
| dddd | 星期几 (星期一) |
| ddd | 星期几简写 (周一) |

## 常用时区

- `Asia/Shanghai` - 中国
- `Asia/Tokyo` - 日本
- `America/New_York` - 美国东部
- `America/Los_Angeles` - 美国西部
- `Europe/London` - 英国
- `Europe/Paris` - 法国

## 输出示例

```
系统时间: 2026-02-18 15:30:45
UTC 时间: 2026-02-18 07:30:45
```