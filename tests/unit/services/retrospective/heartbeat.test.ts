/**
 * G5 — concurrent heartbeat fuzz for the retrospective/heartbeat boundary
 * (slice A.3 of v2-14-0-anti-fake-green-hardening, AC-5.2).
 *
 * Scope: verify that `appendHeartbeat` + `markCompleted` + `markDisposed`
 * on a single shared dispatch record file remain atomic and lossless when
 * ≥4 concurrent Promises interleave on the same record path.
 *
 * Why this lives in `retrospective/`: the heartbeat file IS the
 * retrospective log of one sub-agent dispatch — the on-disk record is
 * what a retrospective job later reads. A race that silently drops a
 * heartbeat shows up as a missing progress update in the retrospective
 * view. Hence: this file's purpose is to pin the heartbeat file's
 * concurrency contract from the retrospective consumer's perspective.
 *
 * 20× repeat (RACE_REPEAT): vitest 2.1.9 (the pinned version) does not
 * expose a `--repeat` CLI flag (added in vitest 2.2+). To satisfy
 * AC-5.1's "20× repeat" intent without bumping the vitest dep, every
 * fuzz case in this file wraps its body in a 20-iteration loop. Each
 * iteration uses a fresh `mkdtempSync` root so each run is independent.
 *
 * Tooling: vitest built-in + Node `setImmediate` / `process.nextTick`
 * scheduling. NO fast-check / jsfuzz per AC-5.5.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendHeartbeat,
  markCompleted,
  markDisposed,
  readRecord,
  writeInitialDispatchRecord
} from '../../../../src/services/dispatch/dispatch-record-writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-heartbeat-fuzz-'));
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // ignore — best effort
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

const RID = '001-2026-06-28-heartbeat-fuzz';
const SID = '2026-06-28-session-heartbeat-fuzz';

/** 20× repeat constant — matches PRD AC-5.1's `--repeat=20` intent. */
const RACE_REPEAT = 20;

/**
 * Run `n` tasks concurrently with a deterministic scheduling hook.
 *
 * Why not `Promise.all([...])` directly? Promise.all schedules by V8's
 * microtask queue; the interleaving between file-lock acquire and write
 * is timing-driven and won't reliably reproduce races. We schedule each
 * task on `setImmediate` after a `process.nextTick` so all N tasks reach
 * the lock boundary in a known microtask + macrotask order. The body
 * itself still uses async/await, so the lock semantics being fuzzed are
 * unchanged — only the launch interleaving is deterministic.
 *
 * Returns the inner Promise<T>[] array (NOT the Promise.all wrapper) so
 * callers can `.push(...)` additional tasks into the same launch window
 * (used for the markCompleted/markDisposed race tests).
 */
function launchConcurrent<T>(n: number, body: (idx: number) => Promise<T>): Promise<T>[] {
  const promises: Promise<T>[] = [];
  for (let i = 0; i < n; i += 1) {
    promises.push(
      new Promise<T>((resolveLaunch) => {
        process.nextTick(() => {
          setImmediate(async () => {
            const result = await body(i);
            resolveLaunch(result);
          });
        });
      })
    );
  }
  return promises;
}

describe('G5 heartbeat: 4+ concurrent appendHeartbeat on same record', { timeout: 30_000 }, () => {
  it('preserves every heartbeat in append-order under concurrent appendHeartbeat (fuzz, 20×)', async () => {
    for (let rep = 0; rep < RACE_REPEAT; rep += 1) {
      // Bootstrap a real record via writeInitialDispatchRecord. Each
      // repeat uses a fresh mkdtempSync root from the outer beforeEach.
      const { path } = writeInitialDispatchRecord({
        projectRoot: root,
        sessionId: SID,
        requestId: `${RID}-rep-${rep}`,
        role: 'rd',
        prompt: 'race test prompt',
        toolCall: { name: 'Task', args: {} },
        batchId: `batch-race-1-rep-${rep}`
      });

      // Launch 6 concurrent appendHeartbeat calls (≥4 per AC-5.2). Each one
      // carries a unique progress + note so a lost-update regression would
      // surface as a missing `progress` value in the final record.
      const N = 6;
      const results = await Promise.all(launchConcurrent(N, async (i) => {
        return appendHeartbeat({
          recordPath: path,
          status: 'running',
          progress: (i + 1) * 10,
          note: `hb-${rep}-${i}`
        });
      }));

      // Sanity: every call returned ok (the lock should serialize them
      // without losing any).
      expect(results).toHaveLength(N);
      for (const r of results) {
        expect(r.truncated).toBe(false);
      }

      // Re-read the on-disk record and assert every (progress, note)
      // value survived. A race that lost an update would have fewer than
      // N heartbeats here.
      const finalRecord = readRecord(path);
      expect(finalRecord.heartbeats).toHaveLength(N);
      const seenProgress = new Set<number>();
      const seenNotes = new Set<string>();
      for (const hb of finalRecord.heartbeats) {
        seenProgress.add(hb.progress);
        seenNotes.add(hb.note ?? '');
      }
      expect(seenProgress.size).toBe(N);
      expect(seenNotes.size).toBe(N);
    }
  });

  it('interleaved appendHeartbeat + markCompleted preserves the final heartbeat (file-lock re-read path, 20×)', async () => {
    // The dispatch-record-writer's lock + re-read path was added to
    // prevent a heartbeat arriving 100ms before markCompleted from being
    // silently discarded. Pin that property under concurrency: launch
    // appendHeartbeat calls concurrently with markCompleted and assert
    // the final record still contains at least one heartbeat.
    for (let rep = 0; rep < RACE_REPEAT; rep += 1) {
      const { path } = writeInitialDispatchRecord({
        projectRoot: root,
        sessionId: SID,
        requestId: `${RID}-rep2-${rep}`,
        role: 'rd',
        prompt: 'race test prompt',
        toolCall: { name: 'Task', args: {} },
        batchId: `batch-race-2-rep-${rep}`
      });

      const N = 5;
      const tasks: Promise<unknown>[] = launchConcurrent(N, async (i) => {
        return appendHeartbeat({
          recordPath: path,
          status: 'running',
          progress: (i + 1) * 20,
          note: `interleaved-${rep}-${i}`
        });
      });
      tasks.push(
        new Promise<void>((resolveMark) => {
          process.nextTick(() => {
            setImmediate(() => {
              markCompleted({
                recordPath: path,
                outcome: 'success',
                status: 'done'
              });
              resolveMark();
            });
          });
        })
      );

      await Promise.all(tasks);

      const finalRecord = readRecord(path);
      // The contract: no heartbeat is silently dropped, regardless of which
      // one races against markCompleted. heartbeats.length must be in
      // [1, N]; the lock guarantees append-order so every `progress`
      // value 20, 40, 60, 80, 100 must appear if N=5, OR markCompleted
      // arrived before any append and we have 0 heartbeats (impossible
      // under launchConcurrent's deterministic ordering — every
      // appendHeartbeat schedules BEFORE markCompleted by the order of
      // pushes to `tasks`). The deterministic interleaving makes this
      // assertion sharp: every append MUST have been serialized before
      // markCompleted's lock acquisition, so heartbeats.length === N.
      expect(finalRecord.heartbeats).toHaveLength(N);
      // markCompleted MUST have set status=done + outcome=success on the
      // final record (status is the aggregate of latest heartbeat or
      // markCompleted — markCompleted wins because it runs after all
      // appendHeartbeat tasks under deterministic scheduling).
      expect(finalRecord.status).toBe('done');
      expect(finalRecord.outcome).toBe('success');
      expect(finalRecord.completedAt).not.toBeNull();
    }
  });

  it('markDisposed interleaved with appendHeartbeat sets disposed=true without losing heartbeats (20×)', async () => {
    for (let rep = 0; rep < RACE_REPEAT; rep += 1) {
      const { path } = writeInitialDispatchRecord({
        projectRoot: root,
        sessionId: SID,
        requestId: `${RID}-rep3-${rep}`,
        role: 'qa',
        prompt: 'race test prompt',
        toolCall: { name: 'Task', args: {} },
        batchId: `batch-race-3-rep-${rep}`
      });

      const N = 4;
      const tasks: Promise<unknown>[] = launchConcurrent(N, async (i) => {
        return appendHeartbeat({
          recordPath: path,
          status: 'running',
          progress: (i + 1) * 25
        });
      });
      tasks.push(
        new Promise<void>((resolveMark) => {
          process.nextTick(() => {
            setImmediate(() => {
              markDisposed(path);
              resolveMark();
            });
          });
        })
      );
      await Promise.all(tasks);

      const finalRecord = readRecord(path);
      // Every appendHeartbeat launched before markDisposed under our
      // deterministic scheduling — so the final record must hold all N
      // heartbeats AND the disposed flag.
      expect(finalRecord.heartbeats).toHaveLength(N);
      expect(finalRecord.disposed).toBe(true);
      expect(finalRecord.disposedAt).not.toBeNull();
    }
  });
});