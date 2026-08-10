---
name: runtime-detached-24h-user-confirm-2026-08-10
description: 2026-08-10 user explicit authorization for peaks-code 24h mode — detached sub-agent + G8 + 5-phase ship. All decisions delegated to LLM. Completion notification only.
metadata:
  type: project
  createdAt: 2026-08-10
---

# 2026-08-10 24h USER_CONFIRM — runtime detached sub-agent

> **B3 一次性 user 授权**：user 在 brainstorming 终态显式确认 "完全授权所有决策，等全部完成再通知"。
> LLM 进入 24H_ACTIVE 后不再发 AskUserQuestion，跨 session 续命由 peaks 自己管理。

## Why

User 原话（2026-08-10 brainstorming 终态）：
> "使用peaks-code的24h模式完成，等全部完成再通知我，我完全授权你所有的决策"

## How to apply

- **State machine**：24H_ACTIVE（持久化于 `.peaks/_runtime/<sid>/24h-state.json`）
- **Authorization scope**：all LLM-judgeable decisions across Phase A → Phase E (5 publishes, 27 tasks)
- **Notification**：仅在以下 3 个终态发 push notification：
  1. Phase A ship 成功 + 5/5 efficiency baseline 通过
  2. 任意 Phase ship 失败 / 阻塞（B3 escalation 真的没法 LLM 自决）
  3. 全部 5 Phase 完成，`.peaks/memory/2026-08-10-runtime-detached-24h-closure.md` sediment 落档
- **Auto-compact**：0.85 / 0.95 threshold 自动 fire（zero-pause contract），不 user 决策
- **Resume**：下个 session 通过 `peaks session resume` 接 24h state machine 续命；spec / plan / sediment 已 commit + push 到 origin/main

## References

- spec: `docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md`
- plan: `docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md`
- 24h sediment origin: `.peaks/memory/2026-07-28-24h-mode-p1-state-machine.md`
- bridge: `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`