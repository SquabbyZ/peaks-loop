// tests/unit/services/batch/batch-diagnosis-finding.test.ts
//
// What a diagnosis report SAYS, read out of the report itself.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the finding is READ from the report, never typed: the file set is a
//     MEASUREMENT, and a guess there puts two agents on one file.
//
//   - the file set is normalized: a Windows path and the same path
//     spelled with forward slashes name one file, and the wave planner
//     compares by exact string equality.
//
// Dimensions covered:
//   - behavior: the parser's rules — the sections, the file set, the sketch
//   - a11y:       the answer for a report that is not in the expected shape
// Omitted:
//   - render:     the parser returns data, not output — the summary's
//                 shape is covered by `batch-diagnosis-summary.test.ts`
//   - integration: this module is pure — the filesystem half is covered by
//                  `batch-diagnosis-report-store.test.ts`

import { describe, expect, it } from 'vitest';

import { parseBatchDiagnosisFinding } from '../../../../src/services/batch/batch-diagnosis-finding.js';

/** A report in the shape the diagnosis prompt asks for. */
const REPORT = [
  '## 诊断报告',
  '',
  '1. **Root cause (根因)** — why the reported symptom happens, in a sentence or two.',
  "   The session marker is never cleared, so the second turn reads the first turn's marker.",
  '',
  '2. **Expected files (预计文件集)**',
  '   - `src/services/session/session-manager.ts`',
  '   src/cli/commands/core/skill-presence-commands.ts',
  '',
  '3. **Risk surface hit (风险面命中)**',
  '   2',
  '',
  '4. **Fix sketch (修复草图)**',
  '   Clear the marker when the session ends, and read it fresh on every presence call.'
].join('\n');

describe('Scenario: behavior — the parser reads the four sections the prompt asks for', () => {
  it('when the report carries the four sections, should read the root cause, the file set and the sketch', () => {
    // when: the report is parsed
    const finding = parseBatchDiagnosisFinding(REPORT);
    // then: the three things the summary is built from are there
    expect(finding?.rootCause).toBe(
      "The session marker is never cleared, so the second turn reads the first turn's marker."
    );
    expect(finding?.sketch).toBe(
      'Clear the marker when the session ends, and read it fresh on every presence call.'
    );
    expect(finding?.files).toHaveLength(2);
  });

  it('when the file set is written with a backslash, should normalize it to the POSIX form', () => {
    // given: a report whose file set was measured on a Windows host
    const windows = [
      '**Root cause (根因)**',
      'The marker is stale.',
      '',
      '**Expected files (预计文件集)**',
      'src\\services\\session\\session-manager.ts'
    ].join('\n');
    // when: it is parsed
    const finding = parseBatchDiagnosisFinding(windows);
    // then: the path is the POSIX spelling the wave planner compares against
    expect(finding?.files).toEqual(['src/services/session/session-manager.ts']);
  });

  it('when the heading repeats the prompt description, should not take the description for the answer', () => {
    // given: a report whose heading carries the prompt's own description
    const echoed = [
      '**Root cause (根因)** — why the reported symptom happens, in a sentence or two.',
      'The marker is stale.',
      '',
      '**Fix sketch (修复草图)**',
      'Clear the marker.'
    ].join('\n');
    // when: it is parsed
    const finding = parseBatchDiagnosisFinding(echoed);
    // then: the answer on the following line is the answer
    expect(finding?.rootCause).toBe('The marker is stale.');
  });

  it('when the risk section follows the file set, should not read the risk number as a file', () => {
    // given: a report whose risk section follows the file set
    // when: it is parsed
    const finding = parseBatchDiagnosisFinding(REPORT);
    // then: the file set holds paths only
    expect(finding?.files.every((file) => file.includes('/'))).toBe(true);
  });
});

describe('Scenario: a11y — a report in another shape says so', () => {
  it('when the report has no section heading at all, should read as no finding rather than as an empty one', () => {
    // given: a report that is not in the expected shape
    const prose = 'I looked at the code and I think the problem is somewhere in the session code.';
    // when: it is parsed
    const finding = parseBatchDiagnosisFinding(prose);
    // then: there is no finding — the caller must read the report itself
    expect(finding).toBeNull();
  });
});
