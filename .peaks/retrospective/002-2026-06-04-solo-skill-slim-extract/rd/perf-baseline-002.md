# Perf Baseline: 002-2026-06-04-solo-skill-slim-extract

- session: 2026-06-04-session-b60252
- rid: 002-2026-06-04-solo-skill-slim-extract
- type: refactor
- reviewer: perf-baseline (peaks-rd fan-out, parallel slot)
- verdict: N/A — no perf surface
- reviewed files: `skills/peaks-solo/SKILL.md`, `skills/peaks-solo/references/runbook.md`, `skills/peaks-solo/references/workflow-gates-and-types.md`, `src/services/skills/skill-runbook-service.ts`, `tests/unit/doctor.test.ts`, `tests/unit/skill-default-runbook.test.ts`

## Summary

The slice is a pure documentation + helper-extraction refactor. The performance surface is:

- The new `loadRunbookSection(skillPath, body)` helper in `src/services/skills/skill-runbook-service.ts` adds **one optional `readText` call** per `inspectSkillRunbook` invocation. The file is `references/runbook.md`, ~12KB for the peaks-solo case. The read is O(file-size), ~sub-millisecond on any modern filesystem.
- The function is called only from `inspectSkillRunbook`, which is invoked by the `peaks skill runbook <name> --json` CLI (a human-review tool), the `audit:` self-checks in `tests/unit/doctor.test.ts` (vitest only), and the `audit:` self-checks in `tests/unit/skill-default-runbook.test.ts` (vitest only). It is **not in any production hot path**.

No new route, hook, API, render, hot loop, or N+1 is introduced. Function complexity is unchanged (O(1) on inputs; the new read is unconditional but cheap). The pre-existing `peaks <cmd>` invocations in `references/runbook.md` are unchanged in number and order; the runbook is a copy-pasteable shell, not a runtime hot path.

## Baseline (pre-refactor vs after)

| Surface | Pre-refactor | After this slice | Delta |
|---|---|---|---|
| `inspectSkillRunbook(name)` file reads | 1 (SKILL.md) | 1-2 (SKILL.md + optional references/runbook.md) | +0..1, ~12KB max |
| `inspectSkillRunbook(name)` regex extractions | 1 | 1-2 | +0..1 |
| Vitest suite (full) | 1744 tests, ~22.5s | 1764 tests, ~23.25s | +0.75s (test count, not code path) |
| `peaks skill runbook peaks-solo --json` wall-clock | ~1ms | ~1-2ms (1-2 file reads + 1-2 regex) | sub-perceptual |
| `peaks scan archetype --json` wall-clock | unchanged | unchanged | 0 (no code path) |
| `peaks workspace init --json` wall-clock | unchanged | unchanged | 0 (no code path) |
| `peaks request transition` wall-clock | unchanged | unchanged | 0 (no code path) |

## Why N/A

- No production hot path is touched. `inspectSkillRunbook` is invoked from (a) a human-review CLI, (b) audit tests that run only in vitest, (c) the `peaks skill doctor` self-check that runs in `peaks doctor` (a one-shot health check, not a hot loop).
- The new file read is gated by a `try { ... } catch { /* reference missing */ }` block — ENOENT and EACCES both fall through silently to the inline section. The worst case is "we read one extra file that doesn't exist" (~100µs on a modern filesystem).
- The function call graph is unchanged: `inspectSkillRunbook` calls `loadRunbookSection` instead of `extractRunbookSection` directly. Same call depth, same return type, same caller contract.
- No N+1: the new read is at most 1 extra file per call. There is no loop, no recursion, no per-element operation.
- No new I/O concurrency: the read is a single `readText(referencePath)` call, sequential with the existing `readText(skillPath)` call. Could be parallelized with `Promise.all` for sub-ms speedup, but the cost/benefit is low (the CLI is human-review).

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW

- **L-1 (informational)**: The new `loadRunbookSection` reads SKILL.md and references/runbook.md sequentially. A `Promise.all` parallelization could save ~0.5ms in the worst case. The user-visible cost of a `peaks skill runbook peaks-solo --json` invocation is dominated by Node's process startup (~150ms) and the `loadSkillRegistry` walk (~5-10ms per skill). A 0.5ms parallelization is sub-perceptual. Out of scope for this slice.

## Baseline (pre-existing perf baseline reference)

The prior slice (001-2026-06-04-buildartifactrelativepath-projectroot) established the "N/A — no perf surface" template at `.peaks/2026-06-04-session-b60252/rd/perf-baseline.md`. This file follows the same template for slice 002.

## Verdict

**verdict: N/A — no perf surface.** No new route, no new hook, no new hot loop, no N+1. The slice adds one optional ~12KB file read per `inspectSkillRunbook` call. Cost: sub-millisecond, on a CLI that's invoked manually for human review. No baseline/after comparison needed beyond the table above.
