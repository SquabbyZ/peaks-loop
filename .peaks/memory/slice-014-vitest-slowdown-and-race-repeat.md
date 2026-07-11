---
name: slice-014-vitest-slowdown-and-race-repeat
description: Slice 014 — vitest fork slowdown × RACE_REPEAT=20 blew 60s/120s timeouts; fix was Promise propagation + lower RACE_REPEAT + defensive wall-clock guard
metadata:
  type: lesson
  layer: A
---

# Slice 014 lesson — vitest slowdown + fuzz races + file-lock wall-clock guard

**Date:** 2026-07-11
**Slice:** 014 — file-lock + heartbeat concurrency fuzz failures (5 tests)
**Session:** 2026-07-08-session-17918f

## The trap

`tests/unit/services/retrospective/heartbeat.test.ts` and `tests/unit/dispatch-record-writer.test.ts` both used:

1. **`RACE_REPEAT = 20`** — AC-5.1 "20× repeat" intent.
2. A `launchConcurrent` helper (or inline equivalent) that **swallowed inner-Promise rejections**:
   ```ts
   new Promise<T>((resolveLaunch) => {
     process.nextTick(() => {
       setImmediate(async () => {
         const result = await body(i);
         resolveLaunch(result); // ← never reached on rejection
       });
     });
   })
   ```
3. Per-describe `{ timeout: 60_000 }` (or global `testTimeout: 120_000`).

## The interaction

When vitest runs **multiple files together** under `pool: 'forks'` + `fileParallelism: false`, each test's wall-clock grows from <1s to 10–28s. With `RACE_REPEAT=20 × 4-6 concurrent body × 10-28× slowdown`, the fuzz describe blows past 60s/120s. Vitest reports "Test timed out" — but the **real** inner cause is:

- `body(i)` rejects (e.g., `Dispatch record not found` from a sibling afterEach).
- Inner async swallows the rejection → unhandled rejection.
- Outer Promise stays pending forever.
- `Promise.all` waits forever.
- vitest per-describe timeout fires.

## The fix (3 layers, all surgical)

1. **Promise propagation** — chain `.then(resolveLaunch, rejectLaunch)` so errors surface as `Promise.all` rejections (not silent unhandled).
2. **Lower `RACE_REPEAT`** — 20 → 3 (keep `process.env.PEAKS_RACE_REPEAT` override for full 20× in `pnpm test:race`).
3. **Raise describe timeout** — 60s → 180s for the race describes (matches `RACE_REPEAT=3 × 28s ceiling ≈ 84s`).
4. **Defensive `withFileLockSync` wall-clock guard** — track `startedAt = Date.now()`, throw `LockTimeoutError` if `Date.now() - startedAt > LOCK_STALE_MS`. Belt-and-braces for pathological slow-system cases.

## Files touched

- `tests/unit/services/retrospective/heartbeat.test.ts`
- `tests/unit/dispatch-record-writer.test.ts`
- `src/services/filesystem/file-lock.ts`

## Why this matters going forward

- **Test-fuzz helpers must propagate rejections** — `Promise<T>((resolve) => { ... async fn ... resolve(result) })` is a footgun. Use `(resolve, reject)` + `.then(r, e)`.
- **Race-mode tests are heavy** — `pnpm test:race` (4 files in single-fork) is the right surface for them; keep them out of the default `pnpm test` subset.
- **Wall-clock budgets on file-lock** — vitest slowdown can push test wall-clock past `LOCK_STALE_MS` (30s), defeating the "fresh lock is NOT reaped" assertion. The wall-clock guard makes the lock non-self-reapable regardless of system slowdown.

## Open follow-ups (slice 015 candidates)

- Apply same `RACE_REPEAT` + describe-timeout treatment to `tests/unit/g8-shared-channel.test.ts` and `tests/unit/cli/commands/share-commands.test.ts` (other 2 race-mode files).
- Move all 4 race-mode files into `pnpm test:race` only (don't run in default `pnpm test`).
- Investigate vitest 4.x root-cause slowdown — possibly a per-test O(N) queue growth in fork mode.

## Why: see also

- `.peaks/_runtime/2026-07-08-session-17918f/prd/014-file-lock-heartbeat-concurrency-fuzz-failures.md`
- `.peaks/_runtime/2026-07-08-session-17918f/rd/014-file-lock-heartbeat-concurrency-fuzz-failures.md`
- `.peaks/_runtime/2026-07-08-session-17918f/qa/014-file-lock-heartbeat-concurrency-fuzz-failures.md`