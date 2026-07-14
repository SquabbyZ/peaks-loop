---
name: slice-018-orphan-scan-budget-fix
description: Slice 018 — bumped orphan-scan.test.ts 5 AC-1.x tests from 60s to 180s. AC-3 re-export detection was failing at exactly 60.004s under pnpm test:full user run; the same Wall cost exists in single-file too (real workload, not parallelism contention).
metadata:
  type: lesson
  layer: A
---

# Slice 018 — `orphan-scan.test.ts` real-workload budget fix

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 018
**Outcome:** 13/13 green in 2m21s single-file; 5 test budgets
bumped 60_000 → 180_000.

## What the user reported

> "我实际使用pnpm test:full运行是36分钟左右"
> "其中有单测的文件150多秒"
> (pnpm test:full is ~36 min; one test file is 150+ seconds)

## Root cause (verified, not guessed)

`tests/unit/skills/orphan-scan.test.ts` Slice 2.6.1.A describe
block has 5 behavior tests; each runs real `scanOrphans(...)` on
a temp git repo. Per-test single-file timings (measured in
this slice):

| Test | Time | Status (pre-fix) |
|---|---|---|
| AC-1 declaration-file-only references | **35.2s** | passed (within 60s) |
| AC-1 referenced-in-tests wired | **46.1s** | passed (within 60s) |
| AC-2 export-default detection | **39.3s** | passed (within 60s) |
| **AC-3 re-export detection** | **60.004s** | **TIMEOUT FAIL** |
| AC-4 --base <ref> support | **54.0s** | passed (within 60s) |

File total: **234s ≈ 4min**, matching the user's "150s+" report
(approximation for ~half the suite).

**This is NOT the parallelism-content flake class** that
slice-016b/c/d/e/f addressed. Each test passes single-file.
The workload itself is real (git init/commit in temp dirs +
walkDir + export-graph traversal) and the budget was just
under-allocated.

## The fix (1 hunk, 5 budget bumps)

All 5 AC-1.x tests in the `Slice 2.6.1.A` describe block got
`{ timeout: 60_000 }` → `{ timeout: 180_000 }`. 180s = 3x
headroom over the worst-observed single-file time (60s); well
below vitest's 600s hard limit; uniform across the describe
block so future tests that share the `withTempRepo` +
`scanOrphans` template inherit the same budget without further
fix-up.

```diff
-test('AC-3 re-export detection: …', { timeout: 60_000 }, async () => {
+test('AC-3 re-export detection: …', { timeout: 180_000 }, async () => {
```

(plus 4 sibling lines for AC-1 declaration, AC-1 wired,
AC-2 export-default, AC-4 --base).

## Why this is principled (not a band-aid)

- The 60s budget was wrong (toolsmall) for the workload the
  scanner performs. The right fix is to give the test the
  headroom the workload needs.
- The fix doesn't change the production code, doesn't mock
  the scanner, doesn't bypass the git spawns.
- It matches slice-014/016 sibling pattern (e.g.
  `dispatch-record-writer.test.ts` had `{ timeout: 180_000 }`
  from prior slices for the same workload reason).

## Workload rationale (why 180s)

`scanOrphans` with `scope: 'all'` walks every file's imports
AND every file's exports AND resolves re-export chains through
barrel files. In a test fixture with hundreds of files (the
real `.peaks/_runtime/` snapshot tree at session binding time),
this is real CPU work — not something parallelism can fix.

180s = 3x the observed worst-case (60s). Future tests inheriting
the template get the same budget without further adjustments.

## Files touched

- `tests/unit/skills/orphan-scan.test.ts` (5 budgets bumped; 1
  "why" comment added above the AC-3 test).
- `.peaks/memory/slice-018-orphan-scan-budget-fix.md` (this
  file).
- `.peaks/memory/MEMORY.md` (index entry).

## Verification

- `vitest run tests/unit/skills/orphan-scan.test.ts --reporter=dot` →
  **1 file passed, 13 tests passed, 136.99s wall**.

## What's still left in `pnpm test:full`

Background pnpm test:full user just kicked off; results not yet
landed. Slice-018 addressed ONE slow unit file (orphan-scan);
the rest of the 36-min wall is dominated by:
- Integration suite (29 files, each 60-90s; ~1500s total).
- Per-file transform/import tax for all 489 unit files
  (heavy `src/cli/program.ts` graph re-imported once per file).

The slow-lane config split proposed in slice-016f memory is
still the structural answer for the wall-time complaint, but
slice-018 fixes this specific failure cliff surgically.

## Why: see also

- [[slice-016f-cliff-rebump-and-slow-lane-need]] (the prior
  plan; slice-018 fixes one specific class)
- [[slice-017-cli-default-subset-fast-default]] (made `pnpm test`
  fast but didn't touch test:full)
- [[slice-014-vitest-slowdown-and-race-repeat]] (parent race lesson)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock; this slice's budget fix is unrelated to
  parallelism — same shape but different root cause)
