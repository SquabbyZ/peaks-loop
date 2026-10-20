// tests/unit/services/batch/batch-progress-recovery.test.ts
//
// The claim the whole record exists for: a compaction does not make a batch
// start over.
//
// THE CLAIM, in the form that can fail. A batch diagnoses three items. The
// context is compacted. The resumed batch must find the three items on disk
// and must diagnose ONLY the one still pending — re-diagnosing a diagnosed
// item is the exact waste the record was added to remove, and it is invisible
// without a test that says so.
//
// "From disk, not from context" is load-bearing here: the resumed turn reads
// the record through the store rather than from a value the test kept in a
// variable, so the test fails if the record was never written.
//
// Dimensions covered:
//   - behavior:    which items the recovery rule selects
//   - integration: the resumed turn's view, read back off disk
// Omitted:
//   - render:      no output is rendered — the record is a file
//   - a11y:        no human-facing text is produced by the recovery rule

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { diagnosedItems, pendingItems } from '../../../../src/services/batch/batch-recovery.js';
import {
  appendBatchItem,
  readBatchProgress,
  writeBatchProgress
} from '../../../../src/services/batch/batch-progress-store.js';
import type { BatchItem } from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-bbbbbb';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-recovery-'));
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

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — the recovery rule selects the outstanding items', () => {
  it('when every item is diagnosed, should select none as pending', () => {
    // given: three items, all diagnosed
    const progress = {
      batchId: 'b1',
      phase: 'diagnosis' as const,
      items: [item({ id: 'i1' }), item({ id: 'i2' }), item({ id: 'i3' })]
    };
    // when: the pending items are selected
    const pending = pendingItems(progress);
    // then: none of them needs a diagnosis
    expect(pending).toEqual([]);
  });

  it('when one item is still pending, should select exactly that one', () => {
    // given: three items, one of them still pending
    const progress = {
      batchId: 'b1',
      phase: 'diagnosis' as const,
      items: [item({ id: 'i1' }), item({ id: 'i2', status: 'pending' }), item({ id: 'i3' })]
    };
    // when: the pending items are selected
    const pending = pendingItems(progress);
    // then: only the pending one is selected — the other two are NOT re-diagnosed
    expect(pending.map((entry) => entry.id)).toEqual(['i2']);
  });

  it('when an item is fixed or verified, should not treat it as pending', () => {
    // given: items that have already moved past diagnosis
    const progress = {
      batchId: 'b1',
      phase: 'fix' as const,
      items: [
        item({ id: 'i1', status: 'fixed' }),
        item({ id: 'i2', status: 'verified' }),
        item({ id: 'i3', status: 'diagnosed' })
      ]
    };
    // when: the pending items are selected
    const pending = pendingItems(progress);
    // then: none of them is pending, and all three count as diagnosed
    expect(pending).toEqual([]);
    expect(diagnosedItems(progress).map((entry) => entry.id)).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('Scenario: integration — a resumed batch reads its history off disk', () => {
  it('when three items were diagnosed and the turn was compacted, should recover all three from disk', () => {
    // given: a batch that diagnosed three items, one at a time
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, { batchId: 'b1', phase: 'diagnosis', items: [] });
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i1' }));
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i2' }));
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i3' }));
    // when: the next turn reads the record back — nothing is carried in a variable
    const resumed = readBatchProgress(root, SESSION_ID, 'b1');
    // then: all three items are still there
    expect(resumed?.items).toHaveLength(3);
    expect(resumed?.items.map((entry) => entry.id)).toEqual(['i1', 'i2', 'i3']);
  });

  it('when a batch was compacted after two of three diagnoses, should re-diagnose only the third', () => {
    // given: a batch with two diagnosed items and one still pending
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, { batchId: 'b1', phase: 'diagnosis', items: [] });
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i1' }));
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i2' }));
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i3', status: 'pending' }));
    // when: the next turn reads the record and asks what is outstanding
    const resumed = readBatchProgress(root, SESSION_ID, 'b1');
    const outstanding = resumed === null ? [] : pendingItems(resumed);
    // then: exactly one item is re-diagnosed — the two diagnosed ones are not
    expect(outstanding.map((entry) => entry.id)).toEqual(['i3']);
  });
});
