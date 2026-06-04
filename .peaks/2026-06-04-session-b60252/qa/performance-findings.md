# QA Performance Findings: 002-2026-06-04-solo-skill-slim-extract

- session: 2026-06-04-session-b60252
- rid: 002-2026-06-04-solo-skill-slim-extract
- type: refactor
- verdict: N/A — no perf surface
- reviewer: peaks-qa (main-loop, full-auto profile)

## Summary

The slice is a pure documentation + helper-extraction refactor. The performance surface is:

- The new `loadRunbookSection(skillPath, body)` helper in `src/services/skills/skill-runbook-service.ts` adds **one optional `readText` call** per `inspectSkillRunbook` invocation. The file is `references/runbook.md`, ~12KB for the peaks-solo case. The read is O(file-size), ~sub-millisecond on any modern filesystem.
- The function is called only from `inspectSkillRunbook`, which is invoked by the `peaks skill runbook <name> --json` CLI (a human-review tool), the `audit:` self-checks in `tests/unit/doctor.test.ts` (vitest only), and the `audit:` self-checks in `tests/unit/skill-default-runbook.test.ts` (vitest only). It is **not in any production hot path**.

No new route, hook, API, render, hot loop, or N+1 is introduced. Function complexity is unchanged (O(1) on inputs; the new read is unconditional but cheap).

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW
None.

## Verdict

**verdict: N/A — no perf surface.** No new route, no new hook, no new hot loop, no N+1. The slice adds one optional ~12KB file read per `inspectSkillRunbook` call. Cost: sub-millisecond, on a CLI that's invoked manually for human review. No baseline/after comparison needed.

## Baseline

**Baseline (pre-refactor)**:
- `inspectSkillRunbook(name)`: 1 file read (the skill's `SKILL.md`), 1 regex extraction, 1 DESTRUCTIVE_APPLY_PATTERNS scan, 1 PEAKS_COMMAND_LINE scan. Cost: ~1ms total.
- Vitest suite: 123 files, 1744 tests, 5 skipped (1769 total). Run time: ~22.5s.

**After (this slice)**:
- `inspectSkillRunbook(name)`: 1-2 file reads (the skill's `SKILL.md` + the optional `references/runbook.md`), 1-2 regex extractions, 1 DESTRUCTIVE_APPLY_PATTERNS scan, 1 PEAKS_COMMAND_LINE scan. Cost: ~1-2ms total (the second read is conditional on the inline section being a pointer, which is the new peaks-solo case).
- Vitest suite: 123 files, 1764 tests, 5 skipped (1769 total). Run time: ~23.25s. +0.75s (the additional test cases; not the new code path).

**Delta**: ~0.5ms per `inspectSkillRunbook` call (peaks-solo only). +0.75s on the full vitest suite (the new test cases; not the new code path). Both deltas are sub-perceptual for a CLI used for human review.

**No baseline/after numbers needed beyond the above** — the slice is a documentation + helper-extraction refactor with no production hot path. The new file read is gated by a try/catch that silently falls through to the inline section on ENOENT/EACCES, so the worst-case perf impact is "we read one extra file that doesn't exist" (~100µs on a modern filesystem).
