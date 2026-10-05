/**
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
 *
 * Slice `strict-remediation-abc` (C wave 1, leaf `c1w1-await-batch`): the
 * per-slot half of the loop — record reader, slot table, one-tick observation
 * pass, no-progress predicate, poll sleep, result/note rendering — moved
 * VERBATIM into `./await-batch-helpers.ts`. `awaitBatch` was 155 lines at
 * complexity 40, so it held a `max-lines-per-function` error AND a `complexity`
 * warning; that pairing is why no declaration hoist could shorten this file.
 * The bodies did not change. `awaitBatch` keeps this export path because
 * `tests/unit/services/dispatch/sub-agent-dispatcher-timeouts.test.ts` stubs
 * `~/src/services/dispatch/await-batch.js` by path; the budget and outcome
 * rules stay here because they are what the public types above describe.
 */
import {
  buildBatchResults,
  createSlotTable,
  defaultReadOutcome,
  hasNoProgress,
  pollSlotsOnce,
  sleepTick,
  type AwaitBatchSlotResult
} from './await-batch-helpers.js';

export type AwaitBatchOutcome = 'completed' | 'timed-out' | 'clamped' | 'no-progress';

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
   * leave this undefined (the default reads `status` from the file).
   * Returning a plain string is treated as the record's status; the
   * default reader also exposes the `outcome` field via the optional
   * second tuple element (see `defaultReadOutcome`).
   *
   * Test-only escape hatch: callers that need to return both status
   * and outcome can implement `readRecord` instead.
   */
  readonly readOutcome?: (recordPath: string) => string | null;
  /**
   * Test seam: read a record's status AND outcome together. When
   * defined, this overrides `readOutcome`. Implementations should
   * return `{ status: null, outcome: null }` when the file is missing
   * or unreadable, and `{ status }` / `{ status, outcome }` otherwise.
   */
  readonly readRecord?: (recordPath: string) => { status: string | null; outcome: string | null };
}

export interface AwaitBatchResult {
  /** Per-dispatch slot, in dispatchIndex order. */
  readonly results: ReadonlyArray<AwaitBatchSlotResult>;
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
    return emptyBatchResult(timeoutMs, options);
  }

  const budgets = resolveBudgets(timeoutMs, options);
  const seams = resolveSeams(options);
  const startedAt = seams.now();
  const table = createSlotTable(recordPaths, startedAt);

  let batchOutcome: AwaitBatchOutcome = 'completed';

  while (table.slots.size > 0 && seams.now() - startedAt < budgets.effective) {
    if (pollSlotsOnce(table, seams.readOutcome, seams.readRecord, seams.now)) {
      break;
    }

    // No-progress watchdog: only while the effective budget still holds.
    if (seams.now() - startedAt < budgets.effective) {
      if (hasNoProgress(table, seams.now, budgets.noProgressBudget)) {
        batchOutcome = 'no-progress';
        break;
      }
    }

    // Sleep a tick.
    await sleepTick(seams.schedule);
  }

  batchOutcome = resolveBatchOutcome(batchOutcome, table.slots, budgets.requestedClamped);

  // Build the per-dispatch results in dispatchIndex order.
  const results = buildBatchResults(table, options.notePrefix, budgets.effective);

  // Fail-fast de-escalation: when the env var is set, surface the
  // typed outcome but do not let it influence the per-dispatch
  // results. This preserves the pre-S4 silent-return shape so a
  // stuck session can be unblocked by flipping the flag.
  batchOutcome = deescalateOutcome(batchOutcome, FAILFAST_DISABLED);

  return {
    results,
    outcome: batchOutcome,
    requestedTimeoutMs: budgets.requested,
    effectiveTimeoutMs: budgets.effective,
    hardCapMs: budgets.hardCap
  };
}

/** The zero-slot return: nothing to poll, so nothing was waited. */
function emptyBatchResult(
  timeoutMs: number | undefined,
  options: AwaitBatchOptions
): AwaitBatchResult {
  const requested = timeoutMs ?? options.defaultTimeoutMs;
  return {
    results: [],
    outcome: 'completed',
    requestedTimeoutMs: requested,
    effectiveTimeoutMs: 0,
    hardCapMs: options.hardCapMs ?? DEFAULT_HARD_CAP_MS
  };
}

/**
 * timeout above the hard cap is reported as `clamped`; the effective
 * budget is what the loop actually waited.
 */
function resolveBudgets(
  timeoutMs: number | undefined,
  options: AwaitBatchOptions
): {
  readonly hardCap: number;
  readonly requested: number;
  readonly requestedClamped: boolean;
  readonly effective: number;
  readonly noProgressBudget: number;
} {
  const hardCap = options.hardCapMs ?? DEFAULT_HARD_CAP_MS;
  const requested = timeoutMs ?? options.defaultTimeoutMs;
  const requestedClamped = requested > hardCap;
  const effective = Math.min(Math.max(requested, 0), hardCap);
  const noProgressBudget = options.noProgressMs ?? DEFAULT_NO_PROGRESS_MS;
  return { hardCap, requested, requestedClamped, effective, noProgressBudget };
}

/** Resolve the test seams, keeping the production defaults. */
function resolveSeams(options: AwaitBatchOptions): {
  readonly now: () => number;
  readonly schedule: (cb: () => void, ms: number) => void;
  readonly readOutcome: (recordPath: string) => string | null;
  readonly readRecord: (recordPath: string) => { status: string | null; outcome: string | null };
} {
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ??
    ((cb: () => void, ms: number) => {
      const t = setTimeout(cb, ms);
      t.unref?.();
      return t;
    });
  const readOutcome = options.readOutcome ?? ((p: string) => defaultReadOutcome(p).status);
  const readRecord = options.readRecord ?? defaultReadOutcome;
  return { now, schedule, readOutcome, readRecord };
}

/**
 * Post-loop batch outcome:
 *   - `completed` — every slot reached a terminal state
 *   - `timed-out` — at least one slot is still pending and the
 *     effective budget elapsed
 *   - `clamped` — the caller's `requestedTimeoutMs` exceeded the
 *     `clamped` takes precedence over `timed-out` because the
 *     caller specifically asked for more than the cap and the
 *     caller needs to know the cap was applied (the timeout is
 *     secondary information).
 */
function resolveBatchOutcome(
  batchOutcome: AwaitBatchOutcome,
  slots: Map<number, { finishedAt: number | null }>,
  requestedClamped: boolean
): AwaitBatchOutcome {
  let outcome = batchOutcome;
  if (outcome === 'completed' && slots.size > 0) {
    const allReached = Array.from(slots.values()).every((s) => s.finishedAt !== null);
    if (!allReached) {
      outcome = requestedClamped ? 'clamped' : 'timed-out';
    }
  }
  if (outcome === 'completed' && requestedClamped) {
    outcome = 'clamped';
  }
  return outcome;
}

/** The de-escalation itself: the flag only ever downgrades to `completed`. */
function deescalateOutcome(
  batchOutcome: AwaitBatchOutcome,
  failfastDisabled: boolean
): AwaitBatchOutcome {
  if (
    failfastDisabled &&
    (batchOutcome === 'timed-out' || batchOutcome === 'no-progress' || batchOutcome === 'clamped')
  ) {
    return 'completed';
  }
  return batchOutcome;
}
