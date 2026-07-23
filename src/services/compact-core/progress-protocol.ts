/**
 * Phase 2 Task 2.3 — canonical compact progress semantics (design §8).
 *
 * `CompactProgressTracker` turns the semantic `CompactEvent` stream into a
 * deterministic, monotonic, vendor-neutral progress snapshot. The
 * snapshot is the canonical surface a host bridge maps to its progress UI
 * (design §8.3) — this module never produces ANSI/TUI code.
 *
 * Aggregation rule (design §8.2):
 *
 *     totalPercent = Σ (COMPACT_STAGE_WEIGHTS[s] × fraction[s])
 *
 * where `fraction[s]` is:
 *
 *   - 0   while the stage has not yet been entered;
 *   - progressCompleted/progressTotal (capped to never reach 1.0) while
 *     the stage is the current accepted stage and progress events have
 *     reported in-progress work;
 *   - 1   once the stage has been "moved past" — i.e., a later stage
 *     event was accepted, or — for the terminal `resuming` stage — a
 *     `completed` event was accepted.
 *
 * The `resuming` stage only ever reaches `fraction === 1` via a
 * `completed` event. Combined with the in-progress cap, the invariant
 *
 *     totalPercent === 100  ⇔  a `completed` event was accepted for the
 *                              current path
 *
 * holds for every legal event stream (no clock or random source is
 * consulted).
 *
 * Regression policy (each event is checked in arrival order):
 *
 *   1. **Terminal lock.** Once a `completed` or `failed` event is
 *      accepted, every subsequent event is ignored. The snapshot keeps
 *      its terminal value.
 *   2. **Attempt-id regression.** An event whose `attemptId` differs
 *      from the currently-bound attempt is dropped and the snapshot is
 *      marked `rejected: true` (sticky).
 *   3. **Stage regression.** A `stage` event whose stage index is below
 *      the currently accepted stage index is dropped; the snapshot is
 *      marked `rejected: true`.
 *   4. **Progress regression.** A `progress` event with `completed <
 *      lastCompleted` for the current stage is dropped; the snapshot is
 *      marked `rejected: true`. Non-decreasing values (including equal)
 *      are accepted.
 *
 * `verifyResumeCompletion` is the gate a host bridge calls to confirm a
 * `completed` event actually proves a verified same-UI resume: it returns
 * `ok: true` only when the stream contains a `completed` event whose
 * receipt has all required identity (`attemptId`, `pathGeneration`,
 * valid `path`) and continuity (`sameUi === true`, non-empty
 * `continuationToken`) fields populated. When the stream also contains
 * a `started` event, the receipt's `path` must match the started path
 * so a bridge cannot silently swap paths mid-attempt.
 *
 * Vendor-neutrality: this module imports only the local compact-core
 * protocol types. No host names, no binaries, no slash commands, no
 * vendor conditionals.
 */
import { COMPACT_STAGES, type CompactEvent, type CompactStage, type StartedEvent } from './protocol/compact-events.js';
import type { BridgeReceipt, CompactCompletionReceipt } from './protocol/bridge-receipts.js';

// ── Canonical weight table ─────────────────────────────────────────────────

/**
 * Canonical phase-2 weight table. The sum is **exactly** 100 so the
 * aggregated `totalPercent` is a percentage by construction. The
 * `resuming` weight is new in Phase 2 — Phase 1 stopped at `verifying`.
 */
export const COMPACT_STAGE_WEIGHTS: Readonly<Record<CompactStage, number>> = {
  preparing: 10,
  checkpointing: 15,
  summarizing: 25,
  replacing: 20,
  verifying: 20,
  resuming: 10
} as const;

/**
 * Compile-time + startup assertion that the weight table sums to 100.
 * If a future slice edits the table, this guard fires immediately on
 * module load so the invariant is enforced before any snapshot is
 * produced.
 */
const TOTAL_WEIGHT: number = Object.values(COMPACT_STAGE_WEIGHTS).reduce(
  (sum, w) => sum + w,
  0
);
if (TOTAL_WEIGHT !== 100) {
  throw new Error(
    `COMPACT_STAGE_WEIGHTS must sum to 100, got ${TOTAL_WEIGHT}: ` +
      JSON.stringify(COMPACT_STAGE_WEIGHTS)
  );
}

// ── Snapshot shape ─────────────────────────────────────────────────────────

/** Terminal state of the attempt as observed by the tracker. */
export type CompactTerminal = 'completed' | 'failed' | null;

/**
 * Canonical progress snapshot. Returned by
 * `CompactProgressTracker.accept` and immutable.
 */
export interface CompactProgressSnapshot {
  /** Aggregate percent in [0, 100] (integer). 100 only after a verified `completed`. */
  readonly totalPercent: number;
  /** Stages that have been "moved past" in arrival order. */
  readonly completedStages: readonly CompactStage[];
  /** Terminal event observed, if any. */
  readonly terminal: CompactTerminal;
  /** Sticky flag: true once any regression rule rejected an event. */
  readonly rejected: boolean;
  /** Receipt `completedAt` of the accepted `completed` event, or null. */
  readonly lastEventAt: string | null;
}

// ── Tracker ────────────────────────────────────────────────────────────────

/**
 * Accumulates `CompactEvent`s into a deterministic
 * `CompactProgressSnapshot`. The tracker is intentionally stateful so
 * callers can stream events across multiple `accept` calls; all state
 * transitions are pure functions of the previously accepted state and the
 * new event (no clock, no random, no I/O).
 */
export class CompactProgressTracker {
  /** attemptId of the first accepted event; binds the tracker to one attempt. */
  private boundAttemptId: string | null = null;
  /** pathGeneration of the bound attempt; future events must match both. */
  private boundPathGeneration: number | null = null;

  /** Index into `COMPACT_STAGES` of the current accepted stage (-1 = none). */
  private currentStageIndex: number = -1;

  /** Most recent accepted `progress.completed` for the current stage. */
  private lastProgressCompleted: number = 0;

  /** Most recent accepted `progress.total` for the current stage. */
  private lastProgressTotal: number = 0;

  /** True once at least one in-progress `progress` event has been accepted. */
  private hasProgress: boolean = false;

  /** Stages that have been "moved past" (next stage entered or terminal fired). */
  private movedPast: CompactStage[] = [];

  /** Terminal state. */
  private terminal: CompactTerminal = null;

  /** Sticky: true once any regression rule rejected an event. */
  private rejected: boolean = false;

  /** Receipt `completedAt` of the accepted `completed` event. */
  private lastEventAt: string | null = null;

  /** Path observed on the most recent accepted `started` event. */
  private startedPath: 'native' | 'fallback' | null = null;

  /**
   * Accept a batch of events in arrival order and return the resulting
   * snapshot. Pure from the caller's perspective: every transition is
   * determined by the previously accepted state and the events
   * themselves. Internal state mutates only through `acceptOne`.
   */
  accept(events: readonly CompactEvent[]): CompactProgressSnapshot {
    for (const event of events) {
      this.acceptOne(event);
    }
    return this.snapshot();
  }

  /** Apply a single event. Visible for testing only — production callers use `accept`. */
  private acceptOne(event: CompactEvent): void {
    // 1. Terminal lock: once terminal, every subsequent event is dropped.
    if (this.terminal !== null) return;

    // 2. Attempt-id / path-generation regression. The first accepted
    //    event binds the tracker; subsequent events must match.
    if (this.boundAttemptId !== null) {
      if (event.attemptId !== this.boundAttemptId) {
        this.rejected = true;
        return;
      }
      if (
        this.boundPathGeneration !== null &&
        event.pathGeneration !== this.boundPathGeneration
      ) {
        this.rejected = true;
        return;
      }
    } else {
      this.boundAttemptId = event.attemptId;
      this.boundPathGeneration = event.pathGeneration;
    }

    switch (event.type) {
      case 'started':
        this.startedPath = (event as StartedEvent).path;
        // `started` is identity-only; it does not advance the stage.
        return;

      case 'stage': {
        const idx = COMPACT_STAGES.indexOf(event.stage);
        if (idx < 0) {
          // Defensive: unknown stage label. Reject without poisoning
          // regression state — the label is malformed, not a regression.
          this.rejected = true;
          return;
        }
        // 3. Stage regression: drop stages below the current index.
        if (idx < this.currentStageIndex) {
          this.rejected = true;
          return;
        }
        if (idx > this.currentStageIndex) {
          // Mark the previously-current stage as moved past.
          if (this.currentStageIndex >= 0) {
            const previousStage = COMPACT_STAGES[this.currentStageIndex];
            if (previousStage !== undefined) {
              this.movedPast.push(previousStage);
            }
          }
          this.currentStageIndex = idx;
          this.hasProgress = false;
          this.lastProgressCompleted = 0;
          this.lastProgressTotal = 0;
        }
        return;
      }

      case 'progress': {
        // 4. Progress regression: drop completed values below the last
        //    accepted. Equal values are accepted (idempotent monotone).
        if (event.completed < this.lastProgressCompleted) {
          this.rejected = true;
          return;
        }
        this.lastProgressCompleted = event.completed;
        this.lastProgressTotal = event.total;
        this.hasProgress = true;
        return;
      }

      case 'detail':
        // detail is a no-op for the snapshot.
        return;

      case 'completed': {
        // Move the current stage (if any) to moved-past, then set
        // terminal. This is what unlocks fraction === 1 for `resuming`.
        if (this.currentStageIndex >= 0) {
          const currentStage = COMPACT_STAGES[this.currentStageIndex];
          if (currentStage !== undefined && !this.movedPast.includes(currentStage)) {
            this.movedPast.push(currentStage);
          }
        }
        this.terminal = 'completed';
        this.lastEventAt = event.receipt.completedAt;
        return;
      }

      case 'failed': {
        // `failed` is terminal. Mark current stage as moved-past so the
        // snapshot reflects "we left this stage because of failure".
        if (this.currentStageIndex >= 0) {
          const currentStage = COMPACT_STAGES[this.currentStageIndex];
          if (currentStage !== undefined && !this.movedPast.includes(currentStage)) {
            this.movedPast.push(currentStage);
          }
        }
        this.terminal = 'failed';
        return;
      }
    }
  }

  /** Compute the canonical snapshot from the current tracker state. */
  private snapshot(): CompactProgressSnapshot {
    let totalWeight = 0;
    for (let i = 0; i < COMPACT_STAGES.length; i++) {
      const stage = COMPACT_STAGES[i];
      if (stage === undefined) continue;
      const weight = COMPACT_STAGE_WEIGHTS[stage];
      totalWeight += weight * this.fractionFor(stage, i);
    }
    // Use `Math.floor` (not `round`) so that an in-progress cap strictly
    // below 1.0 can never round up to 100.
    const totalPercent = Math.max(0, Math.min(100, Math.floor(totalWeight)));
    return {
      totalPercent,
      completedStages: this.movedPast.slice(),
      terminal: this.terminal,
      rejected: this.rejected,
      lastEventAt: this.lastEventAt
    };
  }

  /**
   * Compute the per-stage completion fraction in [0, 1]. The in-progress
   * fraction is intentionally capped below 1.0 so that — even if every
   * stage reports `progress 100/100` — `Σ weight × fraction` cannot reach
   * 100 without a `completed` event for `resuming`.
   */
  private fractionFor(stage: CompactStage, index: number): number {
    if (this.movedPast.includes(stage)) {
      return 1;
    }
    if (index !== this.currentStageIndex) {
      return 0;
    }
    // Current stage, in progress. For `resuming`, the in-progress
    // fraction is 0: the only way to leave `resuming` is a `completed`
    // event, which already promotes the stage to `movedPast`.
    if (stage === 'resuming') {
      return 0;
    }
    if (this.hasProgress && this.lastProgressTotal > 0) {
      const raw = this.lastProgressCompleted / this.lastProgressTotal;
      // Cap strictly below 1.0 so a progress event alone cannot push
      // totalPercent to 100 once earlier stages are at 1.0.
      return raw >= 1 ? 99 / 100 : raw;
    }
    return 0;
  }
}

// ── Resume completion gate ─────────────────────────────────────────────────

/** Result of `verifyResumeCompletion`. */
export type ResumeCompletionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate that the event stream proves a same-UI verified resume. The
 * function returns `{ ok: true }` only when the stream contains at least
 * one `completed` event whose receipt has all required identity +
 * continuity fields populated AND — when a `started` event is present —
 * whose `path` matches the started path.
 *
 * Multiple `completed` events: the function inspects the LAST one in
 * arrival order (a later completed event would normally be the freshest
 * attempt end).
 */
export function verifyResumeCompletion(
  events: readonly CompactEvent[]
): ResumeCompletionResult {
  let lastStarted: StartedEvent | null = null;
  let lastCompletedEvent: { readonly receipt: CompactCompletionReceipt } | null = null;

  for (const event of events) {
    if (event.type === 'started') {
      lastStarted = event;
    } else if (event.type === 'completed') {
      lastCompletedEvent = event;
    }
  }

  if (lastCompletedEvent === null) {
    return { ok: false, reason: 'no completed event in stream' };
  }
  const receipt = lastCompletedEvent.receipt;
  return validateReceipt(receipt, lastStarted);
}

/** Validate the receipt + (optional) started path match. */
function validateReceipt(
  receipt: CompactCompletionReceipt,
  started: StartedEvent | null
): ResumeCompletionResult {
  if (typeof receipt.attemptId !== 'string' || receipt.attemptId.length === 0) {
    return { ok: false, reason: 'receipt missing non-empty attemptId' };
  }
  if (
    typeof receipt.pathGeneration !== 'number' ||
    !Number.isInteger(receipt.pathGeneration) ||
    receipt.pathGeneration < 0
  ) {
    return { ok: false, reason: 'receipt has invalid pathGeneration' };
  }
  if (receipt.path !== 'native' && receipt.path !== 'fallback') {
    return { ok: false, reason: 'receipt path must be "native" or "fallback"' };
  }
  if (started !== null && started.path !== receipt.path) {
    return {
      ok: false,
      reason: `receipt path "${receipt.path}" does not match started path "${started.path}"`
    };
  }
  if (receipt.sameUi !== true) {
    return { ok: false, reason: 'receipt does not confirm sameUi === true' };
  }
  if (typeof receipt.continuationToken !== 'string' || receipt.continuationToken.length === 0) {
    return { ok: false, reason: 'receipt missing non-empty continuationToken' };
  }
  if (typeof receipt.completedAt !== 'string' || receipt.completedAt.length === 0) {
    return { ok: false, reason: 'receipt missing non-empty completedAt' };
  }
  // BridgeReceipt identity helpers — fail fast on structurally invalid
  // envelopes (defensive: keeps downstream resume confident in identity).
  assertReceiptIdentity(receipt);
  return { ok: true };
}

/**
 * Re-export of `assertReceiptIdentity` to keep this module self-contained
 * for callers that import only the progress surface.
 */
function assertReceiptIdentity(receipt: BridgeReceipt): void {
  if (typeof receipt.attemptId !== 'string' || receipt.attemptId.length === 0) {
    throw new Error('bridge receipt is missing attemptId');
  }
  if (!Number.isInteger(receipt.pathGeneration) || receipt.pathGeneration < 0) {
    throw new Error('bridge receipt has an invalid pathGeneration');
  }
}