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
});
