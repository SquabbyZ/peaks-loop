// tests/unit/services/batch/batch-context-reminder.test.ts
//
// WHAT the batch says about the context window, and HOW OFTEN.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the sentences STATE. They never ask the user to compact, to run
//     `/compact`, or to manage their own context — the zero-pause
//     contract says the compaction is the system's own action.
//
//   - the batch says it ONCE per phase. A reminder on every turn is the
//     noise the design's open question named, and below the auto-fire
//     line the batch says nothing at all.
//
// The batch's own phase-boundary notice is NOT written here: it belongs to
// the verification stage, and this module consumes it rather than writing
// a rival sentence about the same moment.
//
// Dimensions covered:
//   - behavior:    the sentence per zone, and the once-per-phase rule
//   - integration: the phase read from the batch record, and the record of
//                  what was said
//   - a11y:        the sentence states a fact and instructs nobody
//   - render:      the reminder's shape — the kind and the text
// Omitted:
//   - the carrier that puts the sentence in front of the model is covered
//     by `tests/unit/cli/skill-presence-loop-hygiene.test.ts`

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildContextVerdict } from '../../../../src/cli/commands/core/skill-context-verdict.js';
import {
  BATCH_CONTEXT_RED_LINE_NOTICE,
  buildBatchContextReminder,
  resolveBatchContextReminder
} from '../../../../src/services/batch/batch-context-reminder.js';
import { writeBatchProgress } from '../../../../src/services/batch/batch-progress-store.js';
import type { BatchPhase } from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-dddddd';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-reminder-'));
  roots.push(root);
  return root;
}

function recordPhase(root: string, phase: BatchPhase): void {
  writeBatchProgress(root, SESSION_ID, { batchId: 'b1', phase, items: [] });
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — below the auto-fire line the batch says nothing', () => {
  it('when the ratio is below the auto-fire threshold, should stay silent', () => {
    // given: a batch with room to spare
    const reminder = buildBatchContextReminder({
      ratio: 0.5,
      mode: 'standard',
      atBoundary: false
    });
    // then: there is nothing to say
    expect(reminder).toBeNull();
  });

  it('when the ratio is below the auto-fire threshold at a boundary, should stay silent too', () => {
    // given: a batch crossing a boundary with room to spare
    const reminder = buildBatchContextReminder({
      ratio: 0.5,
      mode: 'standard',
      atBoundary: true,
      boundaryNotice: '诊断完成（2/2）；正在压缩'
    });
    // then: the boundary is not announced either — the compaction did not happen
    expect(reminder).toBeNull();
  });

  it('when the ratio is in the auto-fire zone, should say which zone it is in', () => {
    // given: a batch with the window three quarters full
    const reminder = buildBatchContextReminder({
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    // then: the sentence states the ratio and the zone
    expect(reminder?.kind).toBe('ratio');
    expect(reminder?.text).toContain('82.0%');
    expect(reminder?.text).toContain('自动压缩区');
  });

  it('when the ratio is at the red line, should say what the system is doing', () => {
    // given: a batch at the red line
    const reminder = buildBatchContextReminder({
      ratio: 0.96,
      mode: 'standard',
      atBoundary: false
    });
    // then: the red-line sentence is used
    expect(reminder?.kind).toBe('red-line');
    expect(reminder?.text).toBe(BATCH_CONTEXT_RED_LINE_NOTICE);
  });

  it('when the caller supplies a boundary notice, should use it verbatim rather than write its own', () => {
    // given: a batch crossing a boundary in the auto-fire zone
    const notice = '诊断完成（2/2）；正在压缩 —— 此刻恢复成本最低，进度已落盘';
    const reminder = buildBatchContextReminder({
      ratio: 0.82,
      mode: 'standard',
      atBoundary: true,
      boundaryNotice: notice
    });
    // then: the notice is the sentence
    expect(reminder?.kind).toBe('phase-boundary');
    expect(reminder?.text).toBe(notice);
  });
});

describe('Scenario: behavior — the batch says it once per phase', () => {
  it('when the batch has already spoken in this phase, should stay silent on the next turn', () => {
    // given: a batch in the diagnosis phase that has already spoken
    const root = makeRoot();
    recordPhase(root, 'diagnosis');
    const first = resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    // when: the next turn asks again
    const second = resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.84,
      mode: 'standard',
      atBoundary: false
    });
    // then: the first turn spoke and the second is silent
    expect(first?.kind).toBe('ratio');
    expect(second).toBeNull();
  });

  it('when the batch has crossed into the next phase, should speak again', () => {
    // given: a batch that spoke in the diagnosis phase and moved on
    const root = makeRoot();
    recordPhase(root, 'diagnosis');
    resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    recordPhase(root, 'topology');
    // when: the next phase asks
    const reminder = resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.82,
      mode: 'standard',
      atBoundary: true,
      boundaryNotice: '诊断完成（2/2）；正在压缩 —— 此刻恢复成本最低，进度已落盘'
    });
    // then: the batch speaks once more, at the boundary
    expect(reminder?.kind).toBe('phase-boundary');
  });

  it('when the batch has no record at all, should say nothing', () => {
    // given: a batch that has not been recorded
    const root = makeRoot();
    // when: the reminder is resolved
    const reminder = resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.9,
      mode: 'standard',
      atBoundary: false
    });
    // then: there is no batch to speak for
    expect(reminder).toBeNull();
  });
});

describe('Scenario: integration — the phase comes from the batch record on disk', () => {
  it('when the record says the batch is in the topology phase, should use that phase for the once-per-phase rule', () => {
    // given: a record whose phase is topology, and a batch that already spoke in diagnosis
    const root = makeRoot();
    recordPhase(root, 'diagnosis');
    resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    recordPhase(root, 'topology');
    // when: the batch asks in the new phase
    const reminder = resolveBatchContextReminder({
      projectRoot: root,
      sessionId: SESSION_ID,
      batchId: 'b1',
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    // then: it speaks, because the phase is new
    expect(reminder).not.toBeNull();
  });
});

describe('Scenario: render — the reminder carries the kind and the sentence', () => {
  it('when a reminder is built, should carry exactly the kind and the text', () => {
    // when: a reminder is built
    const reminder = buildBatchContextReminder({
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    // then: it has the two fields the carrier reads
    expect(Object.keys(reminder as unknown as Record<string, unknown>).sort()).toEqual([
      'kind',
      'text'
    ]);
  });
});

describe('Scenario: a11y — the sentence states a fact and instructs nobody', () => {
  it('when a sentence is built, should not ask the user to compact', () => {
    // given: the sentences the batch can say
    const texts = [
      buildBatchContextReminder({ ratio: 0.82, mode: 'standard', atBoundary: false })?.text,
      buildBatchContextReminder({ ratio: 0.96, mode: 'standard', atBoundary: false })?.text
    ];
    // then: none of them hands the step to the user
    for (const text of texts) {
      const lower = (text ?? '').toLowerCase();
      expect(lower).not.toContain('/compact');
      expect(lower).not.toContain('ask the user to compact');
      expect(lower).not.toContain('prompt the user to run');
      expect(lower).not.toContain('user should run');
      expect(text).not.toContain('手动');
      expect(text).not.toContain('建议你');
    }
  });

  it('when the batch reminder is carried by the presence verdict, should reach the model without a new carrier', () => {
    // given: a batch reminder
    const reminder = buildBatchContextReminder({
      ratio: 0.82,
      mode: 'standard',
      atBoundary: false
    });
    // when: it is carried by the verdict every presence read returns
    const verdict = buildContextVerdict(0.82, 'standard', reminder);
    // then: the sentence is in the verdict's actions
    expect(verdict.nextActions.join('\n')).toContain('自动压缩区');
  });
});
