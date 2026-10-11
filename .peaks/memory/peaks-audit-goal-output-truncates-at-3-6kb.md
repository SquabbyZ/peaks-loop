---
name: peaks-audit-goal-output-truncates-at-3-6kb
description: peaks audit goal 曾在 2026-10-09 于约 3.6 KB 处截断；2026-10-11 用更长的 need 未能复现，且代码自 2026-09-19 起未变 —— 当时归因的"输出 token 上限"与代码矛盾，更可能是当时的环境性失败
metadata:
  type: project
  createdAt: 2026-10-09
  updated: 2026-10-11
---

# `peaks audit goal` 在约 3.6 KB 处截断 —— **记录已修正，见下**

> ⚠️ **先读这段。** 本条目原先断言截断源于"输出 token 上限"，并建议"提高该调用的
> max_tokens"。**那个归因是错的，不要再照它改代码。** 2026-10-11 的复核见
> 「复核」一节。

## 原始观察（2026-10-09，session `2026-10-09-session-90f47d`）

对同一个 six-dimension 审计，四次调用的结果：

| 次数 | need 长度 | 结果 |
|---|---|---|
| 1 | ~1900 字符（含换行） | ❌ 更早的平台错：`InvalidBatchScriptArg`（见 [[peaks-cmd-shim-fails-on-newline-arguments]]） |
| 2 | 1683 字符（单行） | ❌ `INCOMPLETE_AUDIT`，`LLM output is not valid JSON: Unterminated`，截断于 **3914 字节** |
| 3 | 848 字符（单行） | ❌ `INCOMPLETE_AUDIT`，截断于 **3619 字节**（position 3619） |
| 4 | 320 字符（单行） | ✅ 成功，六维完整 |

当时的推论是：截断点都在 3.6 KB 附近且与 need 长度无关 ⇒ 约束在输出侧（响应 token 上限）。

## 复核（2026-10-11，session `2026-10-11-session-5ac396`）—— **未能复现**

```
peaks audit goal --project . --need "<1145 字符单行 need>" --json
→ exit 0, ok: true, status: "audit-complete"
→ result.audit = 6 维齐全；successCriteria 10 条；信封 6769 字节
```

三次事实，合起来推翻了原来的归因：

1. **复现失败**：1145 字符的 need（比原记录的 848 字符**更长**）这次产出了**完整**六维，
   信封 6769 字节，远超原来那个 3619 字节的"截断点"。
2. **代码没动过**：`src/services/audit/audit-goal-service.ts` 自 **2026-09-19**
   （`cf21d188`）起一行未改。2026-10-09 那次实测与今天跑的是**同一份代码**。
3. **归因与代码矛盾**：`maxTokens` 早在 **2026-09-12**（`6fb10a06`）就从 2000 提到了
   **8000**，即**早于那次实测近一个月**——而 3.6 KB 的 JSON 远用不到 8000 token。
   该 commit 的注释记的正是同一个症状，说明当时有人已经处理过这条路径。

⇒ 原记录把一次**环境性失败**（provider / 网络 / 模型侧当刻的截断）记成了**代码缺陷**。

## How to apply（已按复核改写）

- **不要**为了提高 max_tokens 去改 `audit-goal-service.ts`——它已经是 8000，且方向对不上。
- 见到 `INCOMPLETE_AUDIT` 且文本含 `Unterminated` 时，**先重跑一次**再下结论：这是一次
  截断，不是判定。长 need 并不是触发条件（1145 字符已实测通过）。
- 仍然成立的那一半：`INCOMPLETE_AUDIT` **不是**"审计说没问题"，是**根本没产生审计**。
  读 `ok`，别把它当通过。
- 若它再次稳定复现，那才是新证据——那时该查的是 provider 侧，而不是这个常量。

## 仍未做的（留给未来）

`INCOMPLETE_AUDIT` 目前把"响应被截断"和"模型吐了非 JSON"压成同一个错误码，调用方分不出。
若截断再次出现，可考虑让该错误带上 `stop_reason`。**本条目不做这个决定**，只记下这个口子。
