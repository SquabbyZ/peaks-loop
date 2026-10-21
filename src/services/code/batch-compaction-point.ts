// src/services/code/batch-compaction-point.ts
//
// WHEN a batch compacts. The compaction thresholds are not this file's to
// set: `evaluateCompactTrigger` already owns 0.80 / 0.85 / 0.95, and this
// file reads them.
//
// WHY THE COMPACTION POINT IS A PHASE BOUNDARY AND A RATIO. The batch's
// four phases end in two boundaries that are the cheapest moments to
// compact at: ①→② (diagnosis → topology) and ③→④ (fix → verify). At ①→②
// the N diagnosis reports have just been produced; at ③→④ the N fixes
// have just landed. Both are moments where the batch's own state is on
// disk (the progress record) and the window is at its heaviest — which is
// exactly why compacting there costs least and buys most. §7A.4 of the
// design calls the boundary the preferred compaction point; this file is
// how that preference is decided.
//
// THE THREE CASES, AND WHAT IS NOT CHANGED.
//   - ratio ≥ red line (0.95): the red line. Unchanged, and the boundary
//     does not defer it — at the red line the harness is asked NOW,
//     because waiting for a boundary is how a window overflows.
//   - ratio ≥ auto-fire (0.80) at a boundary: the boundary. This is the
//     best point, so the compaction is attributed to it.
//   - ratio ≥ auto-fire (0.80) away from a boundary: the existing
//     auto-compact contract, unchanged. It compresses by itself; it never
//     asks the user.
//
// WHY NOTHING IS DEFERRED. Deferring a compaction to the next boundary is
// what the existing in-flight-batch deferral did, and it is why a batch's
// window was systematically compressed too late: the reports arrive
// together, so the window is already at its worst before the boundary
// arrives. This file never says "wait" — it says where the compaction
// happens.

import type { BatchPhase } from '../batch/batch-progress-types.js';
import { evaluateCompactTrigger } from './auto-compact-decision.js';
import type { AutoCompactMode } from './auto-compact-modes.js';

/** Which rule decided the compaction point. */
export type BatchCompactionKind = 'silent' | 'ratio' | 'phase-boundary' | 'red-line';

/**
 * The decision, in the shape the caller acts on.
 *
 * `action` uses the same vocabulary as `evaluateAutoCompactDecision`, so a
 * caller that already handles that action handles this one.
 */
export interface BatchCompactionPoint {
  readonly kind: BatchCompactionKind;
  readonly shouldCompact: boolean;
  readonly action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line';
  readonly ratio: number;
  /** Whether the batch is crossing one of the two compaction boundaries. */
  readonly atBoundary: boolean;
}

/**
 * The two phase transitions that are a compaction boundary.
 *
 * ①→② is the diagnosis giving way to the topology, ③→④ the fix giving
 * way to the verification. The other two transitions (②→③, ④→done) are
 * not boundaries: neither of them is followed by a stage that reads the
 * stage before it back.
 *
 * @param fromPhase - The phase the batch was in.
 * @param toPhase - The phase the batch is in now.
 */
export function isBatchPhaseBoundary(fromPhase: BatchPhase, toPhase: BatchPhase): boolean {
  return (
    (fromPhase === 'diagnosis' && toPhase === 'topology') ||
    (fromPhase === 'fix' && toPhase === 'verify')
  );
}

/**
 * Decide the batch's compaction point.
 *
 * @param input.ratio - The context ratio, 0..1.
 * @param input.fromPhase - The phase the batch was in.
 * @param input.toPhase - The phase the batch is in now; the same value as
 *   `fromPhase` when no transition happened.
 * @param input.mode - The auto-compact mode; the thresholds come from it.
 */
export function decideBatchCompactionPoint(input: {
  readonly ratio: number;
  readonly fromPhase: BatchPhase;
  readonly toPhase: BatchPhase;
  readonly mode?: AutoCompactMode;
}): BatchCompactionPoint {
  const mode = input.mode ?? 'standard';
  const atBoundary = isBatchPhaseBoundary(input.fromPhase, input.toPhase);
  // The trigger owns the thresholds. This file only asks which zone the
  // ratio is in and whether the batch is at a boundary.
  const trigger = evaluateCompactTrigger(input.ratio, mode);
  const inAutoZone = trigger.kind === 'auto-fire' || trigger.kind === 'pre-compact';
  if (trigger.kind === 'red-line') {
    return {
      kind: 'red-line',
      shouldCompact: true,
      action: 'red-line',
      ratio: input.ratio,
      atBoundary
    };
  }
  if (atBoundary && inAutoZone) {
    return {
      kind: 'phase-boundary',
      shouldCompact: true,
      action: 'auto-compact-now',
      ratio: input.ratio,
      atBoundary
    };
  }
  if (inAutoZone) {
    return {
      kind: 'ratio',
      shouldCompact: true,
      action: 'auto-compact-now',
      ratio: input.ratio,
      atBoundary
    };
  }
  return {
    kind: 'silent',
    shouldCompact: false,
    action: trigger.kind === 'soft-warn' ? 'soft-warn' : 'ok',
    ratio: input.ratio,
    atBoundary
  };
}
