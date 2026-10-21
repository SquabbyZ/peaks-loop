// src/services/batch/batch-active-batch.ts
//
// WHICH BATCH is in flight, for a reader that has only a session.
//
// WHY THIS EXISTS. The context reminder (see `batch-context-reminder.ts`)
// has to be attached to a presence read, and a presence read knows the
// SESSION — not the batch. The batch's records live under the session, one
// directory per batch, so the batch in flight is found there.
//
// THE RULE. A batch that has reached the `done` phase is finished: it is
// not in flight, and a finished batch must never make the presence read
// report a reminder. Among the batches that are still running, the one
// written most recently is the one in flight — a session may hold several
// batches' records, and the newest record is the batch the orchestrator
// last touched.
//
// A RECORD THAT CANNOT BE READ IS NOT A BATCH IN FLIGHT. The progress
// store fails loud on a malformed record, and that is right for the
// batch's own recovery path — a batch that silently lost its history
// restarts work it had already done. Here the question is different: "is
// a batch running right now?" — and a record that cannot be read cannot
// answer it. Such a record is skipped, so a corrupt file cannot make the
// presence read report a reminder for a batch nobody can see.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getSessionDir } from '../session/getSessionDir.js';
import { readBatchProgress } from './batch-progress-store.js';
import type { BatchProgress } from './batch-progress-types.js';

const BATCH_DIR = 'batch';

/** The batch that is running, and the record that says so. */
export interface ActiveBatch {
  readonly batchId: string;
  readonly progress: BatchProgress;
}

/**
 * The ids of the batches this session holds a record for.
 *
 * @returns The ids, or an empty list when the session has no batches.
 */
export function listBatchIds(projectRoot: string, sessionId: string): readonly string[] {
  const dir = join(getSessionDir(projectRoot, sessionId), BATCH_DIR);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // A session with no batch directory has no batches. That is an
    // answer, not a failure.
    return [];
  }
}

/**
 * The batch that is in flight, if one is.
 *
 * @returns The running batch, or `null` when the session holds no batch,
 *   only finished batches, or only records that cannot be read.
 */
export function findActiveBatch(projectRoot: string, sessionId: string): ActiveBatch | null {
  const candidates: ActiveBatch[] = [];
  for (const batchId of listBatchIds(projectRoot, sessionId)) {
    let progress: BatchProgress | null;
    try {
      progress = readBatchProgress(projectRoot, sessionId, batchId);
    } catch {
      continue;
    }
    if (progress === null) continue;
    if (progress.phase === 'done') continue;
    candidates.push({ batchId, progress });
  }
  if (candidates.length === 0) return null;
  // The most recently written record is the batch the orchestrator last
  // touched. The id breaks a tie, so the answer does not depend on the
  // order the directory happened to be read in.
  candidates.sort((left, right) => {
    const byTime = (right.progress.updatedAt ?? '').localeCompare(left.progress.updatedAt ?? '');
    if (byTime !== 0) return byTime;
    return left.batchId.localeCompare(right.batchId);
  });
  return candidates[0] as ActiveBatch;
}

/**
 * Whether a batch record is at a COMPACTION BOUNDARY.
 *
 * The batch's phase machine is linear — diagnosis → topology → fix → verify
 * → done — so the phase alone says whether a boundary has been crossed: a
 * batch in `topology` has just crossed ①→②, and a batch in `verify` has
 * just crossed ③→④. In both cases the stage that just finished has its
 * results on disk and its agents are done, which is exactly the moment
 * compaction is cheapest: the recovery cost is the lowest it will be, and
 * the window is at its heaviest.
 *
 * A batch in `diagnosis` or `fix` is mid-stage, with agents in flight: that
 * is the case the existing in-flight deferral is for.
 */
export function isBatchAtCompactionBoundary(progress: BatchProgress): boolean {
  return progress.phase === 'topology' || progress.phase === 'verify';
}

/**
 * Whether a batch in this project is at a compaction boundary.
 *
 * Fail-safe: `false` when there is no batch in flight, when its record
 * cannot be read, and when the batch is mid-stage. A false answer leaves
 * the existing behaviour exactly as it was.
 */
export function resolveBatchCompactionBoundary(projectRoot: string, sessionId: string): boolean {
  const active = findActiveBatch(projectRoot, sessionId);
  return active !== null && isBatchAtCompactionBoundary(active.progress);
}
