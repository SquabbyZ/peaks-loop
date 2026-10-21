// tests/unit/services/batch/batch-phase-advance.test.ts
//
// ONE owner for "the batch changed phase", and the two boundaries it owns.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - BOTH boundaries are reachable. ①→② (diagnosis → topology) and ③→④
//     (fix → verify) each record the notice, and a phase advance that is
//     NOT a boundary records none. A boundary that cannot fire is a
//     compaction point that does not exist.
//
//   - the notice is recorded only when a compaction actually happens. It
//     SAYS a compaction is running, so recording it while the window is
//     still at 40% would be a false fact.
//
// Dimensions covered:
//   - behavior:    the advance per boundary, and the guard that keeps a
//                  non-boundary from recording a notice
//   - integration: the notice in the record on disk
//   - a11y:        the notice's counts, which must not contradict its label
// Omitted:
//   - render:      the notice's wording belongs to the verification stage,
//                  and is covered by its own test

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { advanceBatchPhase } from '../../../../src/services/batch/batch-phase-advance.js';
import { runBatchFix } from '../../../../src/services/batch/batch-fix.js';
import {
  readBatchProgress,
  writeBatchProgress
} from '../../../../src/services/batch/batch-progress-store.js';
import type { BatchItem, BatchPhase } from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-777777';
const RID = 'batch-rid-7';
const roots: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-phase-advance-'));
  roots.push(root);
  return root;
}

function item(id: string, status: BatchItem['status'] = 'diagnosed'): BatchItem {
  return { id, label: `item ${id}`, status, files: [`src/${id}.ts`] };
}

function record(root: string, phase: BatchPhase, items: readonly BatchItem[]): void {
  writeBatchProgress(root, SESSION_ID, { batchId: RID, phase, items });
}

beforeEach(() => {
  process.exitCode = 0;
  savedEnv['CLAUDE_CODE_ENTRYPOINT'] = process.env['CLAUDE_CODE_ENTRYPOINT'];
  savedEnv['CLAUDE_CONTEXT_USAGE_PERCENT'] = process.env['CLAUDE_CONTEXT_USAGE_PERCENT'];
  process.env['CLAUDE_CODE_ENTRYPOINT'] = 'cli';
  process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.82';
});

afterEach(() => {
  process.exitCode = 0;
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Scenario: behavior — both boundaries record the notice', () => {
  it('when the batch crosses from diagnosis to topology, should record the boundary notice', () => {
    // given: a batch in the diagnosis stage
    const root = makeRoot();
    record(root, 'diagnosis', [item('i1'), item('i2')]);
    // when: the phase advances
    const advanced = advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'topology',
      items: [item('i1'), item('i2')]
    });
    // then: the notice is recorded
    expect(advanced.boundaryNotice).toContain('诊断完成');
    expect(advanced.compaction.kind).toBe('phase-boundary');
  });

  it('when the batch crosses from fix to verify, should record the boundary notice', () => {
    // given: a batch in the fix stage
    const root = makeRoot();
    record(root, 'fix', [item('i1', 'fixed'), item('i2', 'fixed')]);
    // when: the phase advances
    const advanced = advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'verify'
    });
    // then: the notice is recorded — the second boundary is reachable
    expect(advanced.boundaryNotice).toContain('诊断完成');
    expect(advanced.compaction.kind).toBe('phase-boundary');
  });

  it('when the phase advances without crossing a boundary, should record no notice', () => {
    // given: a batch in the topology stage
    const root = makeRoot();
    record(root, 'topology', [item('i1')]);
    // when: the phase advances into the fix stage
    const advanced = advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'fix'
    });
    // then: there is no notice — a stage change is not a boundary
    expect(advanced.boundaryNotice).toBeUndefined();
  });

  it('when the batch is already in the phase, should not record the notice again', () => {
    // given: a batch already in the topology stage, with a notice
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, {
      batchId: RID,
      phase: 'topology',
      items: [item('i1')],
      boundaryNotice: 'the earlier notice'
    });
    // when: the phase is advanced to where it already is
    const advanced = advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'topology'
    });
    // then: the earlier notice is kept, and no second one is written
    expect(advanced.boundaryNotice).toBe('the earlier notice');
  });

  it('when the window has room in it, should record no notice', () => {
    // given: a window with room in it
    process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.4';
    const root = makeRoot();
    record(root, 'diagnosis', [item('i1')]);
    // when: the phase advances across the boundary
    const advanced = advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'topology'
    });
    // then: nothing is claimed — no compaction is running
    expect(advanced.boundaryNotice).toBeUndefined();
  });
});

describe('Scenario: integration — the notice is in the record on disk', () => {
  it('when the batch crosses a boundary, should write the notice into the record', () => {
    // given: a batch in the diagnosis stage
    const root = makeRoot();
    record(root, 'diagnosis', [item('i1'), item('i2')]);
    // when: the phase advances
    advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'topology',
      items: [item('i1'), item('i2')]
    });
    // then: the record carries the phase and the notice
    const read = readBatchProgress(root, SESSION_ID, RID);
    expect(read?.phase).toBe('topology');
    expect(read?.boundaryNotice).toContain('诊断完成');
  });

  it('when the fix phase ends, should leave the batch in the verify phase', async () => {
    // given: a batch in the fix stage with one diagnosed item
    const root = makeRoot();
    record(root, 'fix', [item('i1')]);
    // when: the fix phase runs
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: RID,
        rid: RID,
        items: [item('i1')],
        diagnoses: {
          i1: { rootCause: 'the marker is stale', files: ['src/i1.ts'], fixSketch: 'clear it' }
        },
        rules: []
      },
      {
        dispatchFixAgent: () => ({ ok: true, summary: 'fixed' }),
        runScopedTest: () => ({ ok: true, command: 'pnpm test', detail: 'green' })
      }
    );
    // then: the batch is in verification — the ③→④ boundary can fire
    const read = readBatchProgress(root, SESSION_ID, RID);
    expect(read?.phase).toBe('verify');
  });

  it('when the fix phase ends with a red scoped test, should still leave the batch in the verify phase', async () => {
    // given: a batch in the fix stage whose scoped test is red
    const root = makeRoot();
    record(root, 'fix', [item('i1')]);
    // when: the fix phase runs
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: RID,
        rid: RID,
        items: [item('i1')],
        diagnoses: {
          i1: { rootCause: 'the marker is stale', files: ['src/i1.ts'], fixSketch: 'clear it' }
        },
        rules: []
      },
      {
        dispatchFixAgent: () => ({ ok: true, summary: 'fixed' }),
        runScopedTest: () => ({ ok: false, command: 'pnpm test', detail: 'red' })
      }
    );
    // then: the batch is in verification anyway — a red test is the unified
    // gate's to attribute, and the attribution needs the batch to be there
    const read = readBatchProgress(root, SESSION_ID, RID);
    expect(read?.phase).toBe('verify');
  });
});

describe("Scenario: a11y — the notice's counts do not contradict its label", () => {
  it('when the batch crosses a boundary after a red scoped test, should report the diagnosis counts', () => {
    // given: a batch whose diagnosis covered both items
    const root = makeRoot();
    record(root, 'fix', [item('i1', 'diagnosed'), item('i2', 'diagnosed')]);
    // when: the phase advances across the boundary
    const advanced = advanceBatchPhase({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: RID,
      toPhase: 'verify'
    });
    // then: the notice claims the diagnosis finished both of them, which is
    // what happened — not that one of them was fixed
    expect(advanced.boundaryNotice).toContain('2/2');
  });
});
