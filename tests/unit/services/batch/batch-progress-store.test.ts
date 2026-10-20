// tests/unit/services/batch/batch-progress-store.test.ts
//
// The store that survives a compaction, and the file-set normalizer the
// parallel-wave check depends on.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the file-set normalizer makes a Windows path and a POSIX path the SAME
//     string. Without that, two items touching one file look disjoint, both
//     are put in the same wave, and two agents edit one file. This is
//     asserted against the actual comparison the wave planner makes, not
//     against the normalizer's return value alone.
//
//   - the record is written per item and read back whole. A batch that wrote
//     its record only at the end would lose everything on a compaction; a
//     batch that wrote it per item keeps the items it had already done.
//
// Dimensions covered:
//   - behavior:    the normalizer's rules and the append/merge semantics
//   - integration: the record on disk (write, read back, resume)
//   - a11y:        the error a caller sees when the record or the id is bad
// Omitted:
//   - render:      no output is rendered — the record is a file, and its
//                  content is the integration dimension's subject

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendBatchItem,
  batchProgressPath,
  normalizeFileSet,
  readBatchProgress,
  writeBatchProgress
} from '../../../../src/services/batch/batch-progress-store.js';
import type {
  BatchItem,
  BatchProgress
} from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-bbbbbb';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-store-'));
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

function progress(overrides: Partial<BatchProgress> = {}): BatchProgress {
  return {
    batchId: 'b1',
    phase: 'diagnosis',
    items: [],
    ...overrides
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — the file-set normalizer makes one file one string', () => {
  it('when the same file is written with a backslash and with a slash, should normalize both to the same value', () => {
    // given: one file measured two ways
    const windows = 'src\\a.ts';
    const posix = 'src/a.ts';
    // when: the set is normalized
    const set = normalizeFileSet([windows, posix]);
    // then: the set holds one file, not two
    expect(set).toEqual(['src/a.ts']);
  });

  it('when a path carries a leading dot-slash, should normalize it to the bare path', () => {
    expect(normalizeFileSet(['./src/a.ts'])).toEqual(['src/a.ts']);
  });

  it('when the set is empty or unordered, should drop the empty entries and sort the rest', () => {
    expect(normalizeFileSet(['src/b.ts', '', 'src/a.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('when two items are compared for overlap, should see one shared file as a shared file', () => {
    // given: two items that touched the SAME file, measured on different platforms
    const left = normalizeFileSet(['src\\services\\a.ts']);
    const right = normalizeFileSet(['src/services/a.ts']);
    // when: the disjointness check runs (exact string equality, as the planner does it)
    const disjoint = left.every((file) => !right.includes(file));
    // then: the two items are NOT disjoint, so they cannot share a wave
    expect(disjoint).toBe(false);
  });
});

describe('Scenario: behavior — appending one item keeps the items already there', () => {
  it('when a second item is appended, should keep the first item in the record', () => {
    // given: a record that already holds one item
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress());
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i1' }));
    // when: another item is appended
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i2', label: 'bug B' }));
    // then: both items are in the record
    const read = readBatchProgress(root, SESSION_ID, 'b1');
    expect(read?.items.map((entry) => entry.id)).toEqual(['i1', 'i2']);
  });

  it('when the same item id is appended again, should replace it rather than add a second row', () => {
    // given: an item that has moved from pending to diagnosed
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress({ items: [item({ status: 'pending' })] }));
    // when: the same item is appended with its new status
    appendBatchItem(root, SESSION_ID, 'b1', item({ status: 'diagnosed' }));
    // then: there is ONE row for that item, carrying the new status
    const read = readBatchProgress(root, SESSION_ID, 'b1');
    expect(read?.items).toHaveLength(1);
    expect(read?.items[0]?.status).toBe('diagnosed');
  });
});

describe('Scenario: integration — the record on disk is what the next turn reads', () => {
  it('when the record is written and read back, should carry the phase that acts as the in-flight signal', () => {
    // given: a batch that has moved to the topology stage
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress({ phase: 'topology' }));
    // when: the next turn reads the record
    const read = readBatchProgress(root, SESSION_ID, 'b1');
    // then: the phase is the one that was written
    expect(read?.phase).toBe('topology');
  });

  it('when items were appended one at a time, should find them all in the record on disk', () => {
    // given: three diagnoses appended one by one
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, progress());
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i1' }));
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i2' }));
    appendBatchItem(root, SESSION_ID, 'b1', item({ id: 'i3' }));
    // when: the file is read off disk directly (not through the reader)
    const raw = JSON.parse(readFileSync(batchProgressPath(root, SESSION_ID, 'b1'), 'utf8')) as {
      items: Array<{ id: string }>;
    };
    // then: all three are there — this is what a compaction must not lose
    expect(raw.items.map((entry) => entry.id)).toEqual(['i1', 'i2', 'i3']);
  });

  it('when the batch has no record yet, should read as no progress rather than as an empty batch', () => {
    const root = makeRoot();
    expect(readBatchProgress(root, SESSION_ID, 'b1')).toBeNull();
  });

  it('when a batch is appended to with no record yet, should create the record', () => {
    // given: a batch whose first diagnosis completes
    const root = makeRoot();
    // when: the item is appended
    appendBatchItem(root, SESSION_ID, 'b1', item());
    // then: the record exists and holds the item
    const read = readBatchProgress(root, SESSION_ID, 'b1');
    expect(read?.items.map((entry) => entry.id)).toEqual(['i1']);
  });

  it('when the record on disk is malformed, should fail loud rather than read as an empty batch', () => {
    // given: a record that is not the shape this module writes
    const root = makeRoot();
    const path = batchProgressPath(root, SESSION_ID, 'b1');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ "batchId": "b1", "phase": "nonsense", "items": [] }', 'utf8');
    // when: it is read
    const read = () => readBatchProgress(root, SESSION_ID, 'b1');
    // then: the refusal names the reason — an empty reading would restart the batch
    expect(read).toThrow(/phase must be one of/);
  });

  it('when the record on disk is not JSON at all, should fail loud', () => {
    const root = makeRoot();
    const path = batchProgressPath(root, SESSION_ID, 'b1');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ "items": [', 'utf8');
    expect(() => readBatchProgress(root, SESSION_ID, 'b1')).toThrow(/Invalid batch progress/);
  });
});

describe('Scenario: a11y — the refusals say what is wrong', () => {
  it('when the batch id would escape the batch directory, should name the id in the refusal', () => {
    const root = makeRoot();
    const attempt = () => readBatchProgress(root, SESSION_ID, '../escape');
    expect(attempt).toThrow(/Invalid batch id: \.\.\/escape/);
  });
});
