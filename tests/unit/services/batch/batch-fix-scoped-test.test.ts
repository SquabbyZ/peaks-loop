// tests/unit/services/batch/batch-fix-scoped-test.test.ts
//
// The fix phase's GATE: an item is fixed only when its own scoped test is
// green, and the test runs BEFORE the status flips.
//
// THE CLAIM IS AN ORDER, NOT A VALUE. The batch's verification phase runs
// once, at the end. When that gate goes red, the question "which item broke
// it?" is answerable only because every item was tested on its own right
// after its own fix. So the scoped test of an item must run while the item
// is still `diagnosed`, and only a green result may turn it into `fixed`.
//
// The scoped test is a fake here: the runner is injected, so no test suite
// is started and no file is written outside the temp directory.
//
// Dimensions covered:
//   - behavior:    the gate itself — green flips the status, red does not,
//                  and a failed fix does not either
//   - integration: the status on disk, and the order the two steps happen in
//   - a11y:        a red test's failure text reaches the caller
// Omitted:
//   - render:      no output is rendered — the record and the result are the
//                  artifacts, and they are asserted as values

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runBatchFix,
  type BatchFixDependencies,
  type BatchFixDiagnosis,
  type BatchFixScopedTest
} from '../../../../src/services/batch/batch-fix.js';
import {
  readBatchProgress,
  writeBatchProgress
} from '../../../../src/services/batch/batch-progress-store.js';
import type { BatchItem } from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-dddddd';
const BATCH_ID = 'b1';
const RID = '2026-10-21-race-batch-mode-t3';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-fix-scope-'));
  roots.push(root);
  return root;
}

function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'i1',
    label: 'bug A',
    status: 'diagnosed',
    files: ['src/a.ts'],
    ...overrides
  };
}

function diagnosis(overrides: Partial<BatchFixDiagnosis> = {}): BatchFixDiagnosis {
  return {
    rootCause: 'the alpha branch returns before the beta write',
    files: ['src/a.ts'],
    riskSurface: 2,
    fixSketch: 'move the beta write above the early return',
    ...overrides
  };
}

/** Seed the record the way the diagnosis phase leaves it. */
function seedRecord(root: string, items: readonly BatchItem[]): void {
  writeBatchProgress(root, SESSION_ID, {
    batchId: BATCH_ID,
    phase: 'topology',
    items
  });
}

/** The status the record carries for one item, read from disk. */
function statusOnDisk(root: string, itemId: string): string | undefined {
  const record = readBatchProgress(root, SESSION_ID, BATCH_ID);
  return record?.items.find((entry) => entry.id === itemId)?.status;
}

/**
 * A scoped-test seam that reports the status the record carried WHILE the
 * test was running, and returns the verdict it was told to return.
 */
function scopedTestSeam(
  root: string,
  verdict: BatchFixScopedTest
): {
  readonly seen: string[];
  readonly asked: string[];
  readonly phases: string[];
  readonly deps: BatchFixDependencies;
} {
  const seen: string[] = [];
  const asked: string[] = [];
  const phases: string[] = [];
  return {
    seen,
    asked,
    phases,
    deps: {
      dispatchFixAgent: () => ({ ok: true, summary: 'fixed the item' }),
      runScopedTest: ({ item: tested }) => {
        asked.push(tested.id);
        seen.push(statusOnDisk(root, tested.id) ?? 'absent');
        phases.push(readBatchProgress(root, SESSION_ID, BATCH_ID)?.phase ?? 'absent');
        return verdict;
      }
    }
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — the scoped test decides whether an item is fixed', () => {
  it("when an item is fixed, should run that item's own scoped test", async () => {
    // given: one diagnosed item
    const root = makeRoot();
    const items = [item({ id: 'i1' }), item({ id: 'i2' })];
    seedRecord(root, items);
    const seam = scopedTestSeam(root, { ok: true, command: 'vitest run scoped' });
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis(), i2: diagnosis({ files: ['src/b.ts'] }) },
        rules: []
      },
      seam.deps
    );
    // then: each item's own scoped test was run
    expect(seam.asked).toEqual(['i1', 'i2']);
  });

  it('when the scoped test is green, should mark the item fixed in the record', async () => {
    // given: one diagnosed item whose scoped test passes
    const root = makeRoot();
    const items = [item()];
    seedRecord(root, items);
    const seam = scopedTestSeam(root, { ok: true, command: 'vitest run scoped' });
    // when: the batch is fixed
    const result = await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      seam.deps
    );
    // then: the item is fixed, on disk and in the result
    expect(statusOnDisk(root, 'i1')).toBe('fixed');
    expect(result.results[0]?.status).toBe('fixed');
  });

  it('when the scoped test is red, should leave the item diagnosed', async () => {
    // given: one diagnosed item whose scoped test fails
    const root = makeRoot();
    const items = [item()];
    seedRecord(root, items);
    const seam = scopedTestSeam(root, {
      ok: false,
      command: 'vitest run scoped',
      detail: '1 test failed'
    });
    // when: the batch is fixed
    const result = await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      seam.deps
    );
    // then: the item is still diagnosed, and the result says so
    expect(statusOnDisk(root, 'i1')).toBe('diagnosed');
    expect(result.results[0]?.status).toBe('diagnosed');
  });

  it('when the scoped test is red, should carry the failure information in the result', async () => {
    // given: one diagnosed item whose scoped test fails with a reason
    const root = makeRoot();
    const items = [item()];
    seedRecord(root, items);
    const seam = scopedTestSeam(root, {
      ok: false,
      command: 'vitest run scoped',
      detail: '1 test failed: expected 3 to be 4'
    });
    // when: the batch is fixed
    const result = await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      seam.deps
    );
    // then: the result carries the command and the failure text
    expect(result.results[0]?.scopedTest.ok).toBe(false);
    expect(result.results[0]?.scopedTest.command).toBe('vitest run scoped');
    expect(result.results[0]?.scopedTest.detail).toContain('expected 3 to be 4');
  });

  it('when the fix agent itself failed, should leave the item diagnosed', async () => {
    // given: a fix agent that reports it could not fix the item
    const root = makeRoot();
    const items = [item()];
    seedRecord(root, items);
    const deps: BatchFixDependencies = {
      dispatchFixAgent: () => ({ ok: false, summary: 'the agent gave up' }),
      runScopedTest: () => ({ ok: true, command: 'vitest run scoped' })
    };
    // when: the batch is fixed
    const result = await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      deps
    );
    // then: the item is not fixed, even though the test would have passed
    expect(statusOnDisk(root, 'i1')).toBe('diagnosed');
    expect(result.results[0]?.status).toBe('diagnosed');
    expect(result.results[0]?.fix.summary).toBe('the agent gave up');
  });
});

describe('Scenario: integration — the scoped test runs before the status flips', () => {
  it('when the scoped test runs, should still see the item as diagnosed in the record', async () => {
    // given: one diagnosed item whose scoped test passes
    const root = makeRoot();
    const items = [item()];
    seedRecord(root, items);
    const seam = scopedTestSeam(root, { ok: true, command: 'vitest run scoped' });
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      seam.deps
    );
    // then: at the moment the test ran, the item was still diagnosed
    expect(seam.seen).toEqual(['diagnosed']);
    // and: it is fixed only afterwards
    expect(statusOnDisk(root, 'i1')).toBe('fixed');
  });

  it('when the fix phase starts, should stamp the record with the fix phase, and end it in verify', async () => {
    // given: a record that the diagnosis phase left in the topology stage
    const root = makeRoot();
    const items = [item()];
    seedRecord(root, items);
    const seam = scopedTestSeam(root, { ok: true, command: 'vitest run scoped' });
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      seam.deps
    );
    // then: WHILE the fix phase ran, the record said the batch was in it
    expect(seam.phases).toEqual(['fix']);
    // and: when it ended, the batch moved on to verification — the ③→④
    // boundary, which is the second place a compaction is cheapest
    const record = readBatchProgress(root, SESSION_ID, BATCH_ID);
    expect(record?.phase).toBe('verify');
  });

  it('when the record already holds an item this call does not know, should keep it', async () => {
    // given: a record holding an item the fix phase was not handed
    const root = makeRoot();
    seedRecord(root, [item({ id: 'i1' }), item({ id: 'i2', label: 'bug B' })]);
    const seam = scopedTestSeam(root, { ok: true, command: 'vitest run scoped' });
    // when: only one of them is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items: [item({ id: 'i1' })],
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      seam.deps
    );
    // then: the other item is still in the record
    const record = readBatchProgress(root, SESSION_ID, BATCH_ID);
    expect(record?.items.map((entry) => entry.id)).toEqual(['i1', 'i2']);
  });
});
