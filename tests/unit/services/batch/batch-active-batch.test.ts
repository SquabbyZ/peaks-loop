// tests/unit/services/batch/batch-active-batch.test.ts
//
// WHICH BATCH is in flight, for a reader that knows only the session.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - a finished batch is not in flight. A presence read that reported a
//     reminder about a batch that already finished would be telling the
//     user about a window that is no longer under that batch's pressure.
//
//   - a record that cannot be read is not a batch in flight. The progress
//     store fails loud on a malformed record, and that is right for the
//     batch's own recovery path; here the question is different, and a
//     corrupt file must not make the presence read speak for a batch
//     nobody can see.
//
// Dimensions covered:
//   - integration: the batch records on disk
//   - behavior:    which of several batches is the one in flight
//   - a11y:        the answer for a session with no batch at all
// Omitted:
//   - render:      the module answers a question, it renders nothing

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findActiveBatch,
  isBatchAtCompactionBoundary,
  listBatchIds,
  resolveBatchCompactionBoundary
} from '../../../../src/services/batch/batch-active-batch.js';
import { writeBatchProgress } from '../../../../src/services/batch/batch-progress-store.js';
import type { BatchPhase } from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-ffffff';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-active-batch-'));
  roots.push(root);
  return root;
}

function writeBatch(root: string, batchId: string, phase: BatchPhase): void {
  writeBatchProgress(root, SESSION_ID, { batchId, phase, items: [] });
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: integration — the batch records on disk are what is read', () => {
  it('when the session holds a running batch, should find it', () => {
    // given: a session with one batch in the diagnosis phase
    const root = makeRoot();
    writeBatch(root, 'b1', 'diagnosis');
    // when: the batch in flight is looked for
    const active = findActiveBatch(root, SESSION_ID);
    // then: it is found, by its id and with its record
    expect(active?.batchId).toBe('b1');
    expect(active?.progress.phase).toBe('diagnosis');
  });

  it('when the session holds no batch, should find none', () => {
    // given: a session with no batch at all
    const root = makeRoot();
    // when: the batch in flight is looked for
    const active = findActiveBatch(root, SESSION_ID);
    // then: there is none
    expect(active).toBeNull();
  });
});

describe('Scenario: behavior — only a running batch counts', () => {
  it('when the batch has finished, should find none', () => {
    // given: a session with a batch that is done
    const root = makeRoot();
    writeBatch(root, 'b1', 'done');
    // when: the batch in flight is looked for
    const active = findActiveBatch(root, SESSION_ID);
    // then: a finished batch is not in flight
    expect(active).toBeNull();
  });

  it('when the session holds several batches, should find the one that is still running', () => {
    // given: a session with a finished batch and a running one
    const root = makeRoot();
    writeBatch(root, 'b-done', 'done');
    writeBatch(root, 'b-running', 'fix');
    // when: the batch in flight is looked for
    const active = findActiveBatch(root, SESSION_ID);
    // then: the running one is found
    expect(active?.batchId).toBe('b-running');
  });

  it('when a record cannot be read, should skip it rather than claim it', () => {
    // given: a session whose only batch record is malformed
    const root = makeRoot();
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'batch', 'b1'), { recursive: true });
    writeFileSync(
      join(root, '.peaks', '_runtime', SESSION_ID, 'batch', 'b1', 'progress.json'),
      '{ "batchId": "b1", "phase": "nonsense", "items": [] }',
      'utf8'
    );
    // when: the batch in flight is looked for
    const active = findActiveBatch(root, SESSION_ID);
    // then: there is none — a record nobody can read is not a batch
    expect(active).toBeNull();
  });
});

describe('Scenario: a11y — the batch ids the session holds are nameable', () => {
  it('when the session holds batches, should list their ids', () => {
    // given: a session with two batches
    const root = makeRoot();
    writeBatch(root, 'b1', 'diagnosis');
    writeBatch(root, 'b2', 'topology');
    // when: the ids are listed
    const ids = listBatchIds(root, SESSION_ID);
    // then: both are named
    expect([...ids].sort()).toEqual(['b1', 'b2']);
  });
});

describe('Scenario: behavior — the batch at a compaction boundary is the one that crossed one', () => {
  it('when the batch has just crossed into the topology stage, should be at a boundary', () => {
    // given: a batch in the stage that follows the diagnosis
    const root = makeRoot();
    writeBatch(root, 'b1', 'topology');
    // when: the boundary signal is read
    // then: the batch is at a boundary
    expect(resolveBatchCompactionBoundary(root, SESSION_ID)).toBe(true);
  });

  it('when the batch is mid-stage, should not be at a boundary', () => {
    // given: a batch still in diagnosis
    const root = makeRoot();
    writeBatch(root, 'b1', 'diagnosis');
    // when: the boundary signal is read
    // then: the batch is mid-stage
    expect(resolveBatchCompactionBoundary(root, SESSION_ID)).toBe(false);
  });

  it('when no batch is in flight, should not be at a boundary', () => {
    // given: a session with no batch
    const root = makeRoot();
    // when: the boundary signal is read
    // then: there is nothing to compact for
    expect(resolveBatchCompactionBoundary(root, SESSION_ID)).toBe(false);
  });

  it('when the record is read directly, should answer the same question', () => {
    // given: a record in the stage that follows the fix
    const root = makeRoot();
    writeBatch(root, 'b1', 'verify');
    const active = findActiveBatch(root, SESSION_ID);
    // when: the record is asked
    // then: it is at a boundary
    expect(active !== null && isBatchAtCompactionBoundary(active.progress)).toBe(true);
  });
});

describe('Scenario: a11y — a session id the reader cannot use is not a crash', () => {
  it('when the session id is not one safe path segment, should list no batches rather than refuse', () => {
    // given: a session id the session directory refuses
    const root = makeRoot();
    // when: the batches are listed
    const ids = listBatchIds(root, './2026-09-15-session-r6-invariant');
    // then: there are none — refusing to LOOK is the answer
    expect(ids).toEqual([]);
  });

  it('when the session id is not one safe path segment, should find no batch rather than refuse', () => {
    // given: a session id the session directory refuses
    const root = makeRoot();
    // when: the batch in flight is looked for
    const active = findActiveBatch(root, './2026-09-15-session-r6-invariant');
    // then: there is none
    expect(active).toBeNull();
  });

  it('when the session id is not one safe path segment, should answer the boundary question without throwing', () => {
    // given: a session id the session directory refuses
    const root = makeRoot();
    // when: the boundary signal is read
    const answer = () => resolveBatchCompactionBoundary(root, './2026-09-15-session-r6-invariant');
    // then: the answer is "not at a boundary" — the compaction path carries on
    expect(answer).not.toThrow();
    expect(answer()).toBe(false);
  });
});
