---
name: two-components-resolved-the-window-independently
description: peaks-loop 按自己解析的窗口算比例，harness 按它自己的窗口触发 —— 两者无任何机制保持相同，导致红线早触发数倍并死锁
metadata:
  type: project
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-12T16:18:01.138Z
---

**死锁根因（2026-09-13 定位）：peaks-loop 与 Claude Code 各自独立解析「上下文窗口」，没有任何东西保证两者相同。**

| | 用哪个窗口 |
|---|---|
| **Claude Code** 触发压缩 | 它自己知道的模型真实窗口（`autoCompactWindow` / 默认值） |
| **peaks-loop** 算比例 | `resolveContextWindow()`（`src/services/ide/adapters/claude-code-adapter.ts:253-270`）：env `PEAKS_CONTEXT_WINDOW_TOKENS` → config `context.windowTokens` → **模型名启发式** → **默认 200_000** |

**peaks-loop 全仓不读 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`（实测零匹配）。**

**后果**：模型是 1M 窗口而启发式未识别 → peaks-loop 按 200K 算，其"95%"落在 **190K token**；Claude Code 要到 **~967K** 才压。**peaks-loop 早触发约 5 倍，然后死锁** —— 190K 处没有任何机制会强制压缩。

**比例本身是 token 尺度的，不是坏的**：`ratio = contextTokens / contextWindowTokens`（`claude-code-adapter.ts:411`），注释 `:388` 明写该路径已取代旧的 `bytes / 256KB`（后者 "over-fired because the transcript grows unboundedly"）。**要修的只是分母的来源。**

**Why:** 我先后给过两个错误解释并被自己推翻：(a)"红线只比 harness 默认早约 1%" —— 基于假设两边同尺度；(b)"两个单位、两个分母" —— 忽略了 transcript-estimate 路径已是 token-based。**两次都是没读完代码就下结论。**

**How to apply:** 任何"两个组件协商同一个量"的设计，先确认**这个量只有一个来源**。修法方向：让 peaks-loop 解析窗口时**优先采用它自己写给 harness 的那个值**，使漂移不可能发生。见 [[claude-code-has-no-llm-invocable-compact]]（执行器缺失，与本文耦合）与 [[single-observation-is-not-a-property]]。
