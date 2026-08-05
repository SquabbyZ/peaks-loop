import { describe, expect, it } from 'vitest';
import {
  assertSignedBySquabbyZ,
  validateBaselineFile,
  validateRowShape
} from '~/src/services/capability-baseline/validator';
import type { CapabilityBaselineFile, CapabilityBaselineRow } from '~/src/services/capability-baseline/types';

function row(j: CapabilityBaselineRow['journeyId']): CapabilityBaselineRow {
  return {
    journeyId: j,
    intent: 'sample',
    observable: { inputs: [], outputs: [], errors: [] },
    invariants: ['inv-1'],
    forbiddenChanges: ['forbid-1'],
    sourceFiles: ['src/sample.ts']
  };
}

function file(rows: ReadonlyArray<CapabilityBaselineRow>): CapabilityBaselineFile {
  return { schemaVersion: '2026-08-03', version: '4.0.8', signedBy: 'SquabbyZ', signedAt: '2026-08-03T00:00:00.000Z', rows };
}

describe("Scenario: capability-baseline/validator", () => {
  it("when invoked, should accepts a row that has all required fields", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(validateRowShape(row('J01')).ok).toBe(true);
  });
  it("when invoked, should rejects a row with empty intent", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = validateRowShape({ ...row('J01'), intent: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_ROW_SHAPE_INVALID');
  });
  it("when invoked, should rejects a row with empty invariants", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = validateRowShape({ ...row('J01'), invariants: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_ROW_SHAPE_INVALID');
  });
  it("when invoked, should rejects a file missing required Jxx ids", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = validateBaselineFile(file([row('J01')]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_INCOMPLETE');
  });
  it("when invoked, should accepts a file containing all 15 P0 rows", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const all = [
      'J01','J02','J03','J04','J05','J06','J07','J08','J09','J10',
      'J11','J12','J13','J14','J15'
    ].map((j) => row(j as CapabilityBaselineRow['journeyId']));
    expect(validateBaselineFile(file(all)).ok).toBe(true);
  });
  it("when invoked, should assertSignedBySquabbyZ rejects anything else", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const bad = { ...file([]), signedBy: 'Claude' as unknown as 'SquabbyZ' };
    const r = assertSignedBySquabbyZ(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_NOT_SIGNED');
  });
});
