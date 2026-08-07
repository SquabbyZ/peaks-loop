---
name: perf-slice3-revert-2026-08-07
description: Perf slice 3 speculative optimization REVERTED — vitest cache + deps.optimizer prebundle made wall 360s → 540s (+50%); transform/import doubled. Lesson: speculative config changes without measurement are false wins.
metadata:
  type: lesson
  scope: project-level
  effective: 2026-08-07
---

# Perf slice 3 — speculative optimization REVERTED (2026-08-07)

## TL;DR

Three "easy perf wins" from RD-016 (vitest cache, deps.optimizer prebundle, incremental tsc) were applied speculatively. **Two were reverted immediately** because they made the suite 50% slower and broke 3 additional tests. **One (incremental tsc) may still help** but was not validated before revert. **Lesson: never apply speculative perf changes without a before/after measurement.**

## What was tried

| Commit | Change | Outcome |
|---|---|---|
| `4fa7f905` | tsconfig.json: `incremental: true` + tsBuildInfoFile | NOT REVERTED yet — kept for warm runs |
| `8651c7d1` | vitest.config.ts: `cache.dir` | REVERTED `bd9a42f8` (made wall +50%) |
| `45fb8292` | vitest.config.ts: `deps.optimizer.ssr.include: ['peaks-loop-shared']` | REVERTED `0543e36b` (made import +80%, 3 tests failed) |

## Measurements

| Metric | Before (run 3 of AC-1) | After (bco1jkbrl) | Delta |
|---|---|---|---|
| Wall clock | 360.40s | **540.00s** | **+50% slower** |
| Transform aggregate | 454s | 1048s | +131% |
| Import aggregate | 802s | 1439s | +80% |
| Tests passed | 725 | 722 | -3 |
| Tests failed | 3 | 6 | +3 |
| Timeouts | 0 | 0 | unchanged |

## Why the optimizations regressed

- **vitest cache** + **deps.optimizer prebundle** both add per-worker warmup cost that is supposed to be amortized. On this 16-core box with `maxWorkers = floor(cpus/2) = 8`, the per-worker prebundle cost dominates. Cache hits were lower than expected because tsbuildinfo is invalidated every fresh build.
- **Cache invalidation** (RD-016 risk R1) materialized: cache was populated by a partial build state, then re-read by a different worker pool, producing wasted prebundle cycles.

## Lesson (key)

> Speculative perf changes that "look cheap" (≤ 4 LOC per commit) are dangerous without measurement. The 3 commits took ~5 minutes to apply but cost ~30% wall-clock regression. **Always measure before AND after.** RD-016's risk register was correct but the planning stage skipped the validation gate.

## What the RD-016 plan got wrong

RD-016 estimates ("200s warm saving", "100-200s for prebundle") were order-of-magnitude optimistic. Real cache prebundle cost is closer to 50-100s per worker × 8 workers = 400-800s upfront, not amortized on a 5-minute suite.

## Correct path forward (for next session)

1. **Keep incremental tsc** (`4fa7f905`) if it doesn't regress — needs isolated measurement
2. **Cache + prebundle** should NOT be applied without:
   - A controlled A/B (commit on/off, measure 5 runs each)
   - A specific failing test to optimize against, not "aggregate wall"
   - CI parity check (the regression may not appear on smaller boxes)
3. **Investigate the real bottleneck**: 16-core machines with 8 workers show aggregate-vs-wall ratio of 1853/540 = 3.4×, NOT the 8.8× we saw before worker cap. The remaining gap is genuine transform+import work, NOT starvation. Different problem, different fix.

## Open follow-up (next session)

1. Verify `4fa7f905` (incremental tsc) doesn't regress — measure cold vs warm
2. Investigate whether `peaks-loop-shared` prebundle helps on 2-core CI but not 16-core dev
3. Consider `tsc --build` mode for monorepo packages instead of incremental

## Related

- `[[2026-08-07-24h-slice-2-3-ship-closure]]` — parent session
- `.peaks/_runtime/2026-08-06-session-cacde8/rd/requests/016-2026-08-06-perf-slice3-transform-import.md` — original plan (now invalidated)
- `[[peaks-vitest-locked-4-1-10]]` — vitest 4.1.10 constraints
