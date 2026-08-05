# Session Overload Signal Index

> Single-source lookup for the LLM-side "should I open a new session?" decision.
> Slice 2026-08-05-session-overload-signal-index.

## What this doc is

When the LLM senses context pressure, it must consult these 7 signals before
deciding to (a) auto-compact, (b) refuse the next slice, or (c) ask the user to
open a new session. The contract is: **LLM never re-asks the user about
cost/length/context** (red line #2 of `references/job-loop.md`). This index is
the lookup table the LLM must consult in lieu of intuition.

## The 7 signals

| # | Signal source | Threshold | File / CLI | LLM action |
|---|---|---|---|---|
| 1 | prompt size (main session) | 50% / 75% / 80% / 90% | `src/services/context/threshold.ts`; probe via `peaks code context-now` | soft-warn at 50%; consider compact at 75%; MUST NOT auto-compact mid-batch (D6.e); Job mode ≥ 0.85 ⇒ MANDATORY `peaks compact auto --execute` |
| 2 | auto-compact zone | 0.85 pre-compact / 0.95 red-line | `src/services/code/auto-compact-orchestrator.ts`; `--enforce-job-mode` flag | Auto-fires `peaks compact auto --execute`; LLM MUST NOT prompt user to compact (zero-pause contract v2.13.0) |
| 3 | sub-agent dispatch prompt size | 50% / 75% / 80% | `src/services/context/context-guard.ts`; `peaks sub-agent-dispatch-guard` PreToolUse hook | soft-warn at 50%; CONTEXT_NEAR_LIMIT at 75%; hard-reject at 80% (CLI + hook double-guard) |
| 4 | statusline compact bar | visual | `src/services/compact-statusline/compact-statusline-service.ts` | ambient UI; surfaces queued/preparing/compacting/verifying/completed/failed/stalled |
| 5 | in-flight batch deferral | D6.e | `src/services/code/auto-compact-modes.ts` | defer compact until batch lands (NOT "new session") |
| 6 | compact stalled | 120s heartbeat timeout | `compact-lifecycle-store.ts` | ambient "stalled" detail in statusline |
| 7 | sub-agent heartbeat missing | per-role TTL | `peaks sub-agent heartbeat`; `peaks heartbeat-watch` | orchestrator-side warning, not LLM-driven "new session" |

## Hard rules

- peaks-code SKILL.md red line #2 (see `references/job-loop.md`):
  **Re-ask the user about cost / length / context is forbidden**.
  The LLM MUST NOT prompt the user to open a new session based on overload
  intuition alone; it MUST consult the 7 signals above and prefer auto-compact /
  sub-agent dispatch guard / heartbeat-watch first.
- "Open a new session" is a **last resort** after auto-compact has been
  attempted and the slice cannot fit. The user's role is to receive the
  handoff capsule, not to micro-manage session lifecycle.

## Decision flowchart

```
LLM senses context pressure
  ├─► Probe `peaks code context-now --json`
  │   ├─ ratio < 0.50  → continue (no action)
  │   ├─ 0.50 ≤ ratio < 0.75 → soft-warn; continue
  │   ├─ 0.75 ≤ ratio < 0.85 → compact-zone candidate
  │   │     ├─ Job mode → MUST auto-compact now
  │   │     └─ non-Job  → wait for next idle turn, then compact
  │   ├─ 0.85 ≤ ratio < 0.95 → pre-compact zone; auto-compact MUST fire
  │   └─ ratio ≥ 0.95       → red-line; synchronous gate (Karpathy §4)
  ├─► Check statusline compact bar (signal #4)
  │   ├─ queued / preparing / compacting / verifying → wait
  │   ├─ failed → read failure reason, do NOT spawn new session
  │   └─ stalled (>120s) → surface to user as a blocker, not a new-session ask
  └─► Check sub-agent dispatch guard (signal #3)
      ├─ 75% CONTEXT_NEAR_LIMIT → warn, continue with smaller prompt
      └─ 80% PROMPT_TOO_LARGE → hard-reject; refactor the prompt

Only after ALL three checks above have been attempted without resolution:
emit the `peaks session split-handoff` capsule (NOT in this slice; follow-up)
and the user opens a new session in their own time.
```