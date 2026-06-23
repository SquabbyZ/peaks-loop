import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BATCH_LIMIT, BATCH_OVER_LIMIT_CODE, noteDispatched, readBatchCount, resetBatch } from '../../src/services/dispatch/batch-counter.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-batch-counter-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('batch counter (RL-1 / AC-27)', () => {
  it('returns 0 for an unseen batch', () => {
    expect(readBatchCount(root, 's1', 'b1')).toBe(0);
  });

  it('increments and persists the count', () => {
    noteDispatched(root, 's1', 'b1');
    noteDispatched(root, 's1', 'b1');
    noteDispatched(root, 's1', 'b1');
    expect(readBatchCount(root, 's1', 'b1')).toBe(3);
  });

  it('does not warn under the limit', () => {
    for (let i = 0; i < BATCH_LIMIT; i += 1) {
      const r = noteDispatched(root, 's1', 'b1');
      expect(r.warning).toBeNull();
    }
  });

  it('emits BATCH_OVER_LIMIT warning after exceeding the limit', () => {
    for (let i = 0; i < BATCH_LIMIT + 1; i += 1) {
      noteDispatched(root, 's1', 'b1');
    }
    const r = noteDispatched(root, 's1', 'b1');
    expect(r.warning).not.toBeNull();
    expect(r.warning?.code).toBe(BATCH_OVER_LIMIT_CODE);
    expect(r.warning?.dispatched).toBe(BATCH_LIMIT + 2);
  });

  it('resetBatch removes the counter file', () => {
    noteDispatched(root, 's1', 'b1');
    resetBatch(root, 's1', 'b1');
    expect(readBatchCount(root, 's1', 'b1')).toBe(0);
  });

  // Slice 2026-06-23-audit-4th #A1 + #D3: parallel increments must
  // never lose a write. The pre-fix noteDispatched did read-then-write
  // without a lock; two parallel callers each saw the same N, each
  // wrote N+1, and the second clobbered the first. The lock added
  // in #A1 serializes the read+write inside withFileLockSync so all
  // N increments are visible in the final count.
  it('parallel noteDispatched never loses an increment (no RMW race)', async () => {
    const N = 20;
    const writers: Promise<void>[] = [];
    for (let i = 0; i < N; i += 1) {
      writers.push(
        new Promise<void>((resolveWriter) => {
          // queueMicrotask runs before any I/O so the contention is
          // deterministic — see audit-4th #D1 for why setImmediate
          // is fragile on slow CI.
          queueMicrotask(() => {
            noteDispatched(root, 's1', 'b1');
            resolveWriter();
          });
        })
      );
    }
    await Promise.all(writers);
    // All N increments must survive; pre-fix the count would be ~1.
    expect(readBatchCount(root, 's1', 'b1')).toBe(N);
  });
});
