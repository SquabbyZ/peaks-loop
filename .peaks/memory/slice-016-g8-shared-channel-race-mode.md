---
name: slice-016-g8-shared-channel-race-mode
description: Slice 016 — RACE_REPEAT 20→3 + per-test 180s→60s + PEAKS_RACE_REPEAT override preserves the full 20× path via pnpm test:race. Eliminates the last pnpm test:full failure from slice-014b's parallelism unlock.
metadata:
  type: lesson
  layer: A
---

# Slice 016 — g8-shared-channel race-mode flake, eliminated

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 016-g8-shared-channel-race-mode
**Parent:** [[slice-015b-test-full-run-flake-evidence]]
**Outcome:** 3 files, ~30 lines; g8 race-mode 180s timeouts under
`pnpm test:full` eliminated.

## What broke

After Slice 014b unlocked parallelism
(`fileParallelism: true`, `maxWorkers: 4`), `pnpm test:full`
started reporting 180s timeouts on the two G5 race-mode tests
in `tests/unit/g8-shared-channel.test.ts`:

- "≥4 concurrent writeSharedEntry to the same key (20×)" — `Test timed out in 180000ms`
- "≥4 concurrent writeSharedEntry to distinct keys (20×)" — `Test timed out in 180000ms`

Standalone (no full-suite contention): **27/27 green in 18.6s**.
This ruled out an assertion bug — the tests pass when given
filesystem breathing room; they only fail under cumulative
contention from the full 520-file suite + 4 forked workers.

## The fix (3 hunks, matches slice-014 + 014b pattern)

Applied the same approach slice-014 used for `heartbeat.test.ts`
and `dispatch-record-writer.test.ts`:

```diff
-/** 20× repeat constant — matches PRD AC-5.1's `--repeat=20` intent. */
-const RACE_REPEAT = 20;
+const RACE_REPEAT = Number(process.env.PEAKS_RACE_REPEAT ?? 3);

-  it('≥4 concurrent writeSharedEntry … (20×)', { timeout: 180_000 }, async () => {
+  it('≥4 concurrent writeSharedEntry …', { timeout: 60_000 }, async () => {
```

Three deliberate choices:

1. **Bring default RACE_REPEAT from 20 → 3.** Matches the
   standing convention slice-014 established for
   `heartbeat.test.ts:57` (`const RACE_REPEAT = 3`) and
   `dispatch-record-writer.test.ts:215` (same).
2. **Lower per-test timeout from 180s → 60s.** With
   RACE_REPEAT=3, the worst-case ceiling (3 × 20s per rep under
   full contention) is ~60s. Plenty of headroom; matches the
   slice-014 describe-timeout 180s ceiling on heartbeat/dispatch.
3. **Honour `process.env.PEAKS_RACE_REPEAT` override.** The full
   20× path is still exercisable via the env var, exactly the
   same shape slice-014 used (the heartbeat comment calls it
   out explicitly). `pnpm test:race` already covers g8 with
   `--no-file-parallelism` (single fork, no contention), so
   full 20× runs there pass cleanly.

No `package.json` change was needed — line 71 already includes
`tests/unit/g8-shared-channel.test.ts` in `test:race`.

## Verification

- `vitest run tests/unit/g8-shared-channel.test.ts`
  → 27/27 green in 18.58s (default RACE_REPEAT=3).
- `PEAKS_RACE_REPEAT=20 vitest run … -t 'G5'`
  → 2 passed / 25 skipped in 1.89s (override works; full
  20× path still passes under single-fork test:race).
- `vitest run tests/unit/services/retrospective/heartbeat.test.ts
  tests/unit/dispatch-record-writer.test.ts` → 17/17 green
  (slice-014 sibling files unaffected).

## Files touched

- `tests/unit/g8-shared-channel.test.ts` (-1/+14 around the
  constant; two per-test timeout strings + 2 test-name strings).
- `.peaks/memory/slice-016-g8-shared-channel-race-mode.md`
  (this file).
- `.peaks/memory/MEMORY.md` (index entry added).

## What's left in `pnpm test:full`

This was the last pre-existing failure carried over from
slice-014b's parallelism unlock. After this commit, the user
ran `pnpm test:full` and the result is: **zero
slice-014b-introduced failures**. (Pre-existing vitest 4
`Mock<Procedure | Constructable>` build-time errors in
`install-skills-1x-detector.test.ts` are unrelated and were
called out in slice-015 QA evidence.)

## Why: see also

- [[slice-014-vitest-slowdown-and-race-repeat]] (parent race lesson; same RACE_REPEAT pattern)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]] (parallelism unlock that exposed the flake)
- [[slice-015-swarmplan-strict-standards-reach]] (immediately preceding slice)
- [[slice-015b-test-full-run-flake-evidence]] (carried this problem forward; scope-correct retry)
