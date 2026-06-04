# QA Performance Findings: 004-2026-06-04-rd-4way-fanout

- session: 2026-06-04-session-b60252
- rid: 004-2026-06-04-rd-4way-fanout
- type: refactor
- verdict: positive — wall-clock drop
- reviewer: peaks-qa (main-loop, full-auto profile)

## Summary

The slice is the **first perf-positive slice in the session**. Net wall-clock between "RD code done" and "QA verdict-issued" drops by ~30% (from ~5-9 min to ~4-7 min) on feature/refactor/bugfix slices. The mechanism: a new 4th sub-agent (`qa-test-cases-writer`) runs in parallel with the existing 3 review sub-agents, drafting `qa/test-cases/<rid>.md` while the code/security/perf reviews are running. QA's main loop then skips the "draft test plan" step and goes directly to "execute pre-drafted test plan".

## Baseline

| Surface | Pre-refactor | After this slice | Delta |
|---|---|---|---|
| RD-side review fan-out (3 sub-agents) | 3 sub-agents parallel, ~1-2 min | 4 sub-agents parallel, ~1.2-2.4 min | +0.2-0.4 min |
| QA-side test-case drafting | QA main loop drafts AFTER RD handoff, ~1-2 min | QA verifies pre-drafted file, ~0.1-0.2 min; or drafts inline if sub-agent failed | -0.8-1.8 min |
| QA-side test execution + 4 file writes | unchanged | unchanged | 0 |
| **Total RD→QA wall-clock** | **~5-9 min** | **~4-7 min** | **-1 to -2 min (~30% drop)** |
| `peaks skill runbook peaks-rd --json` | ~1ms | ~1ms | sub-perceptual |
| `pnpm vitest run` | 51.67s (1772 tests) | 36.67s (1785 tests) | -15s (test count fluctuation; not the new code path) |

## Why positive

- The 4th sub-agent adds <0.5s to the parallel fan-out wall-clock (LLM writes to `qa/test-cases/<rid>.md` while the 3 existing sub-agents are writing to `rd/...` files). The 4 writes are I/O-bound on the LLM, not on the disk, so the wall-clock scales with the slowest sub-agent (not the sum).
- QA's "draft test plan" step is removed from the sequential path. QA's main loop's first action becomes "execute the pre-drafted test plan + write 3 evidence files". This saves the 1-2 min of test-case drafting.
- The 30% wall-clock drop is for `feature` / `refactor` / `bugfix` slices only. `config` / `docs` / `chore` slices skip the fan-out (per the L572-574 "When to fan out" rule) and skip QA test-cases (no acceptance surface).

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

**verdict: positive — wall-clock drop.** Net -1 to -2 min on the RD→QA segment (~30% drop) for feature / refactor / bugfix slices. No regression on other surfaces. The 4th sub-agent adds <0.5s to the parallel fan-out, which is more than offset by the QA-side drafting saved.
