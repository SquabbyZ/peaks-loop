// src/cli/commands/batch-diagnose-record.ts
//
// The batch record the diagnosis stage writes, and the context ratio the
// compaction point is judged against.
//
// WHY THIS IS ITS OWN FILE. The action beside it (`batch-diagnose-command.ts`)
// was already close to the repo's file-size cap, and the phase advance —
// which chooses the compaction point and records the boundary notice — is a
// second responsibility. Split out, both stay readable.
//
// WHY THE PHASE ADVANCE CHOOSES THE COMPACTION POINT. When the diagnosis
// stage is over, the batch crosses ①→②: the diagnosis results are on disk,
// no diagnosis agent is in flight, and the window is at its heaviest. That
// is the cheapest moment to compact, so the stage that crosses the boundary
// is the stage that says so.

import { readContextPercent } from '../../services/context/auto-compact-reader.js';
import { resolveOuterSessionId } from '../../services/session/binding-status-service.js';
import type { AutoCompactMode } from '../../services/code/auto-compact-modes.js';
import {
  decideBatchCompactionPoint,
  isBatchPhaseBoundary,
  type BatchCompactionPoint
} from '../../services/code/batch-compaction-point.js';
import { planBatchTopology } from '../../services/batch/batch-diagnosis.js';
import { buildPhaseBoundaryNotice } from '../../services/batch/batch-verify.js';
import {
  appendBatchItem,
  readBatchProgress,
  writeBatchProgress
} from '../../services/batch/batch-progress-store.js';
import type {
  BatchItem,
  BatchPhase,
  BatchProgress
} from '../../services/batch/batch-progress-types.js';
import { toBatchItem, type BatchItemInput } from './batch-item-input.js';

/**
 * Record every item, then read the record back and stamp it with the batch's
 * stage and the wave plan.
 *
 * The per-item append is what makes a partial run recoverable: each item
 * lands on disk as it is measured, so a compaction between two items loses
 * neither. The final write carries the two facts that are only knowable once
 * every item is in: the stage, and the plan the measured file sets produce.
 */
export function recordBatch(input: {
  projectRoot: string;
  sessionId: string;
  batchId: string;
  items: readonly BatchItemInput[];
  ratio: number;
  mode: AutoCompactMode;
}): { progress: BatchProgress; compaction: BatchCompactionPoint } {
  const { projectRoot, sessionId, batchId, items, ratio, mode } = input;
  for (const input of items) {
    appendBatchItem(projectRoot, sessionId, batchId, toBatchItem(input));
  }
  const current = readBatchProgress(projectRoot, sessionId, batchId);
  const recorded: readonly BatchItem[] = current?.items ?? [];
  const diagnosed = recorded.filter((item) => item.status !== 'pending');
  const phase: BatchPhase = diagnosed.length === recorded.length ? 'topology' : 'diagnosis';
  const fromPhase = current?.phase ?? 'diagnosis';
  // The ①→② boundary: the diagnosis stage is over, its results are on
  // disk, and this is the cheapest moment to compact. The notice is the
  // verification stage's wording — this command only records it, and the
  // presence read carries it out.
  const crossed = fromPhase !== phase;
  const compaction = decideBatchCompactionPoint({ ratio, fromPhase, toPhase: phase, mode });
  // The notice is written only when a compaction actually happens: it
  // SAYS that a compaction is running, so writing it while the window is
  // still at 40% would be a false fact.
  const boundaryNotice =
    crossed && isBatchPhaseBoundary(fromPhase, phase) && compaction.shouldCompact
      ? buildPhaseBoundaryNotice({ done: diagnosed.length, total: recorded.length, ratio, mode })
      : current?.boundaryNotice;
  const next: BatchProgress = {
    batchId,
    phase,
    items: recorded,
    topology: planBatchTopology(diagnosed),
    ...(boundaryNotice === undefined ? {} : { boundaryNotice })
  };
  writeBatchProgress(projectRoot, sessionId, next);
  return { progress: next, compaction };
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
