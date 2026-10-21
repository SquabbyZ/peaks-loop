// tests/unit/services/batch/batch-verify.test.ts
//
// The unified verification: ONE acceptance gate for the whole batch, and the
// attribution a red gate carries.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is about a string.
//
//   - The gate is the SAME gate the single-task lane runs, and it runs ONCE.
//     The batch mode amortizes N runs into 1; the strictness does not drop by
//     a notch. A constant that lost a leg would be invisible in a diff of the
//     runner and fatal in a batch's release, and a runner that walked the
//     items would turn the whole saving back into N runs — so both the
//     constant and the "once" are pinned.
//
//   - A red unified gate says WHICH kind of breakage it is. A batch whose
//     items each passed their own scoped test, and whose unified gate is red,
//     has an INTEGRATION problem. A batch with an item that never reached a
//     green scoped test has a SINGLE-ITEM problem, and the report names that
//     item. This is only possible because the fix phase runs each item's
//     scoped test immediately after that item's fix; the per-item outcome is
//     the evidence the attribution reads.
//
// The attribution's evidence is the batch's progress record: the fix phase
// appends an item as `fixed` only after that item's scoped test is green, so
// an item's status IS its scoped-test outcome.
//
// Dimensions covered:
//   - behavior:    the gate's composition, its "once", and the attribution rule
//   - render:      the shape of the verification result
//   - integration: the batch record on disk drives the attribution
//   - a11y:        the failing detail names the item; the phase-boundary
//                  notice states what the system is doing and asks the user
//                  for nothing
// Omitted:
//   - none — every dimension applies to this module

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BATCH_ACCEPTANCE_GATE,
  buildPhaseBoundaryNotice,
  runBatchVerification,
  type BatchCheckRunner
} from '../../../../src/services/batch/batch-verify.js';
import { writeBatchProgress } from '../../../../src/services/batch/batch-progress-store.js';
import type {
  BatchItem,
  BatchProgress
} from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-cccccc';
const BATCH_ID = 'b1';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-verify-'));
  roots.push(root);
  return root;
}

function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'i1',
    label: 'bug A',
    status: 'fixed',
    files: ['src/a.ts'],
    ...overrides
  };
}

function progress(overrides: Partial<BatchProgress> = {}): BatchProgress {
  return {
    batchId: BATCH_ID,
    phase: 'verify',
    items: [],
    ...overrides
  };
}

/** A runner whose every leg is green. */
function green(): BatchCheckRunner {
  return () => ({ ok: true, detail: 'passed' });
}

/** A runner whose `tsc` leg is red and whose other legs are green. */
function redOn(check: string): BatchCheckRunner {
  return (name) =>
    name === check ? { ok: false, detail: '1 error found' } : { ok: true, detail: 'passed' };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — the gate is the single-task gate, run once', () => {
  it('when the acceptance gate is read, should run exactly test + tsc + lint', () => {
    // then: the same three legs the single-task lane runs
    expect(BATCH_ACCEPTANCE_GATE).toEqual(['test', 'tsc', 'lint']);
  });

  it('when a batch of three items is verified, should run each gate leg exactly once', () => {
    // given: a batch of three items, all fixed
    const root = makeRoot();
    writeBatchProgress(
      root,
      SESSION_ID,
      progress({
        items: [item({ id: 'i1' }), item({ id: 'i2' }), item({ id: 'i3' })]
      })
    );
    const runs: string[] = [];
    // when: the whole batch is verified
    runBatchVerification(root, SESSION_ID, BATCH_ID, {
      runCheck: (check) => {
        runs.push(check);
        return { ok: true, detail: 'passed' };
      }
    });
    // then: each leg ran once — the count changed, the gate did not
    expect(runs).toEqual(['test', 'tsc', 'lint']);
  });

  it('when every leg is green, should pass the gate and attribute it to integration', () => {
    // given: a batch whose items are all green
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress({ items: [item()] }));
    // when: the batch is verified
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, { runCheck: green() });
    // then: the gate passes, and the batch itself is what passed
    expect(result.gate).toBe('pass');
    expect(result.attribution).toBe('integration');
  });

  it('when a leg is red and every item was green at its own scoped test, should attribute the failure to integration', () => {
    // given: a batch whose items each passed their own scoped test
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress({ items: [item({ status: 'fixed' })] }));
    // when: the unified gate is red
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, {
      runCheck: redOn('tsc')
    });
    // then: the breakage is between the items, not inside one of them
    expect(result.gate).toBe('fail');
    expect(result.attribution).toBe('integration');
  });

  it('when a leg is red and one item never reached a green scoped test, should attribute the failure to that item', () => {
    // given: a batch with one item whose scoped test was red
    const root = makeRoot();
    writeBatchProgress(
      root,
      SESSION_ID,
      progress({
        items: [item({ id: 'i1', status: 'fixed' }), item({ id: 'i2', status: 'diagnosed' })]
      })
    );
    // when: the unified gate is red
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, {
      runCheck: redOn('test')
    });
    // then: one item is at fault, and the attribution says so
    expect(result.gate).toBe('fail');
    expect(result.attribution).toBe('single-item');
  });

  it('when a leg is red and the batch has no record, should say the attribution is unknown', () => {
    // given: a batch with no progress record, so there is no per-item evidence
    const root = makeRoot();
    // when: the unified gate is red
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, {
      runCheck: redOn('lint')
    });
    // then: nothing can be attributed — the answer is unknown, not a guess
    expect(result.gate).toBe('fail');
    expect(result.attribution).toBe('unknown');
  });

  it('when a leg cannot run at all, should block the gate rather than report a failure', () => {
    // given: a leg whose runner throws — the check never produced a verdict
    const root = makeRoot();
    const runCheck: BatchCheckRunner = (check) => {
      if (check === 'tsc') throw new Error('tsc could not be launched');
      return { ok: true, detail: 'passed' };
    };
    // when: the batch is verified
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, { runCheck });
    // then: the gate is blocked, and nothing is attributed
    expect(result.gate).toBe('blocked');
    expect(result.attribution).toBe('unknown');
  });
});

describe('Scenario: render — the result carries one entry per gate leg', () => {
  it('when the verification returns, should carry the three legs with their verdict', () => {
    // given: a batch with a green record
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress({ items: [item()] }));
    // when: the batch is verified
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, { runCheck: green() });
    // then: the shape is one entry per leg, in gate order
    expect(result.checks.map((check) => check.name)).toEqual(['test', 'tsc', 'lint']);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });
});

describe('Scenario: integration — the record on disk drives the attribution', () => {
  it('when the record holds an item that was diagnosed but never fixed, should name that item as the culprit', () => {
    // given: a batch whose second item never reached a green scoped test
    const root = makeRoot();
    writeBatchProgress(
      root,
      SESSION_ID,
      progress({
        items: [
          item({ id: 'i1', label: 'bug A', status: 'fixed' }),
          item({ id: 'i2', label: 'bug B', status: 'diagnosed' })
        ]
      })
    );
    // when: the unified gate is red
    const result = runBatchVerification(root, SESSION_ID, BATCH_ID, {
      runCheck: redOn('test')
    });
    // then: the failing detail names the item, so the fix is not a hunt
    const failing = result.checks.filter((check) => !check.ok);
    expect(failing).toHaveLength(1);
    expect(failing[0]?.detail).toContain('i2');
    expect(failing[0]?.detail).toContain('bug B');
  });
});

describe('Scenario: a11y — the reports say what happened and ask for nothing', () => {
  it('when the phase boundary is reached, should say the system is compacting', () => {
    // when: the notice for a finished diagnosis phase is rendered
    const text = buildPhaseBoundaryNotice({ done: 5, total: 5 });
    // then: it states what the system is doing
    expect(text).toContain('正在压缩');
  });

  it('when the phase boundary notice is rendered, should never hand the compaction step to the user', () => {
    // when: the notice for a finished diagnosis phase is rendered
    const text = buildPhaseBoundaryNotice({ done: 5, total: 5 }).toLowerCase();
    // then: no phrasing routes the step to the user
    expect(text).not.toContain('ask the user');
    expect(text).not.toContain('prompt the user');
    expect(text).not.toContain('user should');
    expect(text).not.toContain('/compact');
  });

  it('when the phase boundary notice is rendered, should carry the context ratio the verdict reports', () => {
    // when: the notice is rendered at the default ratio
    const text = buildPhaseBoundaryNotice({ done: 2, total: 5 });
    // then: the occupancy in the line comes from the shared verdict, not from
    // a second hand-rolled reading of the ratio
    expect(text).toContain('80.0%');
    expect(text).toContain('2/5');
  });
});
