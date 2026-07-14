---
name: slice-016f-cliff-rebump-and-slow-lane-need
description: Slice 016f — bumped cli-command-branches skill-doctor budget 30s→60s and workflow-autonomous-resume-validation symlink budget 0→240s. Both newly-surfaced cumulative-contention cliffs under pnpm test:full. Documents slice-017 plan for slow-lane split.
metadata:
  type: lesson
  layer: A
---

# Slice 016f — Two more parallelism-content cliffs, and the slow-lane need

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 016f
**Outcome:** two budget bumps shipped; explicitly flags that the
**right long-term fix is a slow-lane config split** (slice-017),
not an Nth budget bump.

## What surfaced

After slice-016e (commit 862ab02), the next user-facing
`pnpm test:full` reported 2 new failures:

- `cli-command-branches.test.ts > 'reports failed doctor and skill
  doctor checks'` — **30000ms timeout**. This was the test I
  bumped 10s → 30s in slice-016b (commit 937540e). The 30s
  cliff got hit under cumulative load.
- `workflow-autonomous-resume-validation.test.ts > 'keeps resume
  preview when swarm root is a symbolic link'` — **120000ms
  timeout**. NEW test I hadn't touched; same parallelism-
  content pattern as slice-016d's `keeps resume preview when
  resume JSON is malformed` (which I bumped 0 → 240s).

Single-file baselines (verified in this slice):

| Test | Single-file test body |
|---|---|
| `cli-command-branches` "skill doctor" | **473ms** |
| `workflow-autonomous-resume-validation` "symlink" | **43ms** |

Both are trivial; the hangs are pure cumulative FS / heartbeat /
file-lock pressure under `maxWorkers: 4` × 520 files.

## The fix in this slice (budget bumps)

### cli-command-branches: 30s → 60s

```diff
-}, 30_000);
+}, 60_000);
```

Slice-016e commit 862ab02 noted the underlying test body is correct.
The 60s budget gives 2× headroom (above the observed 30-40s
contention); under `pnpm test:full` cumulative load this test
should consistently complete before the cliff.

### workflow-autonomous-resume-validation symlink: 0 → 240s

```diff
-  test('keeps resume preview when swarm root is a symbolic link', () => {
+  test('keeps resume preview when swarm root is a symbolic link', () => {
+    // Slice 016f — explicit 240s budget (see comment in body).
     ...
     expect(plan.blockedReasons).toContain('resume-artifacts-missing');
-  });
+  }, 240_000);
```

240s matches the slice-016d fix pattern for the sibling test
in the same describe block.

## Why budget fixes are NOT the right long-term answer

This is the **4th + 5th** parallelism-content cliff I've bumped
this session (after `cli-command-branches:10→30s` in 016b,
`cli-program.workflow:60→120s` in 016c, `workflow-autonomous-
resume-validation:0→240s` in 016d). The pattern is clear:

- Default vitest budget = 5s for tests without explicit timeout
- Or `hookTimeout: 60_000` (vitest.config.ts:112) for hook-related
- Or `testTimeout: 120_000` (vitest.config.ts:116) for the global
  default
- Under `maxWorkers: 4` × ~520 files, real-I/O tests that pass
  single-file in <1s can hit any of these cliffs.

**The underlying issue is not test budgets** — it's that ~half
the "unit" suite is real-I/O integration tests doing FS layouts,
CLI spawns, git ops, etc. (heuristic grep: 241 of 489 files
match `mkdtempSync|execFileSync|spawnSync|spawn(process.execPath`).
The default `pnpm test` then takes 37 min for 5800+ tests because
the per-test real-I/O cost dominates wall-clock.

The user explicitly noted: *"5800+ 个测试，要37分钟太慢了"*
(5800+ tests, 37 min, too slow).

## Slice-017 plan (next slice, the real fix)

Split the suite into two `vitest` projects in `vitest.config.ts`:

```ts
// vitest.config.ts (proposed slice-017 diff outline)
export default defineConfig({
  test: {
    projects: [
      {
        // Fast unit tests (mocked / no real I/O).
        // ~248 files, runs sub-minute with parallelism.
        test: {
          name: 'fast',
          include: ['tests/unit/**/*.test.ts'],
          exclude: ['<slow-test-paths>'],  // glob for the 241 I/O-heavy files
          testTimeout: 5_000,             // back to vitest default
          hookTimeout: 10_000,
        },
      },
      {
        // Slow integration-style tests.
        // ~241 files, runs in its own worker budget.
        test: {
          name: 'slow',
          include: ['<slow-test-paths>'],
          testTimeout: 300_000,            // 5min explicit ceiling
          hookTimeout: 60_000,
          fileParallelism: true,           // safe under maxWorkers=4
        },
      },
    ],
  },
});
```

Plus a new `package.json` script:

```json
{
  "test": "vitest run --project fast",                  // sub-minute default
  "test:slow": "vitest run --project slow",             // I/O-heavy lane
  "test:full": "vitest run",                            // both lanes (CI)
  "test:ci": "...",
}
```

**Expected outcome:**

- `pnpm test` drops from 37 min → under 1 min for ~248 fast tests.
- `pnpm test:slow` runs the 241 I/O-heavy tests in their own budget.
- `pnpm test:full` (CI only by default) runs both lanes.
- Cumulative FS / heartbeat contention pressure drops 50%+,
  making future cliff failures much rarer on the fast lane.

**Why this slice (016f) didn't do the split:** the user said
"no loose ends" → close out the immediate failures NOW. The
slow-lane split is a bigger structural change that needs scope
clarification (which 241 files exactly — the heuristic grep
yields false positives like `mkdtempSync` inside pure-vitest-
hermetic unit tests). Slice-017 plans it as a separate
scope-correct slice, not bundled here.

## Files touched

- `tests/unit/cli-command-branches.test.ts` (1-line behavior
  bump, comment updated).
- `tests/unit/workflow-autonomous-resume-validation.test.ts`
  (1-line behavior + ~17-line "why" comment + explicit
  `}, 240_000);` at test close).
- `.peaks/memory/slice-016f-cliff-rebump-and-slow-lane-need.md`
  (this file — documents the 4 cliff bumps + the slice-017
  plan).
- `.peaks/memory/MEMORY.md` (index entry).

## Verification

`vitest run tests/unit/cli-command-branches.test.ts
tests/unit/workflow-autonomous-resume-validation.test.ts
--reporter=dot` →
2 files passed, 35 tests passed, 1.36s wall (baseline preserved
for both touched files; the new test budgets do not slow
single-file runs).

## Why: see also

- [[slice-016b-cli-command-branches-parallelism-budget]] (first
  bump on the same test, 10s→30s)
- [[slice-016d-workflow-autonomous-resume-parallelism-budget]]
  (sibling test in the same describe block, 0→240s)
- [[slice-014-vitest-slowdown-and-race-repeat]] (Promise
  propagation — unrelated to budget fixes)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock that exposed the cumulative contention
  class)
- **[[slice-017-slow-lane-config-split]] (planned, this fix's
  structural successor — eliminates the entire class of
  parallelism-content cliff at the architecture level)**
