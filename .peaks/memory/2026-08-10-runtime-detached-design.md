---
name: runtime-detached-design-2026-08-10
description: peaks-loop detached sub-agent design sediment — G8 infinite-context + LifecycleOwner closure + 5-phase ship
metadata:
  type: project
  createdAt: 2026-08-10
---

# peaks-loop detached sub-agent (design sediment)

> 5 Phase × 单 publish。 Phase A 含 G8（子进程无限上下文 + 不限费用）。

**Spec**: docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md
**Plan**: docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md

## Why

用户原话（2026-08-10 brainstorming 终态）：
> 「我想选择1和3这两种，实现真正的并行……实现真正的独立上下文和最小占用上下文效果最好」+「不要被费用过高中断，还有要使用 peaks 的 auto compact 实现无限上下文」+「就怕异常不仅无法继续还不会被回收，使得资源不断的被累积占用直至死机」。

现有 peaks sub-agent dispatch 是 IDE 内 Task（同 Claude Code 进程），共享 context，互相挤占。本 spec 新增 detached mode，真在 OS 起独立 headless LLM 子进程。

## How to apply

- 子进程 dispatch：`peaks sub-agent dispatch rd --mode detached --vendor claude`
- 进程生命周期：ProcessSupervisor + LifecycleOwner 闭环（pid/log/status/owner-session 100% 清理）
- G8 自动 compact：子进程 prompt 注入 `<peaks-auto-compact>` 标记；子代理 LLM 自监控 → 0.85/0.95 触发；scratch 文件写盘
- 性能护栏：runtime ≤ 200MB / CPU ≤ 5% / fan-out ≤ 8 / 子代理 ≤ 1.5GB / orphan ≤ 16
- 5 Phase：Phase A（核心 + claude + G8）/ B（codex+copilot）/ C（auditor）/ D（doctor bridge）/ E（dashboard hook）
- 新 package 名：`packages/peaks-loop-internal-runtime/` (npm name `peaks-loop-internal-runtime`) — sibling of peaks-loop-shared

## Red lines preserved

- SquabbyZ sole-author（无 Co-Authored-By trailer）
- Human-NL-Choice-Only（不引入新 CLI verb 给用户）
- 24h mode zero-pause（detached 让 24h 真放手）
- worktree L1/L2/L3（不破坏 sub-agent prompt 既有 verbatim block）
- vitest 锁 4.1.10 不升 5.x
- peaks-loop enhancement-not-new-cli
- RL-15 stale 不杀
- publish lockstep：runtime → shared → peaks-loop

## Related

- [[2026-08-10-runtime-detached-24h-user-confirm-2026-08-10]] — user 完整授权所有决策 sediment
- [[peaks-loop-publishing-critical-hard-rules]] — version lockstep chicken-egg
- [[peaks-vitest-locked-4-1-10]] — vitest 不升 5.x