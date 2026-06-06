/**
 * G5.1 / RL-1 — batch size counter.
 *
 * Empirical upper bound for one Dispatcher × one batch: 6 sub-agents.
 * Above 6, the LLM / human is encouraged to split into multiple
 * batches with an explicit reducer step in between. peaks-solo's
 * swarm phase dispatches 3; peaks-rd's 4-way fan-out dispatches 4;
 * peaks-qa's 3-way fan-out dispatches 3. The 6 limit leaves headroom
 * for "qa-business-api" / "qa-business-frontend" / "qa-business-regression"
 * subdivisions (3-way + 3-way = 6) without crossing the line.
 *
 * The counter is in-memory per process. The Dispatcher is expected
 * to call `noteDispatched` once per `peaks sub-agent dispatch` and
 * reset between batches. The CLI also persists a small per-sid
 * counter file so that sub-agent spawns invoked across multiple
 * `peaks sub-agent dispatch` processes within the same batch can be
 * tallied (the batch id ties them together).
 *
 * `BATCH_OVER_LIMIT` is a warning, not a hard fail. The user has been
 * explicit: "RL-1 is empirical; if you have a real reason to go to 7,
 * that's your call". A warning is the right surface — let the LLM /
 * human read the reason and decide.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const BATCH_LIMIT = 6;
export const BATCH_OVER_LIMIT_CODE = 'BATCH_OVER_LIMIT';

export type BatchCounterWarning = {
  readonly code: typeof BATCH_OVER_LIMIT_CODE;
  readonly batchId: string;
  readonly dispatched: number;
  readonly limit: number;
  readonly message: string;
};

/** Build the per-batch counter file path. */
export function batchCounterPath(projectRoot: string, sid: string, batchId: string): string {
  return resolve(projectRoot, '.peaks', '_sub_agents', sid, `batch-${batchId}.counter.json`);
}

/** A single batch counter record. */
export interface BatchCounterRecord {
  readonly batchId: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly count: number;
}

/** Read the current counter; returns 0 if no file yet. */
export function readBatchCount(projectRoot: string, sid: string, batchId: string): number {
  const path = batchCounterPath(projectRoot, sid, batchId);
  if (!existsSync(path)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BatchCounterRecord>;
    return typeof parsed.count === 'number' && parsed.count >= 0 ? parsed.count : 0;
  } catch {
    return 0;
  }
}

/** Increment the counter and return the new value (with any warning). */
export function noteDispatched(
  projectRoot: string,
  sid: string,
  batchId: string,
  now: () => Date = () => new Date()
): { count: number; warning: BatchCounterWarning | null } {
  const path = batchCounterPath(projectRoot, sid, batchId);
  mkdirSync(dirname(path), { recursive: true });
  const previous = readBatchCount(projectRoot, sid, batchId);
  const next: BatchCounterRecord = {
    batchId,
    sessionId: sid,
    createdAt: now().toISOString(),
    count: previous + 1
  };
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  if (next.count > BATCH_LIMIT) {
    return {
      count: next.count,
      warning: {
        code: BATCH_OVER_LIMIT_CODE,
        batchId,
        dispatched: next.count,
        limit: BATCH_LIMIT,
        message:
          `per RL-1, batch size 6 is empirical upper bound; you have ` +
          `${next.count}. If you need more, split into multiple batches ` +
          `with an explicit reducer step between them.`
      }
    };
  }
  return { count: next.count, warning: null };
}

/** Reset a batch counter (called by the reducer when starting a new batch). */
export function resetBatch(projectRoot: string, sid: string, batchId: string): void {
  const path = batchCounterPath(projectRoot, sid, batchId);
  if (existsSync(path)) {
    try {
      const { unlinkSync } = require('node:fs') as typeof import('node:fs');
      unlinkSync(path);
    } catch {
      /* best-effort; counter file is informational */
    }
  }
}
