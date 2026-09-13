---
name: compact-calibration-is-automatic-but-not-yet-accumulating
description: auto-compact 标定数据自动产生，但需要比例跨过 85% 再回落；现有 163 行是旧格式不可用；窗口设成 1M 后可能要等很久
metadata:
  type: project
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-13T10:28:09.116Z
---

**"由 peaks-loop 决定压缩触发点"只差标定数据。它自动产生，但有前提，而且启动很慢。**

**自动链条**（无需任何人工步骤）：

```
比例跨过 85%
  → `peaks code auto-compact` 派发 → 写一条 dispatch 行 + 开 lifecycle run（stage = armed）
  → 之后任意一次探测发现比例已跌回阈值之下
  → `settleOpenLifecycleRun` 结算 → 写一条 observed 行（带 afterRatio + windowTokens）
```

"之后任意一次探测"是自动的：`peaks code context-now` 每轮都在跑（`gate-step-08` 的 PreToolUse 钩子 + auto-compact 的钩子）。**用户照常用即可。**

**接缝已验证**：`auto-compact-lifecycle.ts:283` 的早退守卫是
`if (prior.stage !== 'compacting' && prior.stage !== 'armed') return null;`
—— **`armed` 可结算**，所以 A1 之后那种"设好触发器等 95%"的静止态**不会**挡住 observed 行。

**两个坑：**

1. **现有历史全是废的。** `.peaks/_runtime/<sid>/compact-history.jsonl` 实测：163 行，**有 `kind` 字段的 0 条、有 `windowTokens` 的 0 条**，末行早于 A1 落地。标定要的正是 `windowTokens`（intent vs observed 的对比基准），所以**从零开始攒**。

2. **可能要等很久。** 窗口现在被设成 **1000000**（`CLAUDE_CODE_AUTO_COMPACT_WINDOW`），比例要跨过 85% 需要**约 850K token 的长会话**。旧数据里的 `beforeRatio` 0.84–0.88 是按旧分母（~200K）算的 —— **同一个 85% 线，现在要 5 倍的量。** 不要承诺"用几天就行"。

**怎么知道开始了**：数 `kind === 'observed'` 的行数，从 0 变成 ≥1 就是成了。

**唯一未验证的一环**：**没有人在一次*真实*压缩之后观察过它。** 若真实压缩发生了而 observed 行没增加，那就是缺陷 —— 报出来，别当成"还没到时候"。

相关：[[claude-code-has-no-llm-invocable-compact]] · [[two-components-resolved-the-window-independently]] · [[writing-a-value-then-reading-it-back-locks-the-first-guess]]。
