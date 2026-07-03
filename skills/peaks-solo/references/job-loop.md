# Peaks-Loop Solo — Job Loop Deep-Dive

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
