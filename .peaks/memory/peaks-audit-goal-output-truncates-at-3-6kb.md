---
name: peaks-audit-goal-output-truncates-at-3-6kb
description: peaks audit goal 的 LLM 响应在约 3.6 KB 处被截断，导致 INCOMPLETE_AUDIT Invalid JSON；短 need 才能通过，因此该命令无法审计 spec 规模的输入
metadata:
  type: project
  createdAt: 2026-10-09
---

# `peaks audit goal` 的输出在约 3.6 KB 处被截断

## 事实（2026-10-09 实测，session `2026-10-09-session-90f47d`）

对同一个 six-dimension 审计，三次调用的结果：

| 次数 | need 长度 | 结果 |
|---|---|---|
| 1 | ~1900 字符（含换行） | ❌ 更早的平台错：`InvalidBatchScriptArg`（见 [[peaks-cmd-shim-fails-on-newline-arguments]]） |
| 2 | 1683 字符（单行） | ❌ `INCOMPLETE_AUDIT`，`LLM output is not valid JSON: Unterminated`，截断于 **3914 字节** |
| 3 | 848 字符（单行） | ❌ `INCOMPLETE_AUDIT`，截断于 **3619 字节**（position 3619） |
| 4 | 320 字符（单行） | ✅ 成功，六维完整 |

**关键观察**：第 2 次和第 3 次的截断点分别是 3914 / 3619 字节——**都在 3.6 KB 附近，与 need 长度无关**。说明约束在**输出侧**（响应 token 上限），不是输入侧。

## Why

`auditGoal()` 要求返回一个**完整六维 + successCriteria + rationale** 的 JSON，且技能文档要求"必须一次通过、让人一次读完"。但这个体量的输出本身就接近上限，一旦 need 稍复杂，模型还没写完 JSON 就被切断 → `IncompleteAuditError`。

结果是**自相矛盾**：它声明要压缩"让人类一次 OK 的判定"，却撑不到那个信息量。

## How to apply

- **审计 spec 规模的输入时，不要指望 `peaks audit goal` 一次给出完整判定。** 把 need 压到 300 字符以内更容易成功。
- 若需要审计长文档，正确姿势是**先人工压缩成判决要点，再喂短 need**——而不是把 spec 原文塞进去。
- 这是**工具缺陷**，值得独立修复（提高该调用的 max_tokens，或分维度多次调用后合并）。
- 用 `audit-goal` 做 spec 审计时要**先看 `ok`**：`INCOMPLETE_AUDIT` 不是"审计说没问题"，是**根本没产生审计**。切忌把它当成通过。
