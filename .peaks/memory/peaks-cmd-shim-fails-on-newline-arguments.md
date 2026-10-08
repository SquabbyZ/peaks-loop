---
name: peaks-cmd-shim-fails-on-newline-arguments
description: Windows 上 peaks 的 .cmd shim 只要参数含换行就报 InvalidBatchScriptArg；双引号与长单行都正常，换行是唯一触发条件
metadata:
  type: project
  createdAt: 2026-10-09
---

# Windows `.cmd` shim：参数含换行即 `InvalidBatchScriptArg`

## 事实（2026-10-09 二分实测，session `2026-10-09-session-90f47d`）

在 Windows 上，`peaks` 是 `.cmd` shim。它对参数的容忍度：

| 参数形态 | 结果 |
|---|---|
| 短 + **含换行** | ❌ `proxy failed to run peaks: InvalidBatchScriptArg` |
| 短 + 含双引号 | ✅ 通过 |
| 短 + 单行纯文本 | ✅ 通过 |
| 3481 字节 + 换行 + 双引号 | ❌ `InvalidBatchScriptArg` |

**结论：换行是唯一触发条件。** 双引号无害，长度本身不是主因。

## 复现

```bash
# 失败
peaks sub-agent dispatch rd --prompt "$(printf 'line one\nline two')" --request-id rid-035 --project . --json

# 成功
peaks sub-agent dispatch rd --prompt 'he said "quoted" ok' --request-id rid-035 --project . --json
```

## Why

PowerShell / cmd.exe 的批处理参数解析在遇到嵌入换行时无法界定参数边界，于是抛出 `InvalidBatchScriptArg`。这不是 peaks 的逻辑错误，是 shim 层的平台限制——但它在 peaks 的调用面上直接表现为「命令失败」，属于 [[peaks-loop-is-enhancement-not-new-cli]] 所说的"调用可靠性"问题。

## How to apply

- **给 `peaks` 传多行内容时，一律落地成文件，参数只传短单行指针。**
  这正是 `peaks sub-agent dispatch --write-artifact <path>` 的用法：CLI 拿指针，子代理读文件。
- 不要为了绕过它去压平多行内容（会破坏"逐字"契约，如 Karpathy 块）。
- 这是**MCP 能力面**要解决的真实痛点之一——MCP 的 typed 参数不经 shell，天然无此问题。见 [[peaks-loop-mcp-readonly-surface-design]]。
- 若要在产品侧根治，应属"平台适配层"职责，**不得**用平台特判分支（见 spec §8.2 / §14 R1）。
