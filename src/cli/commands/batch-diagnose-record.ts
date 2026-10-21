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

import type { BatchCompactionPoint } from '../../services/code/batch-compaction-point.js';
import { planBatchTopology } from '../../services/batch/batch-diagnosis.js';
import { advanceBatchPhase } from '../../services/batch/batch-phase-advance.js';
import { appendBatchItem, readBatchProgress } from '../../services/batch/batch-progress-store.js';
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
}): { progress: BatchProgress; compaction: BatchCompactionPoint } {
  const { projectRoot, sessionId, batchId, items } = input;
  for (const item of items) {
    appendBatchItem(projectRoot, sessionId, batchId, toBatchItem(item));
  }
  const current = readBatchProgress(projectRoot, sessionId, batchId);
  const recorded: readonly BatchItem[] = current?.items ?? [];
  const diagnosed = recorded.filter((item) => item.status !== 'pending');
  const phase: BatchPhase = diagnosed.length === recorded.length ? 'topology' : 'diagnosis';
  // The ①→② boundary is crossed here: the diagnosis stage is over, its
  // results are on disk, and this is the cheapest moment to compact. The
  // advance owns the rule — the notice, the compaction point and the
  // write — so the fix phase's boundary cannot drift from this one.
  const advanced = advanceBatchPhase({
    projectRoot,
    sessionId,
    batchId,
    toPhase: phase,
    items: recorded,
    topology: planBatchTopology(diagnosed)
  });
  return { progress: advanced.progress, compaction: advanced.compaction };
}
