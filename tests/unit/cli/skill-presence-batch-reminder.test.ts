// tests/unit/cli/skill-presence-batch-reminder.test.ts
//
// THE BATCH REMINDER, as the presence read carries it.
//
// This is the test that proves the reminder is not dead code: it drives
// the PRESENCE PATH — the same `contextVerdict` the `peaks skill presence`
// command calls — with a real batch record on disk, and asserts on what
// the presence output carries.
//
// THREE CLAIMS ARE ASSERTED HERE, and none is a structural one:
//
//   - a batch in flight makes the presence output carry the batch
//     sentence. Without this the machinery would be complete and
//     unreachable, and the user would never be told.
//
//   - no batch in flight makes it carry nothing. A reminder about a batch
//     that is not running is a lie about the window.
//
//   - a malformed batch record does not break the presence read. The
//     verdict is advisory and must never be able to break the presence
//     read itself.
//
// Dimensions covered:
//   - integration: the presence read against a real batch record on disk
//   - behavior:    which batch counts as in flight
//   - a11y:        what the presence output carries, and what it does not
// Omitted:
//   - render:      the envelope's own shape is covered by the presence
//                  command's tests
//   - integration of the filesystem: the batch store's own file handling
//     is covered by `tests/unit/services/batch/batch-progress-store.test.ts`

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contextVerdict } from '../../../src/cli/commands/core/skill-context-verdict.js';
import { writeBatchProgress } from '../../../src/services/batch/batch-progress-store.js';
import type { BatchPhase } from '../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-eeeeee';
const roots: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

/** A project with a session bound, and a context ratio the reader reads. */
function makeRoot(ratio: number): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-presence-batch-'));
  roots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: SESSION_ID, projectRoot: root }),
    'utf8'
  );
  process.env['CLAUDE_CODE_ENTRYPOINT'] = 'cli';
  process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = String(ratio);
  return root;
}

/** A batch record in the given phase. */
function writeBatch(root: string, batchId: string, phase: BatchPhase): void {
  writeBatchProgress(root, SESSION_ID, {
    batchId,
    phase,
    items: [{ id: 'i1', label: 'Login bug', status: 'diagnosed', files: ['src/a.ts'] }]
  });
}

beforeEach(() => {
  savedEnv['CLAUDE_CODE_ENTRYPOINT'] = process.env['CLAUDE_CODE_ENTRYPOINT'];
  savedEnv['CLAUDE_CONTEXT_USAGE_PERCENT'] = process.env['CLAUDE_CONTEXT_USAGE_PERCENT'];
});

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Scenario: integration — the presence read carries the batch reminder', () => {
  it('when a batch is in flight and the window is in the auto-fire zone, should carry the batch sentence', () => {
    // given: a project whose window is at 82%, with a batch in flight
    const root = makeRoot(0.82);
    writeBatch(root, 'b1', 'diagnosis');
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: the batch sentence rides out with the verdict
    expect(verdict.nextActions.join('\n')).toContain('自动压缩区');
    expect(verdict.context?.ratioPct).toBe('82.0%');
  });

  it('when no batch is in flight, should carry no batch sentence', () => {
    // given: a project whose window is at 82%, with no batch at all
    const root = makeRoot(0.82);
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: the zone instruction is there, and no batch sentence is
    expect(verdict.nextActions.join('\n')).not.toContain('自动压缩区');
    expect(verdict.nextActions.join('\n')).toContain('peaks code auto-compact');
  });

  it('when the batch has finished, should carry no batch sentence', () => {
    // given: a project whose window is at 82%, with a batch that is done
    const root = makeRoot(0.82);
    writeBatch(root, 'b1', 'done');
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: a finished batch is not a batch in flight
    expect(verdict.nextActions.join('\n')).not.toContain('自动压缩区');
  });

  it('when the batch record is malformed, should still answer the presence read', () => {
    // given: a project whose batch record is not the shape the store writes
    const root = makeRoot(0.82);
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'batch', 'b1'), { recursive: true });
    writeFileSync(
      join(root, '.peaks', '_runtime', SESSION_ID, 'batch', 'b1', 'progress.json'),
      '{ "batchId": "b1", "phase": "nonsense", "items": [] }',
      'utf8'
    );
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: the read still answers, with its ratio, and without a reminder
    // about a batch nobody can read
    expect(verdict.context?.ratioPct).toBe('82.0%');
    expect(verdict.nextActions.join('\n')).not.toContain('自动压缩区');
  });

  it('when the presence read runs twice in the same phase, should carry the sentence once', () => {
    // given: a project whose window is at 82%, with a batch in flight
    const root = makeRoot(0.82);
    writeBatch(root, 'b1', 'diagnosis');
    // when: the presence read happens twice
    const first = contextVerdict(root);
    const second = contextVerdict(root);
    // then: the batch said it once, not once per turn
    expect(first.nextActions.join('\n')).toContain('自动压缩区');
    expect(second.nextActions.join('\n')).not.toContain('自动压缩区');
  });

  it('when the batch crosses a boundary, should carry the notice the batch recorded for it', () => {
    // given: a batch in the diagnosis phase, seen once
    const root = makeRoot(0.82);
    writeBatch(root, 'b1', 'diagnosis');
    contextVerdict(root);
    // and: the batch crosses into the topology phase, recording the
    // notice its own verification stage wrote for that moment
    const notice = '诊断完成（2/2 项）；正在压缩 —— 恢复成本最低的时点，进度已落盘';
    writeBatchProgress(root, SESSION_ID, {
      batchId: 'b1',
      phase: 'topology',
      items: [{ id: 'i1', label: 'Login bug', status: 'diagnosed', files: ['src/a.ts'] }],
      boundaryNotice: notice
    });
    // when: the presence read happens after the crossing
    const verdict = contextVerdict(root);
    // then: the notice the batch recorded is what the user is told
    expect(verdict.nextActions.join('\n')).toContain(notice);
  });
});

describe('Scenario: behavior — the reminder follows the window', () => {
  it('when the window is below the auto-fire line, should carry no batch sentence', () => {
    // given: a project whose window is at 50%, with a batch in flight
    const root = makeRoot(0.5);
    writeBatch(root, 'b1', 'diagnosis');
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: the batch says nothing at all
    expect(verdict.nextActions).toEqual([]);
  });

  it('when the window is at the red line, should carry the red-line sentence', () => {
    // given: a project whose window is at 96%, with a batch in flight
    const root = makeRoot(0.96);
    writeBatch(root, 'b1', 'diagnosis');
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: the batch says the red line, and asks for nothing
    expect(verdict.nextActions.join('\n')).toContain('已请求 harness 压缩');
  });
});

describe('Scenario: a11y — the sentence reaches the user without asking for anything', () => {
  it('when the batch sentence is carried, should not hand the compaction to the user', () => {
    // given: a project whose window is at 82%, with a batch in flight
    const root = makeRoot(0.82);
    writeBatch(root, 'b1', 'diagnosis');
    // when: the presence read happens
    const verdict = contextVerdict(root);
    // then: the batch sentence asks nobody to do anything
    const batchSentence = verdict.nextActions.find((line) => line.includes('自动压缩区')) ?? '';
    expect(batchSentence).not.toContain('/compact');
    expect(batchSentence).not.toContain('手动');
    expect(batchSentence).not.toContain('建议你');
  });
});
