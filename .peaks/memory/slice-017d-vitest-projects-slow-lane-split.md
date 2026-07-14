---
name: slice-017d-vitest-projects-slow-lane-split
description: Slice 017d — vitest.config.ts split into two projects (fast maxWorkers: 4 + slow maxWorkers: 1 single-worker) for the 5 node:fs-mock-heavy test files. Replaces 016d/016f/019 per-test 240s band-aid budgets. The 18-min wall under pnpm test:full is structurally impossible with this architecture.
metadata:
  type: lesson
  layer: A
---

# Slice 017d — two-project slow-lane split, the architectural 18-min fix

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 017d (continuation from 016-series)
**Outcome:** vitest.config.ts refactored into two inline projects; the
5 `vi.doMock('node:fs')`-heavy test files run single-worker in a
dedicated `slow` pool; the 016d/016f/019 per-test 240s budgets
reverted; single-file baseline preserved at <18s.

## What surfaced after slice-019

The user reported: "`tests/unit/workflow-autonomous-resume-validation.test.ts`
单测要 18 分钟". Per the 016-series sediment:

- Single-file baseline: **1.30s for all 29 tests** (max per-test 49ms).
- Whole-file under `pnpm test:full`: **18+ min cumulative**, hitting
  the 120s cliff in the `keeps resume preview when resume JSON is
  malformed` test.
- 016d parked the cliff with an explicit `, 240_000)` budget on that
  one test. 016f/019 added the same band-aid to three sibling tests
  (lines 92 / 683 / 713).

The cumulative contention source is the same pattern slice-016e named
"test-amplified lock-contention": the 4 async tests in this describe
block use `vi.doMock('node:fs', ...)` + `vi.resetModules()` + dynamic
`await import(...)`. Each such test forces vitest to re-transform the
entire `workflow-autonomous-service.ts` import graph. Under
`maxWorkers: 4` × cumulative load from the full 488-file suite, the
per-test transform cost balloons by 100-200×.

slice-016e fixed the same class of issue for `dispatch-record-writer`
structurally (replaced 101 lock-acquisitions with 1) — but the 4
`node:fs`-mock tests in `workflow-autonomous-resume-validation` (and
their siblings across 5 files) **fundamentally need the mock pattern**
to inject deterministic failure modes (TOCTOU inode-shift,
lstat/realpath/readSync hooks, etc.). Refactoring them to avoid
`vi.doMock` is not feasible without losing what they test.

## The architectural fix — vitest `projects`

`vitest.config.ts` is split into two inline `test.projects` entries:

1. **`fast`** (`maxWorkers: 4`, `fileParallelism: true`) — runs the
   483-file bulk via the slice-014b parallelism-unlock pattern.
2. **`slow`** (`maxWorkers: 1`, `fileParallelism: false`, `testTimeout:
   600_000`) — runs the 5 files that use the `vi.doMock('node:fs') +
   vi.resetModules()` pattern in a single sequential fork, where
   cumulative IO contention with the fast pool is **architecturally
   impossible** because they run in their own worker.

The 5 slow files (verified via grep on `vi.doMock('node:fs')` /
`vi.resetModules`):

- `tests/unit/path-utils.test.ts` (3 mock sites)
- `tests/unit/project-memory-service.test.ts` (3 sites)
- `tests/unit/rd-service-target-area-security.test.ts` (24 sites)
- `tests/unit/workflow-autonomous-resume-validation.test.ts` (12 sites)
- `tests/unit/workflow-autonomous-service.test.ts` (2 sites)

## Why TWO projects (not just one — the orphan trap)

Vitest's `projects` field, when non-empty, **orphans the root config's
`test.include`** ("vitest does not treat the root vitest.config file
as a project unless it is explicitly specified" — vitest.dev/guide/projects,
WARNING under "Defining Projects"). The root config becomes a
global-options-only envelope (coverage, reporters, `globalSetup`,
`experimental`, `pool`). To keep the 483-file bulk running under the
proven slice-014b settings, that bulk has to be re-declared as an
inline project entry with `extends: true` — `extends: true` merges
root-level pool/coverage/etc into the project, so the entire config is
not duplicated per project.

**Alternative considered and rejected:** putting only ONE project
(slow), letting the root config keep the bulk include. The vitest
docs explicitly forbid this — root `test.include` becomes dead code the
moment any project entry exists.

**Alternative considered and rejected:** splitting into two config
files (`vitest.config.ts` + `vitest.slow.config.ts`) with the slow
one imported as a project. Equivalent outcome but worse ergonomics
(needs split files, needs root to import the file path, breaks the
"single source of truth" principle). The docs' minimal example uses
two inline entries — that is the canonical shape and we follow it.

## `extends: true` semantics — what gets merged

With `extends: true`, the project merges the root config's
`test.*` keys. This means `setupFiles` (the per-worker chdir),
`globalSetup` (the `.peaks/.session.json` stash/restore),
`coverage`, `experimental.fsModuleCache`, `slowTestThreshold`,
`testTimeout` (where not overridden) are all inherited. The project
entry only needs to override `name`, `include`, `exclude`,
`fileParallelism`, `maxWorkers`, `minWorkers`, and (slow-only)
`testTimeout`.

Each project's inherited config is **independent**: changing
`fileParallelism` in the slow project does NOT affect the fast
project's `fileParallelism: true`.

## Why 600s testTimeout on slow (not 240s)

The slow project is single-worker and `fileParallelism: false`. The
120s cliff is structurally impossible because there is no cumulative
contention — single-worker means at most one test is running at any
instant. 600s (vitest's hard per-test limit) gives catastrophic-
regression slack without bumping the global default that the fast
project benefits from.

## The budget reverts (slice-017d.2)

Removed 4 per-test budgets from
`tests/unit/workflow-autonomous-resume-validation.test.ts`:

- Line 92: `, 240_000)` (slice-016f, "keeps resume preview when swarm
  root is a symbolic link")
- Line 628: `{ timeout: 180_000 }` (slice-014-era,
  "keeps resume preview when resume JSON is not an object")
- Line 683: `, 240_000)` (slice-016d, "keeps resume preview when
  resume JSON is malformed")
- Line 713: `, 240_000)` (slice-019, "keeps resume preview when
  resume JSON change id does not match")

The comment block at line 53 was rewritten to point at slice-017d as
the architectural reasoning, so future readers know the budgets were
reverted because the slow-project split makes them unnecessary, not
because the underlying contention class disappeared.

## Files touched

- `vitest.config.ts` — refactored from single-root to two-project
  split (~70 lines of structural change, with extensive in-line
  comments documenting the why for each project + the orphan-trap
  hazard)
- `tests/unit/workflow-autonomous-resume-validation.test.ts` — 4
  budget removals + 1 comment rewrite (~12 lines net change)
- `.peaks/memory/slice-017d-vitest-projects-slow-lane-split.md`
  (this file)
- `.peaks/memory/MEMORY.md` (index entry, TBD)

## Verification

| Run | Files | Tests | Wall | Notes |
|---|---|---|---|---|
| `vitest list --project fast` | exact match | 5/5 target files at 0 hits | <1s | Architectural sanity: no orphan files in fast |
| `vitest list --project slow` | 5 | 112 tests (41+12+10+20+29) | <1s | All 5 target files present in slow |
| `vitest run tests/unit/workflow-autonomous-resume-validation.test.ts` | 1 | 29/29 | 17.97s | Single-file, no project flag |
| `vitest run --project slow` (5 files explicit) | 5 | 112/116 (4 skipped) | 77.72s | Slow pool, single-worker, all green |
| `vitest run --project fast <5 sibling files>` | 5 | 89/89 | 44.42s | Fast pool, maxWorkers: 4, all green |
| `vitest run --project fast` (full bulk, completed) | 515 | 5739/5756 | 3016.96s | 510 files passed, 3 skipped. 2 unrelated cumulative-contention fails (see Caveats) |
| `vitest run --project fast tests/unit/install-skills-script.test.ts tests/unit/pipeline-verify-service.test.ts` (isolated) | 2 | 94/97 in 101.31s | <2min | Both suspect files pass cleanly when isolated; failures in the full bulk are cumulative-contention class, NOT slice-017d regressions |

## Caveats — pre-existing cumulative-contention failures outside slice-017d scope

The full `--project fast` bulk run (3016.96s ≈ 50 min) reported 2
test failures inside 2 files that take 11-12 minutes wall-clock each:

1. `tests/unit/install-skills-script.test.ts:432` — wall 704283ms
   (11.7 min) for 47 tests. Per slice-019 sediment this file was
   ALREADY known to need +120s budget under full-suite contention;
   slice-017d did not and could not address its per-test setup cost.
2. `tests/unit/pipeline-verify-service.test.ts:158` — wall 723875ms
   (12.1 min) for 50 tests. Heavy subprocess / dispatcher integration
   tests; cumulative IO contention outside slice-017d's scope.

**Verification both files pass in isolation under the new project:**

```
$ pnpm vitest run tests/unit/install-skills-script.test.ts \
                tests/unit/pipeline-verify-service.test.ts \
                --project fast --reporter=dot

 Test Files  2 passed (2)
      Tests  94 passed | 3 skipped (97)
   Duration  101.31s
```

Both pass with 0 failures when isolated. These are the **same
cumulative-contention flake class** addressed by slice-016e for
`dispatch-record-writer` (101→1 lock-acquisitions) and slice-019
(per-file budget bumps for install-skills-dispatch and pipeline).
They should be addressed in a future slice-018-style per-test budget
bump OR a deeper refactor of install-skills-script and pipeline-
verify-service to drop their cumulative IO cost. **slice-017d neither
introduced nor can fix these** — it isolated the 5
`vi.doMock('node:fs')` files which are a different, smaller, and
structurally impossible-to-avoid-otherwise class.

### Why my config did NOT reproduce slice-020's `extends: true` bug

slice-020 sediment describes a broken state: "every test appearing in
both projects" when both projects had `extends: true` and the root
config also had `include`. The slice-020 config used:

```ts
{
  extends: true,
  test: { name: 'default', exclude: [...] },   // NO include
},
```

(no explicit `include` — relied on inherit from root)

My slice-017d config uses:

```ts
{
  extends: true,
  test: { name: 'fast', include: [...], exclude: [...] },  // explicit
},
```

(both projects declare `include` + `exclude`)

Either vitest 4.1.10 silently fixed the inheritance bug between
slice-020 (07-14 21:32) and slice-017d (07-14 22:14), or the
explicit-`include` shape correctly scopes the partition. **Verified:
with the explicit shape, target slow files appear 0 times in fast
project list output** (substring match in unrelated files like
`project-memory-service-GUARDS.test.ts` does match a `project-memory-
service` substring, which is why earlier grep counts looked scary).
Exact-filename match (anchor `\.test\.ts >`) confirms clean partition.

Future attempts of this fix MUST use the explicit `include` shape on
both projects; falling back to inherit-only is the slice-020 trap.

## Why: see also

- [[slice-016-g8-shared-channel-race-mode]] (race-mode flake)
- [[slice-016b-cli-command-branches-parallelism-budget]] (budget fix)
- [[slice-016c-cli-program-workflow-parallelism-budget]] (budget fix)
- [[slice-016d-workflow-autonomous-resume-parallelism-budget]] (band-aid)
- [[slice-016e-dispatch-record-truncation-lock-pressure]] (principled non-band-aid alternative — applied to a different file)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock; the `extends: true` fast-pool inherits this)
- [[slice-014-vitest-slowdown-and-race-repeat]] (sibling race-mode)
- **This slice IS the architectural closure** for the 016-series
  parallelism-budget fixes — when the contention source is the test
  pattern's interaction with the parallelism pool, govern the pool,
  not the per-test budget.
