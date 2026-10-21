// src/services/batch/batch-phase-advance.ts
//
// ONE owner for "the batch changed phase".
//
// WHY THIS MODULE EXISTS. The batch's four stages end in two compaction
// boundaries — ①→② (diagnosis → topology) and ③→④ (fix → verify) — and
// each boundary is the cheapest moment to compact: the stage's results are
// on disk, its agents are done, and the window is at its heaviest. Both
// boundaries need the same three things: the phase written down, the
// compaction point chosen, and the boundary notice recorded. Two writers
// would drift, and a drifted boundary rule is a batch that compacts at the
// wrong moment — or never.
//
// WHY THE NOTICE IS NOT WRITTEN HERE. The wording belongs to the
// verification stage (`buildPhaseBoundaryNotice`), and this module CONSUMES
// it. A second sentence about the same moment would be a rival, and two
// rivals drift apart.
//
// WHY THE COUNTS IN THE NOTICE ARE THE DIAGNOSIS COUNTS. The notice says
// 诊断完成 — "the diagnosis is complete" — and that is Task 2's wording,
// which this module does not change. So the numbers it carries have to be
// the DIAGNOSIS counts at every boundary: a boundary after a red scoped
// test still reports the diagnosis's counts, because a notice claiming the
// diagnosis finished 1 of 2 items when it finished 2 of 2 would be a false
// fact. If the notice should name the stage that finished, that is a
// change to the producer's wording, and the producer owns it.
//
// WHY THE RATIO IS READ HERE. The compaction point and the notice both
// depend on the window's occupancy, and the two callers that advance a
// phase must not each read it differently. One read, one place.

import { readContextPercent } from '../context/auto-compact-reader.js';
import { resolveOuterSessionId } from '../session/binding-status-service.js';
import { resolveAutoCompactProfile } from '../mode/mode-status-service.js';
import type { AutoCompactMode } from '../code/auto-compact-modes.js';
import {
  decideBatchCompactionPoint,
  isBatchPhaseBoundary,
  type BatchCompactionPoint
} from '../code/batch-compaction-point.js';
import { buildPhaseBoundaryNotice } from './batch-verify.js';
import { readBatchProgress, writeBatchProgress } from './batch-progress-store.js';
import type { BatchItem, BatchPhase, BatchProgress } from './batch-progress-types.js';

/** What the caller knows about the advance. */
export interface BatchPhaseAdvanceInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly batchId: string;
  /** The phase the batch is moving INTO. */
  readonly toPhase: BatchPhase;
  /** The items to record; the record's own items when omitted. */
  readonly items?: readonly BatchItem[];
  /** The wave plan to record; the record's own when omitted. */
  readonly topology?: unknown;
  /** The auto-compact mode; the project's own profile when omitted. */
  readonly mode?: AutoCompactMode;
}

/** What the advance did. */
export interface BatchPhaseAdvanceResult {
  /** The record as it was written. */
  readonly progress: BatchProgress;
  /** The compaction point this advance chose. */
  readonly compaction: BatchCompactionPoint;
  /** The notice recorded, when one was. */
  readonly boundaryNotice?: string;
}

/**
 * Advance the batch's phase, and record the boundary notice when a boundary
 * was crossed.
 *
 * The notice is recorded only when a compaction actually happens: it SAYS
 * that a compaction is running, so writing it while the window is still at
 * 40% would be a false fact.
 *
 * @param input - The batch, the phase it is moving into, and what to record.
 */
export function advanceBatchPhase(input: BatchPhaseAdvanceInput): BatchPhaseAdvanceResult {
  const { projectRoot, sessionId, batchId, toPhase } = input;
  const current = readBatchProgress(projectRoot, sessionId, batchId);
  const items = input.items ?? current?.items ?? [];
  const topology = input.topology ?? current?.topology;
  const fromPhase = current?.phase ?? 'diagnosis';
  const mode = input.mode ?? resolveAutoCompactProfile(projectRoot);
  const ratio = readContextRatio(projectRoot, sessionId);
  const compaction = decideBatchCompactionPoint({ ratio, fromPhase, toPhase, mode });
  const boundaryNotice =
    resolveBoundaryNotice({ fromPhase, toPhase, items, ratio, mode, compaction }) ??
    current?.boundaryNotice;
  const progress: BatchProgress = {
    batchId,
    phase: toPhase,
    items,
    ...(topology === undefined ? {} : { topology }),
    ...(boundaryNotice === undefined ? {} : { boundaryNotice })
  };
  writeBatchProgress(projectRoot, sessionId, progress);
  return {
    progress,
    compaction,
    ...(boundaryNotice === undefined ? {} : { boundaryNotice })
  };
}

/**
 * The notice for this advance, when one is due.
 *
 * Three conditions, and each one is a refusal: the phase did not change,
 * the change was not a boundary, or no compaction is actually running (the
 * notice SAYS a compaction is running, so it may not be written when none
 * is).
 */
function resolveBoundaryNotice(input: {
  readonly fromPhase: BatchPhase;
  readonly toPhase: BatchPhase;
  readonly items: readonly BatchItem[];
  readonly ratio: number;
  readonly mode: AutoCompactMode;
  readonly compaction: BatchCompactionPoint;
}): string | undefined {
  if (input.fromPhase === input.toPhase) return undefined;
  if (!isBatchPhaseBoundary(input.fromPhase, input.toPhase)) return undefined;
  if (!input.compaction.shouldCompact) return undefined;
  const diagnosed = input.items.filter((item) => item.status !== 'pending').length;
  return buildPhaseBoundaryNotice({
    done: diagnosed,
    total: input.items.length,
    ratio: input.ratio,
    mode: input.mode
  });
}

/**
 * The context ratio the compaction point is judged against.
 *
 * The probe is the same one every other context read uses; when it cannot
 * measure, it answers zero, which reads as "there is room" — the same
 * answer today's conservative fallback gives.
 */
export function readContextRatio(projectRoot: string, sessionId: string): number {
  const outerSessionId = resolveOuterSessionId(projectRoot, sessionId, process.env);
  return readContextPercent({ projectRoot, sessionId, outerSessionId, env: process.env }).ratio;
}
