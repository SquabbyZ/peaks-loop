---
name: sub-agent-heartbeat-progress-red-line
description: Sub-agent heartbeat + dynamic progress red line — Dispatcher must see live progress during batch sync, not be misread as dead
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/prd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md
---

User hard rule (2026-06-07 1:30 GMT+8): "最好是任务全部派发完有个心跳机制可以动态的更新各自进度给 dispatcher,这样就不会被误认为假死". This is the **heartbeat + dynamic progress** red line for peaks agentTeam's pseudo-swarm model. It is orthogonal to G1 (abstraction) / G2 (CLI primitive) / G3 (skill surface) / G4 (R-2 path safety) / G5 (resource lifecycle); registered as G6 in slice #009 PRD.

## Why

peaks agentTeam is a pseudo-swarm — Dispatcher static-batches N sub-agents per message, sub-agents work concurrently, Dispatcher waits for ALL of them to finish before reducing. The LLM platform (Claude Code / Trae) supports concurrent sub-agents but **does not** expose sub-agent progress to the Dispatcher during the wait. The result: 30s–2min of silence after `peaks sub-agent dispatch rd --json` returns N toolCalls and the LLM platform starts running them. The user sees a frozen terminal and reasonably assumes the system is dead. The user's literal phrasing: "**这样就不会被误认为假死**".

This is **not** about LLM-platform observability (R-1 / R-8 known boundary: peaks cannot observe LLM behavior). It is about **building a write channel the sub-agent actively uses** to keep the Dispatcher informed, and a read channel the Dispatcher polls during the wait.

## The rule (RL-13..RL-16)

**RL-13 Heartbeat cadence.** Sub-agents running > 30s MUST write ≥ 1 heartbeat. Default 30s; overridable in SKILL.md via `heartbeatIntervalSec: 15` (or any value). Too-frequent (< 5s) = IO noise + record JSON bloat. Too-rare (> 60s) = user thinks it's dead. 30s is the empirical sweet spot.

**RL-14 Heartbeat must not block.** `peaks sub-agent heartbeat` is **fire-and-forget** (async). Sub-agent must NOT wait for disk write to complete before continuing business logic. Implementation: `fs.appendFile` + atomic rename non-blocking; if write fails, emit warning, do NOT retry, do NOT throw.

**RL-15 Stale ≠ dead.** `status: 'stale'` is a user-visible warning, not a failure. LLM platform slowness is legitimate (R-1). Poller MUST NOT cancel, MUST NOT kill, MUST NOT send SIGTERM. Just mark `status: 'stale'` in the aggregate, emit `⚠ stale (last beat Xs ago)` to status line, let the user decide whether to cancel manually.

**RL-16 Heartbeats write + GC.** `heartbeats[]` is append-only for audit, but bounded: > 100 entries → truncate to most recent 100 + set `truncated: true`. Unbounded growth would let a single record JSON balloon to MB. Truncation is LLM-friendly: stale heartbeats are not informative.

## The three-layer contract

| Layer | Who | What | Cadence |
|---|---|---|---|
| **Sub-agent writes** | The sub-agent while running | Calls `peaks sub-agent heartbeat --record <dispatchRecordPath> --status <state> --progress <pct> --note "<text>"` to append a heartbeat to the record JSON | 30s default; SKILL.md override |
| **Dispatcher reads** | peaks-code main loop, during batch-sync wait | In-process async poller reads `heartbeats[]` + `lastBeatAt` from all records in current batch; emits `dispatcherStatus: { batchId, total, subAgents: [{role, status, progress, lastBeatAgo}] }` to status line / stderr | 10s; offset from sub-agent 30s to avoid jitter |
| **User / CLI reads** | Anyone, anytime | `peaks sub-agent list --session-id <sid> --json` queries all sub-agent states for the sid | Manual |

## Dispatch record schema upgrade (AC-34)

```ts
interface Heartbeat {
  readonly at: string;                  // ISO8601
  readonly status: 'queued' | 'running' | 'finalizing' | 'done' | 'failed' | 'stale';
  readonly progress: number;            // 0-100
  readonly note: string | null;         // free-text, ≤ 200 chars per heartbeat
}

interface DispatchRecord {
  // ... existing AC-26 fields ...
  readonly heartbeats: readonly Heartbeat[];   // NEW: append-only
  readonly lastBeatAt: string | null;          // NEW: redundant index for fast poller read
  readonly status: 'queued' | 'running' | 'finalizing' | 'done' | 'failed' | 'cancelled' | 'no-execution' | 'stale';  // NEW: aggregate view
}
```

- New dispatch auto-initializes: `heartbeats: []`, `lastBeatAt: null`, `status: 'queued'`
- **Backward compat (AC-34)**: old records missing these fields get defaults on read, no error
- `lastBeatAt` is a redundant index updated by CLI on each heartbeat write (avoids re-scanning `heartbeats[]` for the poller)
- `status` is an aggregate view: defaults to `heartbeats[-1].status`; reducer can overwrite to `done` / `cancelled` / `no-execution` when sub-agent finishes
- `stale` status: poller writes when `lastBeatAt < now() - 5min`; **does NOT** modify `outcome` (so sub-agent can still transition to `done` if it eventually finishes)

## CLI: `peaks sub-agent heartbeat` (AC-33)

Signature:
```
peaks sub-agent heartbeat --record <dispatchRecordPath> --status <state> --progress <pct> [--note <text>] --json
```

- `--record` required, must be an existing dispatch record (validates: `role` + `requestId` + `sessionId` exist)
- `--status` required, whitelist: `queued` | `running` | `finalizing` | `done` | `failed` | `stale`
- `--progress` required, integer 0-100
- `--note` optional, free text ≤ 200 chars
- `--json` required
- Implementation: atomic read-modify-write of record JSON; append to `heartbeats[]`; update `lastBeatAt`; **non-blocking** (async fs.appendFile + atomic rename)
- Truncation: `heartbeats.length > 100` → keep most recent 100 + set `truncated: true`
- Error path: `--record` not found / path outside `.peaks/_sub_agents/<sid>/` (R-2 guard) → `{ok: false, code: "INVALID_RECORD_PATH", toolCall: null}`

**G6 CLI is a MUST-IMPLEMENT in slice #009** (unlike G5 RL-10 list/show/gc which are stubs).

## Dispatcher wait status-line shape (G6.5)

Single line, 80-120 chars, status-line-friendly:

```
[peaks-code] swarm 3/3 running | rd-planning 45% (12s ago) | qa-test-cases 30% (5s ago) | ui-design 20% (2s ago)
[peaks-code] swarm 3/3 running | rd-planning 70% (8s ago) | qa-test-cases 50% (3s ago) | ui-design 30% (6s ago)
...
[peaks-code] swarm 3/3 done in 47.3s
```

- `lastBeatAgo` rendered as `now() - lastBeatAt`
- Sub-agent > 5min without new heartbeat → append `⚠ stale` suffix
- All done → emit `done in X.Xs` and advance

## How to apply

For every `peaks sub-agent dispatch` invocation, the calling SKILL.md / LLM MUST include in the sub-agent prompt:

1. "You are sub-agent role X. While running, you MUST call `peaks sub-agent heartbeat --record <dispatchRecordPath> --status running --progress <pct> --note "<what you're doing>"` at least every 30 seconds (or per the configured `heartbeatIntervalSec`)."
2. "On completion, call `peaks sub-agent heartbeat --status done --progress 100 --note "completed"`. On failure, `--status failed`. Final state will be picked up by the parent Dispatcher."

For peaks-code main loop, the batch-sync wait period MUST start the in-process poller (per AC-35) and emit status lines per G6.5.

For SKILL.md files that issue sub-agent dispatch (peaks-code / peaks-rd / peaks-qa), the fan-out section MUST include the heartbeat instruction in the sub-agent prompt template.

## What does NOT satisfy the rule

- "Sub-agents are fast enough that heartbeats don't matter" (violates RL-13 — empirical sub-agent runs are 30s-2min; user sees silence)
- "The user can see LLM tool calls happening" (violates the user's literal concern — Dispatcher is in peaks CLI, not in LLM-platform UI)
- "Heartbeat every 5s for safety" (violates RL-14 / IO-noise — 30s is empirical sweet spot)
- "Poller should kill stale sub-agents" (violates RL-15 — stale is warning, not failure; user decides)
- "Heartbeats unbounded for full audit trail" (violates RL-16 — single record JSON can balloon; 100 + truncated is LLM-friendly)

## Cross-reference

- **PRD #009** G6 段 + AC-33..AC-37 + R-9
- **RD request #009** G6 in-scope + tech-doc outline 12
- [[sub-agent-resource-lifecycle-red-line]] — companion G5 rule; G5 governs creation/disposal, G6 governs liveness visibility
- [[slim-ideadapter-shape-is-the-contract]] — heartbeat state is a runtime field, not part of the dispatcher interface contract

## Why this is additive, not a replacement

G5 governs **how sub-agents are governed at runtime** (resource hygiene — create, dispose, archive). G6 governs **how sub-agents are observed at runtime** (liveness visibility — heartbeat, progress, stale). They are orthogonal:

| | G5 (resource) | G6 (liveness) |
|---|---|---|
| Concern | Create + dispose + reclaim | Run + heartbeat + stale-detect |
| Question | Did we leak a sub-agent? | Is the sub-agent still alive? |
| Failure mode | Orphan records pile up | User thinks system is dead, presses Ctrl-C |
| Mitigation | Dispatch record + reducer dispose | Heartbeat + poller + status line |

A slice can pass G5 (clean dispatch records, no leaks) and still violate G6 (clean records but no progress visible during 2min wait). User presses Ctrl-C, work is lost, slice is incomplete despite passing G5. Both rules must pass.
