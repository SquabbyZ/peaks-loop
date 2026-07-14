---
name: slice-015b-test-full-run-flake-evidence
description: Slice 015b — evidence only; 2 race-mode G5 tests in g8-shared-channel are the next-slice carry-over exposed (not caused) by Slice 014b parallelism. cli-program.core empty-goal regression also fixed in 015 follow-up commit 519cf07.
metadata:
  type: lesson
  layer: A
---

# Slice 015b — post-merge `pnpm test:full` evidence (2026-07-14)

## TL;DR

After commit `9146ef0` (Slice 015 main fix) ran the user
executed `pnpm test:full` to verify end-to-end. Report surfaced
**3 failures**, two of which had nothing to do with Slice 015
and one of which was Slice 015 Risk A realized:

| Failure | Cause | Resolution |
|---|---|---|
| `cli-program.core.test.ts:565` "rejects invalid tech workflow and swarm inputs" expected `INVALID_GOAL`, got `INTERNAL_ERROR` | **Slice 015 Risk A realized**: helper regex `/goal must not be empty/i` ≠ throw literal `Goal must be non-empty` (one-word difference) | Fixed in commit `519cf07` (broader regex + re-pinned unit test). |
| `g8-shared-channel.test.ts` (test 1) "≥4 concurrent writeSharedEntry to the same key (20×)" timeout at 180s | Pre-existing race-mode flake. Standalone passes 27/27 in 18s. Times out only under full-suite contention (slice-014b parallelism change exposed what single-fork hid). | **Out of scope for Slice 015**; documented as the next carry-over (matches what [[slice-014-vitest-slowdown-and-race-repeat]] already filed). |
| `g8-shared-channel.test.ts` (test 2) "≥4 concurrent writeSharedEntry to distinct keys (20×)" timeout at 180s | Same as above | Same as above |

`pnpm test:full` totals for this run: `2 failed | 515 passed | 3
skipped (520)` files / `3 failed | 5850 passed | 19 skipped (5872)`
tests, **2172s wall**.

## Why the g8 timeouts are pre-existing, not caused by my work

The two failing g8 tests are part of the
`tests/unit/g8-shared-channel.test.ts > G5 shared-channel
concurrent LWW fuzz (20×)` describe block. Both:

- Use `RACE_REPEAT = 20` (the AC-5.1 repeat).
- Are GUARDED by `{ timeout: 180_000 }` per test (slice-014's
  fix from the O(N) accumulation era).
- Hit `wall-clock grew from <1s → 10-30s` under cumulative
  single-fork load (the slice-014 lesson).

Since Slice 014b unlocked parallelism (`fileParallelism: true`,
`maxWorkers: 4`), each test runs in a separate worker that has
a **fresh** process and a **fresh** `.peaks/_runtime/<sid>/`
on-disk state. The `lock + read-modify-write sequence` in
`writeSharedEntry` operates on real FS paths, and the cumulative
FS-handle pressure from 4 forks running 20 RACE_REPETITION ×
N-concurrent writes each should in principle REDUCE, not
increase. Empirically it doesn't, because the 20x default test
side itself is heavy regardless of parallelism.

Verification run (single worker, no parallelism config override,
the original 014b state) showed: **27/27 tests pass in 18.6s**.
The 180s timeouts are not test-content failures; they are
filesystem contention profiles under **the full 520-file suite**
— which **only happens during full runs**. Standalone g8 is
green. Therefore: pre-existing flake, exposed (not caused) by
Slice 014b's parallelism unlock.

## Why these are NOT part of Slice 015 scope

Per the scope locked in
`.peaks/_runtime/2026-07-14-session-cebb2d/rd/requests/001-015-swarmplan-strict-standards-reach.md`:

> In-scope files (the **only** files I will touch in this slice):
> 1. src/services/config/model-routing.ts
> 2. src/cli/commands/_cli-error-envelope.ts (new)
> 3. src/cli/commands/workflow-commands.ts (4 catches)
> 4. tests/unit/rd/repair-cycle-2-cli-wiring.test.ts (1 new test)
> 5. tests/unit/cli-commands/map-service-error.test.ts (new helper unit test)

g8-shared-channel is not on this list. The MEMORY.md index entry
for [[slice-014-vitest-slowdown-and-race-repeat]] does call out
g8 as "race-mode 套路, 留 slice 015 处理", which is **misleading**
on re-read — that note was authored in Slice 014b context,
where "next slice" meant "the first slice that gets scheduled
after 014b", which by happenstance is Slice 015, but Slice 015
itself has a narrower (CLI-error-fidelity) scope.

The misleading note should be re-labeled: "race-mode 套路, 留
后续 slice（不是 slice-015）处理". Not done in this slice to
keep the diff small and to not retroactively widen Slice 015
scope.

## Recommended next-slice (016) plan (out of scope here)

Per [[peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010]]'s
micro-cycle pattern, Slice 016 should be a focused race-mode
flake investigation:

1. Run `g8-shared-channel.test.ts` under each of {mw=1, mw=2,
   mw=4, mw=8} in the same single-process pool. Quantify which
   worker counts degrade the test to >180s.
2. Apply the same RACE_REPEAT bring-down used in [[slice-014-vitest-slowdown-and-race-repeat]]
   (slice 014 brought RACE_REPEAT from 20 → 3 for
   heartbeat.test.ts; the g8 file wasn't included).
3. Or: split the g8 describe block into a separate `pnpm
   test:race` script entry (the same pattern used in
   package.json:70), excluding it from default `pnpm test`.
4. Verify no new failures introduced; commit under a separate
   Slice 016 commit on main.

Estimated scope: 1 file edit (`package.json` script split) OR
2 file edits (RACE_REPEAT 20 → 3 plus describe-timeout 180s
→ 60s, matching slice-014's heartbeat treatment). Both ~5-min
fixes; the choice depends on whether the user wants full-suite
flakiness removed (option 2) or full-suite runtime reduced
(option 3 = split, faster but flakier if rerun in `pnpm
test:race`).

## Why: see also

- [[slice-014-vitest-slowdown-and-race-repeat]] (parent race lesson)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]] (parallelism unlock that exposed the g8 flake)
- [[slice-015-swarmplan-strict-standards-reach]] (slice whose Risk A was realized & fixed in commit 519cf07)
- commit 9146ef0 — Slice 015 main fix
- commit 519cf07 — Slice 015 Risk A realized & fixed
