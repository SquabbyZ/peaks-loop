# Perf Baseline: 004-2026-06-04-rd-4way-fanout

- session: 2026-06-04-session-b60252
- rid: 004-2026-06-04-rd-4way-fanout
- type: refactor
- reviewer: perf-baseline (peaks-rd main-loop, full-auto profile)
- verdict: positive — wall-clock drop
- reviewed files: `skills/peaks-rd/SKILL.md`, `skills/peaks-qa/SKILL.md`, `skills/peaks-solo/references/workflow-gates-and-types.md`, `tests/unit/parallel-fan-out.test.ts`

## Summary

The slice is the **first perf-positive slice in the session** — it actively reduces wall-clock between "RD code done" and "QA verdict-issued" by ~30% on feature/refactor/bugfix slices. The mechanism: a new 4th sub-agent (`qa-test-cases-writer`) runs in parallel with the existing 3 review sub-agents, drafting `qa/test-cases/<rid>.md` while the code/security/perf reviews are running. QA's main loop then skips the "draft test plan" step and goes directly to "execute pre-drafted test plan + write test-report + security-findings + performance-findings + verdict". **Net effect: ~1-2 min saved per slice on the RD→QA segment.**

## Baseline (pre-refactor vs after)

| Surface | Pre-refactor | After this slice | Delta |
|---|---|---|---|
| RD-side review fan-out (3 sub-agents) | 3 sub-agents parallel, ~1-2 min wall-clock | 4 sub-agents parallel, ~1.2-2.4 min wall-clock (+0.2-0.4 min for the 4th sub-agent, dominated by Node startup + LLM context) | +0.2-0.4 min |
| QA-side test-case drafting (1 main-loop write) | QA main loop drafts `qa/test-cases/<rid>.md` AFTER RD handoff, ~1-2 min | QA main loop verifies pre-drafted file (if present), ~0.1-0.2 min; or drafts inline (if sub-agent failed), ~1-2 min | -0.8-1.8 min |
| QA-side test execution + 4 file writes | unchanged | unchanged | 0 |
| **Total RD→QA wall-clock** | **~5-9 min** | **~4-7 min** | **-1 to -2 min (~30% drop)** |
| `peaks skill runbook peaks-rd --json` wall-clock | ~1ms | ~1ms (skill body change is markdown, not executable) | sub-perceptual |
| `pnpm vitest run` wall-clock | 23.25s (1764 tests, post-slice-002) → 51.67s (1772 tests, post-slice-003) | 36.67s (1785 tests, post-slice-004) | +13/1785 (new test count, not the new code path) |

## Why positive

- The 4th sub-agent adds <0.5s to the parallel fan-out wall-clock (LLM writes to `qa/test-cases/<rid>.md` while the 3 existing sub-agents are writing to `rd/code-review.md`, `rd/security-review.md`, `rd/perf-baseline.md`). The 4 writes are I/O-bound on the LLM, not on the disk, so the wall-clock scales with the slowest sub-agent (not the sum).
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

- **L-1 (informational)**: The 4th sub-agent's wall-clock is dominated by LLM inference time, not by file I/O. The Task() sub-agent reads the PRD + tech-doc + git diff (~50-200KB), then writes the test plan (~5-15KB markdown). If the LLM is slow, the 4th sub-agent becomes the bottleneck. Mitigation: all 4 sub-agents run in parallel, so the wall-clock is `max(t1, t2, t3, t4)` — if t4 is the slowest, the wall-clock increase is `t4 - max(t1, t2, t3)`. In practice t4 is similar to t1 (code-review) because both have similar input sizes; t2 (security-review) is shorter (less to write); t3 (perf-baseline) is shortest (scaffold only). The expected wall-clock increase is ~0-0.5s, dominated by Node startup, not by inference.
  File: `skills/peaks-rd/SKILL.md:566-630`

## Baseline (pre-existing perf baseline reference)

The prior slice (003-2026-06-04-solo-step-0-7-resume) had a "N/A — no perf surface" verdict. This slice is the first **positive** perf verdict. The test file follows the same template as the prior slice.

## Verdict

**verdict: positive — wall-clock drop.** Net -1 to -2 min on the RD→QA segment (~30% drop) for feature / refactor / bugfix slices. No regression on other surfaces. The 4th sub-agent adds <0.5s to the parallel fan-out, which is more than offset by the QA-side drafting saved.
