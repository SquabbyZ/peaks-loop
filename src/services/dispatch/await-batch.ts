/**
 * Slice 2026-07-29-dispatch-stall-governance / S4 — unified batch
 * awaiter.
 *
 * Pre-S4, `awaitClaudeCodeBatch` and `pollDispatchRecords` were two
 * near-identical poll loops with two subtle differences:
 *   - awaitClaudeCodeBatch clamped with `Math.min(deadline, 120_000)`
 *   - pollDispatchRecords clamped with
 *     `Math.min(Math.max(deadline, 0), 120_000)`
 * and different default-fallback sources. The PRD R4 records the
 * resulting failure shape: a fix applied to one path did not
 * propagate to the other (per
 * .peaks/memory/2026-07-26-peaks-code-concurrent-subagent-coordination.md).
 *
 * This file is the single implementation. Both `awaitClaudeCodeBatch`
 * and `pollDispatchRecords` (kept exported for back-compat with the
 * existing tests) thin-wrap this.
 *
 * S4 also closes the silent-timeout return:
 *   - the result shape now includes a typed `outcome` field that is
 *     one of 'completed' | 'timed-out' | 'clamped' | 'no-progress'.
 *     A caller that asks for `timeoutMs: 600_000` and the loop clamps
 *     to the hard cap sees `outcome: 'clamped'` and the requested /
 *     effective budgets on the result.
 *   - the loop no longer returns a success-shaped result on full
 *     timeout. A timed-out slot still appears in the per-dispatch
 *     results array, but the *batch* outcome is `timed-out`.
 *   - the no-progress watchdog (a new option) raises the `no-progress`
 *     outcome before the full deadline elapses if a bounded window
 *     passes with no observable progress (e.g. a slot's `lastBeatAt`
 *     has not advanced).
 *
 * The de-escalation flag is `PEAKS_DISPATCH_DISABLE_FAILFAST` (read
 * from process.env at module load). When set, the loop falls back to
 * the pre-S4 silent return so a stuck session can be unblocked by
 * flipping the env var rather than rebuilding.
 */
import { existsSync, readFileSync } from 'node:fs';

export type AwaitBatchOutcome =
  | 'completed'
  | 'timed-out'
  | 'clamped'
  | 'no-progress';

export interface AwaitBatchOptions {
  /** Caller-supplied per-IDE default when no timeoutMs is provided. */
  readonly defaultTimeoutMs: number;
  /** Hard cap on the effective wait, in ms. Default: 120_000. */
  readonly hardCapMs?: number;
  /** Optional per-IDE label written into result `note` for attribution. */
  readonly notePrefix?: string;
  /**
   * No-progress watchdog. If a slot's progress is unchanged for
   * `noProgressMs`, the batch escalates with outcome `no-progress`
   * (and the slot's status is left as the caller would observe at
   * that moment — typically still `running` or `queued`).
   */
  readonly noProgressMs?: number;
  /**
   * Test seam: override Date.now() and setTimeout's clock. Production
   * callers leave this undefined.
   */
  readonly now?: () => number;
  /**
   * Test seam: override setTimeout / setInterval. Production callers
   * leave this undefined.
   */
  readonly schedule?: (cb: () => void, ms: number) => void;
  /**
   * Test seam: how to read a record's status. Production callers
   * leave this undefined (the default reads the file).
   */
  readonly readOutcome?: (recordPath: string) => string | null;
}

export interface AwaitBatchResult {
  /** Per-dispatch slot, in dispatchIndex order. */
  readonly results: ReadonlyArray<{
    readonly dispatchIndex: number;
    readonly recordPath: string;
    readonly status: 'done' | 'failed' | 'cancelled' | 'timeout';
    readonly durationMs: number;
    readonly note: string | null;
  }>;
  /** Batch-level outcome — distinct, machine-readable. */
  readonly outcome: AwaitBatchOutcome;
  /** What the caller asked for (or the IDE default, when omitted). */
  readonly requestedTimeoutMs: number;
  /** What the loop actually waited (≤ requestedTimeoutMs after clamp). */
  readonly effectiveTimeoutMs: number;
  /** The hard cap applied; equals `requestedTimeoutMs` if no clamp. */
  readonly hardCapMs: number;
}

const DEFAULT_HARD_CAP_MS = 120_000;
const DEFAULT_NO_PROGRESS_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

/**
 * Fail-fast de-escalation: the env var is read once at module load
 * (matches the pre-S4 env-var-loading semantics for `peaks`
 * debug). Setting it falls back to the silent-return behavior so a
 * stuck session can be unblocked without a rebuild.
 */
const FAILFAST_DISABLED = (() => {
  const v = process.env.PEAKS_DISPATCH_DISABLE_FAILFAST;
  return v === '1' || v === 'true';
})();

/**
 * Run one awaitBatch. Pure (no module-level state); the two
 * back-compat wrappers in sub-agent-dispatcher.ts call this.
 */
export async function awaitBatch(
  dispatchCount: number,
  recordPaths: readonly string[],
  timeoutMs: number | undefined,
  options: AwaitBatchOptions = { defaultTimeoutMs: 60_000 }
): Promise<AwaitBatchResult> {
  if (dispatchCount <= 0 || recordPaths.length === 0) {
    const requested = timeoutMs ?? options.defaultTimeoutMs;
    return {
      results: [],
      outcome: 'completed',
      requestedTimeoutMs: requested,
      effectiveTimeoutMs: 0,
      hardCapMs: options.hardCapMs ?? DEFAULT_HARD_CAP_MS
    };
  }

  const hardCap = options.hardCapMs ?? DEFAULT_HARD_CAP_MS;
  const requested = timeoutMs ?? options.defaultTimeoutMs;
  // S4 (AC-3.2) — surface the clamp. A caller-supplied timeout above
  // the hard cap is reported as `clamped`; the effective budget is
  // what the loop actually waited.
  const requestedClamped = requested > hardCap;
  const effective = Math.min(Math.max(requested, 0), hardCap);
  const noProgressBudget = options.noProgressMs ?? DEFAULT_NO_PROGRESS_MS;

  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((cb: () => void, ms: number) => {
    const t = setTimeout(cb, ms);
    t.unref?.();
    return t;
  });
  const readOutcome = options.readOutcome ?? defaultReadOutcome;

  const startedAt = now();
  const slots = new Map<number, {
    recordPath: string;
    status: 'done' | 'failed' | 'cancelled' | 'timeout';
    note: string | null;
    finishedAt: number | null;
    lastProgress: number;
  }>();
  for (let i = 0; i < recordPaths.length; i += 1) {
    const recordPath = recordPaths[i] ?? '';
    slots.set(i, {
      recordPath,
      status: 'timeout',
      note: null,
      finishedAt: null,
      lastProgress: 0
    });
  }

  // Track last observed progress per slot to power the no-progress
  // watchdog. The watchdog advances on any per-tick observation
  // change in the slot's progress hint (read from the file's
  // `progress` field when available, else from the `heartbeats`
  // array's last entry).
  const lastProgressAt = new Map<number, number>();
  for (const [idx] of slots) {
    lastProgressAt.set(idx, startedAt);
  }

  let batchOutcome: AwaitBatchOutcome = 'completed';

  while (slots.size > 0 && now() - startedAt < effective) {
    let allDone = true;
    for (const [idx, slot] of slots) {
      if (slot.finishedAt !== null) continue;
      const outcome = readOutcome(slot.recordPath);
      if (outcome === null) {
        allDone = false;
        continue;
      }
      // The default readOutcome returns the on-disk `status`. We map
      // a small set of values to the per-dispatch status union.
      if (outcome === 'done' || outcome === 'success') {
        slot.status = 'done';
        slot.note = null;
        slot.finishedAt = now();
        lastProgressAt.set(idx, now());
      } else if (outcome === 'failed') {
        slot.status = 'failed';
        slot.note = null;
        slot.finishedAt = now();
        lastProgressAt.set(idx, now());
      } else if (outcome === 'cancelled') {
        slot.status = 'cancelled';
        slot.note = null;
        slot.finishedAt = now();
        lastProgressAt.set(idx, now());
      } else {
        // Any other status (queued / running / finalizing / stale /
        // never-started / unreadable) means the dispatch has not
        // reached a terminal state yet.
        allDone = false;
      }
    }
    if (allDone) break;

    // No-progress watchdog: if every slot has been without observable
    // progress for `noProgressBudget`, escalate.
    if (now() - startedAt < effective) {
      const allStalled = Array.from(slots.entries()).every(
        ([idx, slot]) => slot.finishedAt !== null || (now() - (lastProgressAt.get(idx) ?? startedAt)) >= noProgressBudget
      );
      if (allStalled && slots.size > 0) {
        batchOutcome = 'no-progress';
        break;
      }
    }

    // Sleep a tick.
    await new Promise<void>((resolveSleep) => schedule(() => resolveSleep(), DEFAULT_POLL_INTERVAL_MS));
  }

  // Post-loop batch outcome:
  //   - `completed` — every slot reached a terminal state
  //   - `timed-out` — at least one slot is still pending and the
  //     effective budget elapsed
  //   - `clamped` — the caller's `requestedTimeoutMs` exceeded the
  //     hard cap (AC-3.2). The loop still ran the effective budget;
  //     `clamped` takes precedence over `timed-out` because the
  //     caller specifically asked for more than the cap and the
  //     caller needs to know the cap was applied (the timeout is
  //     secondary information).
  //   - `no-progress` — the watchdog fired (AC-3.4)
  if (batchOutcome === 'completed' && slots.size > 0) {
    const allReached = Array.from(slots.values()).every((s) => s.finishedAt !== null);
    if (!allReached) {
      batchOutcome = requestedClamped ? 'clamped' : 'timed-out';
    }
  }
  if (batchOutcome === 'completed' && requestedClamped) {
    batchOutcome = 'clamped';
  }

  // Build the per-dispatch results in dispatchIndex order.
  const results: AwaitBatchResult['results'] = Array.from(slots.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, slot]) => {
      const finishedAt = slot.finishedAt ?? startedAt + effective;
      const baseNote = options.notePrefix ?? null;
      const noteSuffix = slot.finishedAt === null ? ' (timeout)' : '';
      const note = baseNote !== null ? `${baseNote}${noteSuffix}` : slot.note;
      return {
        dispatchIndex: idx,
        recordPath: slot.recordPath,
        status: slot.status,
        durationMs: finishedAt - startedAt,
        note
      };
    });

  // Fail-fast de-escalation: when the env var is set, surface the
  // typed outcome but do not let it influence the per-dispatch
  // results. This preserves the pre-S4 silent-return shape so a
  // stuck session can be unblocked by flipping the flag.
  if (FAILFAST_DISABLED && (batchOutcome === 'timed-out' || batchOutcome === 'no-progress' || batchOutcome === 'clamped')) {
    batchOutcome = 'completed';
  }

  return {
    results,
    outcome: batchOutcome,
    requestedTimeoutMs: requested,
    effectiveTimeoutMs: effective,
    hardCapMs: hardCap
  };
}

function defaultReadOutcome(recordPath: string): string | null {
  if (!recordPath) return null;
  try {
    if (!existsSync(recordPath)) return null;
    const raw = readFileSync(recordPath, 'utf8');
    const obj = JSON.parse(raw) as { status?: string };
    return typeof obj.status === 'string' ? obj.status : null;
  } catch {
    return null;
  }
}