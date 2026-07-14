---
name: slice-016c-cli-program-workflow-parallelism-budget
description: Slice 016c — bumps cli-program.workflow.test.ts 'prefers the workspace matching the current repository for workflow planning' test budget to 120s to survive maxWorkers=4 triple-RD-planner contention. Single-file baseline still <1.5s.
metadata:
  type: lesson
  layer: A
---

# Slice 016c — `cli-program.workflow` parallelism timeout budget

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 016c (third micro-cycle on the parallelism-flake theme)
**Outcome:** test now passes under full-suite `pnpm test:full`
parallel contention (last observed full-suite hit was 50-70s on
Windows); single-file baseline still 1.4s.

## What surfaced

After slice-016 (commit c3bad88) + slice-016b (commit 937540e),
`pnpm test:full` reported **1 remaining failure**:

  FAIL tests/unit/cli-program.workflow.test.ts > createProgram workflow commands >
    'prefers the workspace matching the current repository for workflow planning'
  Error: Test timed out in 60000ms

Identical pattern to slice-016b: `STACK_TRACE_ERROR`-equivalent
serialization of a per-test **timeout** (60s = `hookTimeout` from
vitest.config.ts:112), not an assertion failure. The test body
makes **three sequential `runCommand` calls** — `workflow.route`,
`workflow.autonomous`, `swarm.plan` — each invoking the real
`RD planner` + workspace lookup + the heavy `src/cli/program.ts`
import graph.

Single-file run (verified): **1.37s test body / 5.05s wall** with
38 sibling tests skipped. Under `maxWorkers: 4` (vitest.config.ts)
combined with 519 other tests loading the same heavy import
graph, observed wall-clock in the failing `pnpm test:full` run
was 50-70s — exactly at the 60s cliff.

## The fix (1 hunk, ~10 lines)

Bumped only the unhealthy-as-parallelized test's local timeout
from the default (effectively 60s = `hookTimeout`) to **120s**:

```diff
  // ... test body ...
    } finally {
      cwdSpy.mockRestore();
    }
-  });
+  // Slice 016c — see budget note at the top of this test body.
+  }, 120_000);
```

120s matches the global `testTimeout: 120_000` in
vitest.config.ts:116 — it's exactly the same ceiling the rest of
the suite uses, just made **explicit** on this test (rather than
inheriting the default + being misinterpreted at the 60s
`hookTimeout` boundary).

## Why this is principled (not a band-aid)

- The test body does what it says: 3 sequential real CLI runs.
- The 60s default fire is a **cliff at 60s**, not a "this is
  intrinsically broken" — bumping to 120s gives the test the
  headroom it needs under contention.
- Single-file baseline still passes in 1.37s — the test's
  assertion logic is correct.
- The slice-014 Promise-propagation lesson is unrelated — this
  is a budget, not a swallow.

## Why not split the three runCommand calls into separate tests?

Three reasons:

1. **Shared setup.** All three commands test the SAME workspace
   preference behavior. Splitting them loses the cross-command
   invariant ("workspace preference is honored across
   route/autonomous/swarm consistently").
2. **Setup cost.** Each test would need to re-run the
   `mkdtempSync` + `writeUserConfig` + `vi.spyOn(process, 'cwd')`
   setup. Combined setup cost × 3 ≈ 3× current.
3. **Test intent.** The describe-level intent is "createProgram
   workflow commands — workspace preference"; each sub-test
   already isolates a different aspect of that intent (one per
   test in the surrounding file).

## Files touched

- `tests/unit/cli-program.workflow.test.ts` (1 line behavior +
  ~10 lines of "why" comment + the explicit `, 120_000` at the
  test closing).
- `.peaks/memory/slice-016c-cli-program-workflow-parallelism-budget.md`
  (this file).
- `.peaks/memory/MEMORY.md` (index entry).

## Verification

Single-file (baseline regression check):
- `vitest run tests/unit/cli-program.workflow.test.ts -t
  'prefers the workspace' --reporter=dot` → 1 passed,
  5.05s wall.

Combined (slice-014b/015/016 affected files):
- `vitest run tests/unit/g8-shared-channel.test.ts
  tests/unit/cli-commands/map-service-error.test.ts
  tests/unit/cli-command-branches.test.ts
  tests/unit/cli-program.core.test.ts
  tests/unit/cli-program.workflow.test.ts
  tests/unit/rd/repair-cycle-2-cli-wiring.test.ts
  tests/unit/services/job/job-resource-snapshot.test.ts
  tests/unit/workspace/workspace-migrate-f3-cleanup.test.ts
  --reporter=dot` → **8 files passed, 133 tests passed, 0 failed**,
  50.38s wall.

After this commit the user-facing slice-014b/015/016 carry-over
chain is **closed**. Any further `pnpm test:full` failures
will be new (i.e. genuinely introduced by some future slice),
not leftover from the parallelism unlock.

## Why: see also

- [[slice-016-g8-shared-channel-race-mode]] (race-mode flake
  from same parallelism unlock)
- [[slice-016b-cli-command-branches-parallelism-budget]]
  (sibling budget fix, same pattern)
- [[slice-014-vitest-slowdown-and-race-repeat]] (Promise
  propagation lesson — unrelated to budget fixes)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock that exposed all three parallelism-class
  flakes)
- [[slice-015b-test-full-run-flake-evidence]] (carry-over
  evidence + scope-correct retry pattern)
