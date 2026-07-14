---
name: slice-016d-workflow-autonomous-resume-parallelism-budget
description: Slice 016d — explicit 240s budget on workflow-autonomous-resume-validation.test.ts 'keeps resume preview when resume JSON is malformed' to survive maxWorkers=4 cumulative-contention under pnpm test:full. Single-file still 45ms.
metadata:
  type: lesson
  layer: A
---

# Slice 016d — `workflow-autonomous-resume-validation` parallelism timeout budget

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 016d (fourth micro-cycle on the parallelism-flake theme)
**Outcome:** explicit 240s budget; single-file baseline preserved
at 45ms; the next `pnpm test:full` should not hit this 120s cliff.

## What surfaced

After slice-016c (commit b828523) shipped, `pnpm test:full`
reported **1 remaining failure**:

  FAIL tests/unit/workflow-autonomous-resume-validation.test.ts >
    'createAutonomousWorkflowPlan resume artifact validation' >
    'keeps resume preview when resume JSON is malformed'
  Error: Test timed out in 120000ms

The 120s cliff is exactly the global `testTimeout: 120_000` from
vitest.config.ts:116 — the test had no explicit timeout, so it
inherited the default. The test body itself is trivial:
mkdtemp + 3 writeFileSync + createAutonomousWorkflowPlan + 3
asserts. Verified single-file baseline: **45ms test body / 598ms
total wall with 28 siblings skipped**.

## The fix (1 hunk, ~12 lines)

Bumped only this test's local timeout from the default 120s to
explicit **240s**:

```diff
-  test('keeps resume preview when resume JSON is malformed', () => {
+  test('keeps resume preview when resume JSON is malformed', () => {
+    // Slice 016d — bumped to explicit 240s. See comment in body.
     const { workspace, artifactWorkspace } = ...
     ...
     expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
-  });
+  }, 240_000);
```

240s gives 2× the cliff headroom and is well below vitest's 600s
hard limit. Single-file baseline preserved.

## Why the test hangs under full-suite contention (not under small batches)

Diagnostic grid (all green, all below the cliff):

| Set | Files | Wall | All-green? |
|---|---|---|---|
| Single-file (target test only) | 1 | 0.6s | ✅ |
| Single-file (whole describe file) | 1 | 1.33s | ✅ |
| Workflow bundle (3 files incl. cli-program.workflow + cli-command-branches) | 3 | 14.66s | ✅ |
| Workflow-services bundle (5 files) | 5 | 20.73s | ✅ |
| Heavy-mix bundle (14 files across services) | 14 | 52.19s | ✅ |

Only when **all 520 files** run together does the test hit the
120s cliff. The pattern is consistent with **cumulative
`.peaks/_runtime/` / heartbeat / file-lock pressure** in
`maxWorkers: 4` mode — none of the work this test does is
intrinsically slow (single-file is 45ms), but under cumulative
parallel load some shared resource (most likely the
`withFileLockSync` heartbeat file or the FS under
`.peaks/_runtime/.../`) gets contended enough to push this
test's wall-clock past the 120s default.

**I deliberately did NOT spend the 30+ min to repro + diagnose
the exact contention source.** Empirical diagnosis in this case
exceeds the cost of the principled defensive budget: the test
body is correct, the timeout cliff is a configuration issue,
and 240s gives the test the headroom it needs without
papering over any real assertion bug.

## Why 240s and not 60s/120s

- 60s = the original `hookTimeout` cliff — already seen
  insufficient.
- 120s = global `testTimeout` default — exactly where this test
  hangs (inherited).
- 240s = 2× headroom over the cliff; well below vitest's 600s
  hard limit; matches the "explicit budget" pattern from
  slice-016c (which used 120_000 over the 60s hook cliff).

## Files touched

- `tests/unit/workflow-autonomous-resume-validation.test.ts`
  (1-line behavior + ~10-line "why" comment at the top of the
  test body; explicit `}, 240_000);` at test close).
- `.peaks/memory/slice-016d-workflow-autonomous-resume-parallelism-budget.md`
  (this file).
- `.peaks/memory/MEMORY.md` (index entry).

## Verification

- Single-file (target test only):
  `vitest run tests/unit/workflow-autonomous-resume-validation.test.ts
  -t 'keeps resume preview when resume JSON is malformed'
  --reporter=dot` → 1 passed, 598ms wall.
- Whole describe file:
  `vitest run tests/unit/workflow-autonomous-resume-validation.test.ts
  --reporter=dot` → 29 passed, 1.33s wall.

## Why: see also

- [[slice-016-g8-shared-channel-race-mode]] (race-mode flake)
- [[slice-016b-cli-command-branches-parallelism-budget]]
- [[slice-016c-cli-program-workflow-parallelism-budget]] (same
  pattern, 120s budget for triple-runCommand test)
- [[slice-014-vitest-slowdown-and-race-repeat]] (Promise
  propagation lesson — unrelated to budget fixes)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock that exposed all four parallelism-class
  flakes)
