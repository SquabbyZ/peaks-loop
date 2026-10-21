// tests/unit/services/batch/batch-diagnosis-summary.test.ts
//
// The bounded summary the orchestrator's window may hold.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the summary carries the FILE SET, because that is the input the
//     topology stage plans the parallel waves from. A summary without it
//     would send the orchestrator back to N full reports.
//
//   - the summary stays inside its byte cap however long the report is,
//     and says what it left out rather than dropping it silently.
//
// Dimensions covered:
//   - behavior:    the summary's budget — what is cut and what survives
//   - render:      the summary's shape — the three lines it must carry
//   - a11y:        what a reader is told when the summary is partial
// Omitted:
//   - integration: this module is pure — the filesystem half is covered by
//                  `batch-diagnosis-report-store.test.ts`

import { describe, expect, it } from 'vitest';

import {
  BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES,
  buildBatchDiagnosisSummary
} from '../../../../src/services/batch/batch-diagnosis-summary.js';

function summaryBytes(summary: string): number {
  return Buffer.byteLength(summary, 'utf8');
}

describe('Scenario: render — the summary carries the three things the window needs', () => {
  it('when the summary is built, should render the conclusion, the file set and the sketch under one heading', () => {
    // given: a finding
    const finding = {
      rootCause: 'The marker is never cleared.',
      files: ['src/services/session/session-manager.ts'],
      sketch: 'Clear the marker when the session ends.'
    };
    // when: the summary is built
    const summary = buildBatchDiagnosisSummary({ id: 'i1', label: 'Login bug', finding });
    // then: the three lines are there, and the file set is one of them
    const lines = summary.trim().split('\n');
    expect(lines[0]).toBe('## i1 · Login bug');
    expect(lines[1]).toContain('结论：');
    expect(lines[2]).toContain('文件集：');
    expect(lines[2]).toContain('src/services/session/session-manager.ts');
    expect(lines[3]).toContain('草图：');
  });

  it('when the summary is built, should stay inside its byte cap', () => {
    // given: a finding
    const finding = {
      rootCause: 'The marker is never cleared.',
      files: ['src/services/session/session-manager.ts'],
      sketch: 'Clear the marker when the session ends.'
    };
    // when: the summary is built
    const summary = buildBatchDiagnosisSummary({ id: 'i1', label: 'Login bug', finding });
    // then: it fits the cap the orchestrator's window allows
    expect(summaryBytes(summary)).toBeLessThanOrEqual(BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES);
  });
});

describe('Scenario: behavior — a long report is cut, not refused', () => {
  it('when the conclusion is very long, should cut it and still stay inside the cap', () => {
    // given: a finding with a very long conclusion
    const finding = {
      rootCause: 'x'.repeat(9000),
      files: ['src/a.ts'],
      sketch: 'y'.repeat(9000)
    };
    // when: the summary is built
    const summary = buildBatchDiagnosisSummary({ id: 'i1', label: 'Long', finding });
    // then: it fits, and the file set survived
    expect(summaryBytes(summary)).toBeLessThanOrEqual(BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES);
    expect(summary).toContain('文件集：src/a.ts');
  });

  it('when the file set alone does not fit, should still stay inside the cap', () => {
    // given: a finding whose file set is far larger than the budget
    const files = Array.from({ length: 400 }, (_, index) => `src/module-${index}/file.ts`);
    // when: the summary is built
    const summary = buildBatchDiagnosisSummary({
      id: 'i1',
      label: 'Wide',
      finding: { rootCause: 'many files', files, sketch: 'touch them all' }
    });
    // then: it fits
    expect(summaryBytes(summary)).toBeLessThanOrEqual(BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES);
  });
});

describe('Scenario: a11y — a partial summary says it is partial', () => {
  it('when the file set does not fit, should say how many paths were left out', () => {
    // given: a finding whose file set is far larger than the budget
    const files = Array.from({ length: 400 }, (_, index) => `src/module-${index}/file.ts`);
    // when: the summary is built
    const summary = buildBatchDiagnosisSummary({
      id: 'i1',
      label: 'Wide',
      finding: { rootCause: 'many files', files, sketch: 'touch them all' }
    });
    // then: the reader is told the file set is partial, rather than being
    // left to believe it is the whole set
    expect(summary).toMatch(/\(\+\d+\)/);
  });
});
