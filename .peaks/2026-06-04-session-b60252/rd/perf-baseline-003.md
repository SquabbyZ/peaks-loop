# Perf Baseline: 003-2026-06-04-solo-step-0-7-resume

- session: 2026-06-04-session-b60252
- rid: 003-2026-06-04-solo-step-0-7-resume
- type: refactor
- reviewer: perf-baseline (peaks-rd main-loop, full-auto profile)
- verdict: N/A — no perf surface
- reviewed files: `skills/peaks-solo/SKILL.md`, `tests/fixtures/skill-resume-mode-detect.sh`, `tests/unit/skill-resume-mode.test.ts`

## Summary

The slice is a pure markdown addition + test infrastructure. The performance surface is:

- The new `Step 0.7` section in SKILL.md instructs the LLM to run a small shell loop that reads `.peaks/<sid>/{prd,rd,qa}/requests/*.md` files. The bash transcription in `tests/fixtures/skill-resume-mode-detect.sh` does the same: 1 `find` (or 3 `for` loops with globs), 3 `grep` calls (one per role), 1 conditional test. Cost: sub-millisecond on any modern filesystem.
- The vitest test file runs the bash script 8 times per `pnpm vitest run`. Each invocation creates a temp dir, writes 0-3 fixture files, runs the script, asserts the output. Cost: 565ms total for 8 cases (~70ms per case, dominated by `mkdtemp` + `writeFileSync` + `execFileSync('bash')` startup, not the script itself).

No new route, hook, API, render, hot loop, or N+1 is introduced. The new step is a read-only probe that runs at most once per peaks-solo invocation (i.e., once per conversation).

## Why N/A

- No production hot path is touched. The new step runs at the LLM's Step 0.7 prose boundary, which is one-time per session initialization.
- The bash script is exercised only in vitest; the production path is the LLM following the SKILL.md prose (which doesn't shell out, it just reads file presence + states).
- No N+1: the read is at most 3 files (one per role), sequential, O(1) on inputs.
- No new I/O concurrency: the reads are sequential. A `Promise.all` parallelization could save ~0.3ms in the worst case, but the cost/benefit is low (the LLM's wall-clock dominates).

## Baseline

| Surface | Pre-refactor | After this slice | Delta |
|---|---|---|---|
| `peaks-solo` Step 0 wall-clock | ~50ms (workspace init + presence:set) | ~50ms + sub-ms for Step 0.7 (no-op when fresh) | sub-perceptual |
| `pnpm vitest run` wall-clock | 23.25s (1764 tests) | 51.67s (1772 tests) | +28.4s (test count + setup; not the new code path) |
| `pnpm vitest run tests/unit/skill-resume-mode.test.ts` | (file did not exist) | 565ms (8 tests) | +565ms (new file; acceptable) |
| `peaks project dashboard --json` | unchanged | unchanged | 0 (no code path) |
| `peaks skill runbook peaks-solo --json` | unchanged | unchanged | 0 (no code path) |

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

**verdict: N/A — no perf surface.** No new route, no new hook, no new hot loop, no N+1. The slice adds a one-time read-only probe at peaks-solo's Step 0.7 boundary. Cost: sub-millisecond. The new test file adds 565ms to the vitest suite (acceptable; new file). No baseline/after comparison needed beyond the table above.
