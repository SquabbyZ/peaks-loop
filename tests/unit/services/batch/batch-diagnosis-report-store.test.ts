// tests/unit/services/batch/batch-diagnosis-report-store.test.ts
//
// The diagnosis report's home on disk.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the report lands under the batch's own directory, one file per item,
//     and reads back exactly as it was written. The orchestrator's window
//     depends on the report being somewhere it can be read on demand.
//
//   - the summary read off disk carries the FILE SET. The summary is
//     derived from the stored report every time it is asked for, so the
//     two can never drift apart — and the file set is what the topology
//     stage plans the parallel waves from.
//
// Dimensions covered:
//   - integration: the report on disk (write, read back, summarise)
//   - behavior:    the answers for a batch that has no report
//   - a11y:        the refusals for an id that would escape the directory
// Omitted:
//   - render:      the summary's shape is covered by
//                  `batch-diagnosis-report.test.ts`

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  batchDiagnosisReportPath,
  readBatchDiagnosisReport,
  readBatchDiagnosisSummary,
  writeBatchDiagnosisReport,
  type BatchDiagnosisReportRef
} from '../../../../src/services/batch/batch-diagnosis-report-store.js';
import { writeBatchProgress } from '../../../../src/services/batch/batch-progress-store.js';

const SESSION_ID = '2026-10-21-session-cccccc';
const roots: string[] = [];

/** The current root, plus the report it names. */
let currentRoot = '';

function ref(itemId: string): BatchDiagnosisReportRef {
  return { projectRoot: currentRoot, sessionId: SESSION_ID, batchId: 'b1', itemId };
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-report-'));
  roots.push(root);
  currentRoot = root;
  return root;
}

const REPORT = [
  '**Root cause (根因)**',
  'The marker is never cleared.',
  '',
  '**Expected files (预计文件集)**',
  'src/services/session/session-manager.ts',
  '',
  '**Fix sketch (修复草图)**',
  'Clear the marker when the session ends.'
].join('\n');

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: integration — the report on disk is what the next turn reads', () => {
  it('when a report is written, should land under the batch directory and read back verbatim', () => {
    // given: a batch with one diagnosed item
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, {
      batchId: 'b1',
      phase: 'diagnosis',
      items: [{ id: 'i1', label: 'Login bug', status: 'diagnosed', files: [] }]
    });
    // when: the report is written
    writeBatchDiagnosisReport(ref('i1'), REPORT);
    // then: it is on disk, under batch/<batchId>/diagnosis/<itemId>.md
    const path = batchDiagnosisReportPath(ref('i1'));
    expect(path.replace(/\\/g, '/')).toContain('/batch/b1/diagnosis/i1.md');
    expect(readBatchDiagnosisReport(ref('i1'))).toBe(REPORT);
  });

  it('when the summary is read off disk, should carry the file set the topology stage needs', () => {
    // given: a report on disk
    makeRoot();
    writeBatchDiagnosisReport(ref('i1'), REPORT);
    // when: the summary is read
    const summary = readBatchDiagnosisSummary(ref('i1'));
    // then: it carries the file set and the conclusion
    expect(summary).toContain('src/services/session/session-manager.ts');
    expect(summary).toContain('The marker is never cleared.');
  });

  it('when the summary is read off disk, should name the item by the label the record holds', () => {
    // given: a record that names the item, and a report on disk
    const root = makeRoot();
    writeBatchProgress(root, SESSION_ID, {
      batchId: 'b1',
      phase: 'diagnosis',
      items: [{ id: 'i1', label: 'Login bug', status: 'diagnosed', files: [] }]
    });
    writeBatchDiagnosisReport(ref('i1'), REPORT);
    // when: the summary is read
    const summary = readBatchDiagnosisSummary(ref('i1'));
    // then: the reader can tell which item it is about
    expect(summary).toContain('i1');
    expect(summary).toContain('Login bug');
  });

  it('when a report is written twice, should leave one report, not two', () => {
    // given: a report that was already written
    makeRoot();
    writeBatchDiagnosisReport(ref('i1'), REPORT);
    // when: it is written again with a newer text
    writeBatchDiagnosisReport(ref('i1'), `${REPORT}\n\nmore`);
    // then: the reader sees the newer text
    expect(readBatchDiagnosisReport(ref('i1'))).toContain('more');
  });
});

describe('Scenario: behavior — a batch with no report answers "no report"', () => {
  it('when the item has no report yet, should read as no report rather than as an empty one', () => {
    // given: a batch whose first diagnosis has not reported yet
    makeRoot();
    // when: the report is read
    expect(readBatchDiagnosisReport(ref('i1'))).toBeNull();
    expect(readBatchDiagnosisSummary(ref('i1'))).toBeNull();
  });

  it('when the report is not in the expected shape, should read as no summary rather than as an empty one', () => {
    // given: a report that carries none of the sections
    makeRoot();
    writeBatchDiagnosisReport(ref('i1'), 'I had a look and I am not sure.');
    // when: the summary is read
    const summary = readBatchDiagnosisSummary(ref('i1'));
    // then: there is no summary — the caller must read the report itself
    expect(summary).toBeNull();
  });
});

describe('Scenario: a11y — the refusals say what is wrong', () => {
  it('when the batch id would escape the batch directory, should name the id in the refusal', () => {
    // given: a batch id that is not one safe path segment
    makeRoot();
    // when: the report path is asked for
    const attempt = () => batchDiagnosisReportPath({ ...ref('i1'), batchId: '../escape' });
    // then: the refusal names the id
    expect(attempt).toThrow(/Invalid batch id: \.\.\/escape/);
  });

  it('when the item id would escape the diagnosis directory, should name the id in the refusal', () => {
    // given: an item id that is not one safe path segment
    makeRoot();
    // when: the report path is asked for
    const attempt = () => batchDiagnosisReportPath(ref('../escape'));
    // then: the refusal names the id
    expect(attempt).toThrow(/Invalid item id: \.\.\/escape/);
  });
});
