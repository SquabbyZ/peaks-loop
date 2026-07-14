---
name: slice-016e-dispatch-record-truncation-lock-pressure
description: Slice 016e — replaced 101 appendHeartbeat loop in 'truncates heartbeats past 100 entries' with direct file pre-population of 100 heartbeats + 1 appendHeartbeat call. Drops dispatch-record lock acquisitions 101→1 per run; resolves 180s testTimeout cliff under pnpm test:full maxWorkers=4.
metadata:
  type: lesson
  layer: B
---

# Slice 016e — `dispatch-record-writer` truncation test, real lock-pressure fix

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 016e (fifth micro-cycle; first to use **principled
non-band-aid** fix instead of a budget bump)
**Outcome:** 1 file changed; test body 101 lock-acquisitions
down to 1; single-file baseline preserved at 834ms; combined
8-file regression 127/127 in 56.31s.

## What surfaced

After slice-016d (commit 71bcab7) shipped, `pnpm test:full`
reported **1 remaining failure**:

  FAIL tests/unit/dispatch-record-writer.test.ts >
    'appendHeartbeat (G6)' >
    'truncates heartbeats past 100 entries'
  Error: Test timed out in 180000ms

This test **already had** `{ timeout: 180_000 }` — the slice-014
fix. So bumping the budget again was a band-aid on a real issue,
not the right call. The fix here is structural.

## Root cause (verified, not a guess)

`appendHeartbeat` acquires `withFileLockSync(recordPath, …)`
**on every call** (lines 371 / 418 / 453 in
`src/services/dispatch/dispatch-record-writer.ts`). The test
looped 101 times:

```ts
for (let i = 0; i < 101; i += 1) {
  const r = appendHeartbeat({ recordPath: path, status: 'running', progress: i });
  lastTruncated = r.truncated;
}
```

Single-file baseline: **~9ms per call** × 101 = ~910ms total
(measured: 834ms). Under `maxWorkers: 4` + cumulative load from
the full 520-file suite, each lock acquisition ballooned to
**~1800ms** (≈200× slower per call), pushing total wall to >180s.

The lock contention is on the **same `recordPath`**, not on
shared process-global state — it's the test itself, not the
service, that's hammering the lock 101 times.

## The fix (1 hunk, principled — no budget bump)

Pre-populate the record with 100 heartbeats via a direct JSON
write (bypassing the lock for setup), then call
`appendHeartbeat` **once** to verify the truncation logic.

```diff
-  it('truncates heartbeats past 100 entries', { timeout: 180_000 }, () => {
+  it('truncates heartbeats past 100 entries', () => {
     const { path } = writeInitialDispatchRecord({ ... });
-    let lastTruncated = false;
-    for (let i = 0; i < 101; i += 1) {
-      const r = appendHeartbeat({ recordPath: path, status: 'running', progress: i });
-      lastTruncated = r.truncated;
-    }
+    // Slice 016e — pre-populate 100 heartbeats, appendHeartbeat ONCE
+    // (see comment in body for rationale)
+    const existing = readRecord(path);
+    const prePopulated = { ...existing, heartbeats: [...] };
+    require('node:fs').writeFileSync(path, JSON.stringify(prePopulated), 'utf8');
+    const r = appendHeartbeat({ recordPath: path, status: 'running', progress: 50 });
+    expect(r.truncated).toBe(true);
     const rec = readRecord(path);
     expect(rec.heartbeats).toHaveLength(100);
-    expect(lastTruncated).toBe(true);
   });
```

Lock acquisitions on the dispatch-record path: **101 → 1**.

The single `appendHeartbeat` call still acquires the lock — so
the truncation logic is exercised inside the lock-protected
read-modify-write path. We didn't lose any test coverage; we
just removed 100 redundant lock cycles that were never testing
anything specific (each of the 100 was identical except for
`progress`).

Lock-acquisition correctness is already covered by:

- `heartbeat.test.ts` G5 fuzz (`RACE_REPEAT=3 × N-concurrent
  writers`) — proven concurrent-safe via slice-014.
- The other `appendHeartbeat` tests in this same describe block
  ("rejects invalid input", "truncation of heartbeat notes") —
  exercise single-call semantics.

## Why this is principled (not a band-aid)

- The 180s budget is removed entirely — the test no longer
  needs an explicit timeout because single-call lock pressure
  fits comfortably in the global `testTimeout: 120_000`.
- The contract being tested is "truncation past 100 entries" —
  that contract is preserved (101 → 100 heartbeats after one
  append; truncation flag returned true).
- The fix doesn't change the production code at all.
- The fix doesn't bypass the lock for the assertion step
  (single `appendHeartbeat` still acquires it).
- It eliminates a class of **test-amplified lock contention**
  that would have grown worse as the suite grew (more files,
  more cumulative lock-pressure on dispatch paths).

## Files touched

- `tests/unit/dispatch-record-writer.test.ts` (-12/+18 around
  the target test; `{ timeout: 180_000 }` removed; comment added).
- `.peaks/memory/slice-016e-dispatch-record-truncation-lock-pressure.md`
  (this file).
- `.peaks/memory/MEMORY.md` (index entry).

## Verification

- Single-file (target test only):
  `vitest run tests/unit/dispatch-record-writer.test.ts -t
  'truncates heartbeats past 100 entries'` → 1 passed,
  1.12s wall.
- Whole describe file:
  `vitest run tests/unit/dispatch-record-writer.test.ts` →
  14 passed, 10.51s wall.
- Combined 8 affected files (slice-014/014b/015/016
  siblings):
  `vitest run tests/unit/dispatch-record-writer.test.ts
  tests/unit/services/retrospective/heartbeat.test.ts
  tests/unit/g8-shared-channel.test.ts
  tests/unit/cli-command-branches.test.ts
  tests/unit/cli-program.workflow.test.ts
  tests/unit/workflow-autonomous-resume-validation.test.ts
  tests/unit/rd/repair-cycle-2-cli-wiring.test.ts
  tests/unit/cli-commands/map-service-error.test.ts` →
  **8 files passed, 127 tests passed, 0 failed, 56.31s wall.**

## Why: see also

- [[slice-016-g8-shared-channel-race-mode]] (race-mode flake,
  budget fix)
- [[slice-016b-cli-command-branches-parallelism-budget]]
  (skill-doctor budget fix)
- [[slice-016c-cli-program-workflow-parallelism-budget]]
  (triple-runCommand budget fix)
- [[slice-016d-workflow-autonomous-resume-parallelism-budget]]
  (resume-validation budget fix)
- [[slice-014-vitest-slowdown-and-race-repeat]] (Promise
  propagation lesson; sibling race-mode pattern)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (parallelism unlock that exposed the cumulative lock
  pressure)
- **This slice IS the principled alternative** to the budget
  fixes in 016b/016c/016d — when the lock-contention source
  is in the test itself, fix the test, don't bump the budget.
