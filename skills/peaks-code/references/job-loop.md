# Peaks-Loop Code — Job Loop Deep-Dive

> Read alongside `SKILL.md` Steps 0.8 / 0.81 / 0.85 / 0.86 / 0.87.

## State machine

```
       init ─────────► pending ─► in-progress ─┐
                          │                     │
                          ▼                     ▼
                       blocked (one slice)    done ──► (next slice)
                          │                     ▲
                          ▼                     │
                       (strict: STOP,           │
                        best-effort: skipped)   │
```

## Visibility

| Layer | Tool | Cost | User reads |
|---|---|---|---|
| LLM-runner transcript | (the chat) | free | always |
| `--watch` poll | peaks job status --watch | 1% CPU | when in a 2nd terminal pane |
| Statusline | peaks statusline install | ambient | in IDE bottom bar |

## Rotation cadence

- `len(slices) ≤ 2` → single-mode (auto-compact passively).
- `len(slices) ≥ 3` → rotating-mode, K=3 default.
- LLM-initiated override (rotating→single) is **strongly discouraged**; if used, must record `mainLoopOverride` in state.json with `reason ≥ 10 chars` and predicted wall-time ≤ 30 min.

## Cleanup gate

Every `peaks sub-agent dispatch` inside a Job scope MUST be matched by a `peaks job subagent-cleanup --force` BEFORE the next slice checkpoint. The wrapper (M5) refuses dispatch return-success without matching cleanup.

## Cross-day recovery

`peaks session resume --job-id <jid>` reads:
1. `job/<jid>/state.json` — current job state
2. `session/cycle-<n>.md` — main-session cycle summary (rotating mode)
3. `session/auto-decisions.md` — auto-compact history
4. `session/checkpoints/*.json` — generic session checkpoints

The resume endpoint cross-checks all four before offering continuation; if any layer is stale, the user gets an AskUserQuestion (resume / restart / skip).

## Visibility prose

The Job loop is foreground. Three visibility layers, all on by default:
1. **LLM-runner transcript** — primary surface; user reads the chat to see active step.
2. **`peaks job status --watch`** — terminal poll, ANSI bar, refresh every 3 s.
3. **Statusline** — ambient `job: <jid> [done/total] currentSlice ETA m:s context main%. cycle`.

No detached workers, no `nohup`, no `disown`. Any attempt to spawn a background job → red line violation → block.

## Red lines (9 hard rules)

The LLM-runner MUST NOT:
1. Enter Step 11 / write final handoff while job has remaining slices.
2. Re-ask the user about cost / length / context.
3. Coalesce multiple slices into one rid.
4. Modify a committed slice (`git commit --amend` on `done`).
5. Fake completion (CLI verifies commit-sha exists in git log).
6. Use detached / background / daemon-mode sub-agents inside a Job.
7. Skip `peaks job subagent-cleanup` between dispatch and slice checkpoint.
8. Skip or postpone a scheduled `peaks session rotate`.
9. Suppress visibility — no silencing statusline / `--watch`.

Violations trigger a `peaks job block` event with the specific red-line number.
