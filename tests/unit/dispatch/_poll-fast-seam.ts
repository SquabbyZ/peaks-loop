/**
 * Slice 2026-07-30-fast-seam — shared helper for fast-loop
 * dispatch tests.
 *
 * The unified `awaitBatch` service in
 * src/services/dispatch/await-batch.ts exposes two test seams
 * via `AwaitBatchOptions`:
 *
 *   - `schedule?: (cb, ms) => void` — the poll-tick scheduler.
 *     Production default is `setTimeout` (50ms per tick).
 *     Tests inject `(cb) => cb()` to collapse each tick to 0ms.
 *
 *   - `now?: () => number` — the wall-clock used to drive the
 *     no-progress watchdog. Tests inject a fake clock that
 *     advances by 1ms per tick so the watchdog (which compares
 *     `now - lastProgressAt >= noProgressMs`) can trip
 *     deterministically without waiting in real time.
 *
 * The legacy `pollDispatchRecords` and `awaitClaudeCodeBatch`
 * wrappers in sub-agent-dispatcher.ts do NOT expose these
 * seams directly. Tests that need the fast loop have to call
 * `awaitBatch` themselves — the IDE-prefixed note behavior is
 * implemented inside `awaitBatch` itself (see the `notePrefix`
 * handling in await-batch.ts), so this helper reproduces the
 * production wrapper's contract exactly.
 *
 * Why this matters: under the fast project (maxWorkers=8), 8
 * dispatch test files × multiple `await pollDispatchRecords()`
 * calls × real 200ms-30s waits balloon the wall time to 10+
 * minutes. With this seam, every test runs in <100ms and the
 * fast project drops to <5 minutes.
 */

import { awaitBatch } from '../../../src/services/dispatch/await-batch.js';

export interface FastPollArgs {
  recordPaths: string[];
  timeoutMs: number;
  ide: string;
  notePrefix: string;
  defaultTimeoutMs: number;
  fakeStartTime?: number;
}

export interface FastPollResult {
  results: Array<{ status: string; note: string | null }>;
}

/**
 * Test wrapper that mirrors `pollDispatchRecords`'s public
 * contract but short-circuits the poll-tick setTimeout. The
 * returned `results` array preserves the per-slot {status,
 * note} shape that production callers consume.
 */
export async function pollWithFastSeam(
  args: FastPollArgs,
): Promise<FastPollResult> {
  let fakeTime = args.fakeStartTime ?? 0;
  const r = await awaitBatch(
    args.recordPaths.length,
    args.recordPaths,
    args.timeoutMs,
    {
      defaultTimeoutMs: args.defaultTimeoutMs,
      notePrefix: args.notePrefix,
      schedule: (cb) => { cb(); }, // zero-ms tick
      now: () => {
        fakeTime += 1;
        return fakeTime;
      },
    },
  );
  return { results: r.results.map((slot) => ({ status: slot.status, note: slot.note })) };
}
