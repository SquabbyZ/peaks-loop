---
name: slice-017-cli-default-subset-fast-default
description: Slice 017 — restructure package.json so pnpm test defaults to the 41-file CLI subset (~3min) instead of the full 489-file suite (~37min). pnpm test:full / test:unit remains the unchanged CI gate. User complaint resolved.
metadata:
  type: lesson
  layer: B
---

# Slice 017 — `pnpm test` defaults to CLI subset (3 min instead of 37)

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 017
**Outcome:** CLI subset as default; CI full-suite unchanged; ~11×
wall-clock speedup for the daily-loop `pnpm test`.

## The user complaint

> "而且单测的时间5800+个测试，要37分钟太慢了"
> (5800+ tests, 37 min, too slow)

`pnpm test:full` runs all 489 unit test files + integration,
taking ~35-40 min wall-clock with `maxWorkers: 4`. The cost is
dominated by `transform ~3000s` + `import ~6500s` + `tests
~25500s` aggregate (per the most-recent `pnpm test:full` output),
where each test file pays full transform/import cost even with
`isolate: false` (verified: doesn't help, per slice-014b).

## The fix (1 line + 1 comment in package.json)

Change `test` to the curated CLI subset that was already wired
up as `test:dev:cli`. The CLI subset exercises the core
public-API surface (program.ts + registerCommand surface) and
already runs in **3m 19s** (measured in this slice: 41 files,
400 tests, all green).

```diff
     "pretest": "node ./scripts/sync-version.mjs",
-    "test": "vitest run tests/unit",
+    "test": "vitest run tests/unit/cli-program.core.test.ts tests/unit/cli-program.stateful.test.ts tests/unit/cli-program.workflow.test.ts tests/unit/cli-program.workflow-cli.test.ts tests/unit/cli-program.workspace.test.ts tests/unit/cli",
     "test:full": "vitest run",
```

The other scripts (`test:unit`, `test:dev`, `test:fast`,
`test:dev:cli`, etc.) preserve their existing semantics.
`test:full` continues to run everything (CI / release gate).

## Why this slice-bucket-of-1 not the slow-lane config split

The slow-lane config split proposed in slice-016f
(`vitest.test.projects` with `[fast, slow]` projects) would
result in `pnpm test` running **only the fast half** of the
suite. The empirical measurement in this slice disproved the
assumption: even the "fast" half (248 files via
`grep -L 'mkdtempSync|execFileSync|spawnSync|spawn(process.execPath'`)
takes **9m 21s** wall. So the "slow-lane split" would not give a
sub-minute default — it would give a sub-10-min default.

The CLI subset is a **better intersection**:

- Tests the program.ts public API (load-bearing for the CLI surface)
- Single-pass: 3m 19s, deterministic
- Already curated by prior maintainers (test:dev:cli has been
  the convention since at least 4.0.0-beta.5)
- Pure mock-based + hermetic (no real git/FS/CLI spawn)

## Trade-off (acknowledge explicitly)

`pnpm test` (now CLI subset) does **not** catch regressions in:

- Workflow tests (`tests/unit/services/workflow/**`)
- rd-service regression tests (`tests/unit/rd/**`)
- Heartbeat / dispatch-record-writer G5 fuzz
- Workflow-autonomous-resume-validation tests
- ~450 other unit files (each with its own purpose)

For releases / CI: `pnpm test:full` is unchanged (still runs
everything). For pre-PR checks: the dev can pick the right
subset via `pnpm test:workflow`, `pnpm test:dev:cli`, etc. —
all already wired.

**This is the same architectural answer the project has used
historically** (test:dev / test:dev:cli / test:dev:unit subsets
are existing convention per vitest-perf.md sediment). We're
promoting the convention to the default `test` slot.

## Why also revert the cumulative-contention budget bumps?

Per slice-016f memory: 5 budget bumps (016b/016c/016d/016e-fix
+ 016f) were applied to make `pnpm test:full` pass under
cumulative contention. After slice-017 those bumps are no
longer load-bearing — `pnpm test` defaults to the CLI subset
(400 tests, no cumulative contention), and `pnpm test:full`
can keep the budget-bump changes for users who explicitly run
the full suite.

Reverting the 5 budget bumps is **out of scope for this
slice** because reverting adds risk (any user running
`pnpm test:full` again would surface the same cliffs). The
right follow-up slice (018) would revert them under a
"verified clean" gate. Not done here to keep the slice small.

## Files touched

- `package.json` (1 line behavior change + the comment was
  already there from prior convention).
- `.peaks/memory/slice-017-cli-default-subset-fast-default.md`
  (this file).
- `.peaks/memory/MEMORY.md` (index entry).

## Verification

- `vitest run tests/unit/cli-program.core.test.ts
  tests/unit/cli-program.stateful.test.ts
  tests/unit/cli-program.workflow.test.ts
  tests/unit/cli-program.workflow-cli.test.ts
  tests/unit/cli-program.workspace.test.ts
  tests/unit/cli --reporter=dot` →
  **41 files passed, 400 tests passed, 3m 19s wall**.
- `pnpm test:full` is unchanged (still runs everything, ~37
  min, now without pre-existing flake cliffs — slice-016b/c/d/
  e/f budget bumps make it pass cleanly).
- All other `pnpm test:*` scripts preserve their semantics.

## Why: see also

- [[slice-016f-cliff-rebump-and-slow-lane-need]] (the prior
  plan; this slice is the simpler / better answer)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock)
- [[slice-015b-test-full-run-flake-evidence]] (carry-over
  evidence)
- `.peaks/memory/vitest-perf-3-slice-delivery-and-3-active-disclosures.md`
  (the project's existing convention: `pnpm test:dev`,
  `pnpm test:dev:cli`, etc. subsets — slice-017 promotes
  `test:dev:cli` to the default `test` slot)
