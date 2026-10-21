// tests/unit/services/code/batch-compaction-point.test.ts
//
// WHEN a batch compacts.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the phase boundary is a compaction point and the ratio alone is not
//     enough to change the thresholds. The thresholds stay where
//     `evaluateCompactTrigger` put them; this module only decides WHERE
//     the compaction happens.
//
//   - nothing is ever deferred. A compaction that waits for the next
//     boundary is a window that fills up while it waits — and a batch's
//     window fills fastest exactly when the reports arrive together.
//
// Dimensions covered:
//   - behavior:    the decision for each zone and each boundary
//   - render:      the decision's shape — the kind, the action, the flag
//   - a11y:        the boundary predicate names what it recognises
// Omitted:
//   - integration: this module is pure — it reads no file and starts no
//                  process
//   - the filesystem half of the batch is covered by
//     `tests/unit/services/batch/batch-progress-store.test.ts`

import { describe, expect, it } from 'vitest';

import {
  decideBatchCompactionPoint,
  isBatchPhaseBoundary
} from '../../../../src/services/code/batch-compaction-point.js';
import { evaluateAutoCompactDecision } from '../../../../src/services/code/auto-compact-decision.js';

describe('Scenario: behavior — below the auto-fire line the batch says and does nothing', () => {
  it('when the ratio is below the auto-fire threshold, should not compact', () => {
    // given: a batch in the middle of a phase, with room to spare
    const point = decideBatchCompactionPoint({
      ratio: 0.5,
      fromPhase: 'diagnosis',
      toPhase: 'diagnosis'
    });
    // then: nothing happens
    expect(point.shouldCompact).toBe(false);
    expect(point.kind).toBe('silent');
  });

  it('when the ratio is in the auto-fire zone away from a boundary, should compact by the existing contract', () => {
    // given: a batch mid-phase with the window three quarters full
    const point = decideBatchCompactionPoint({
      ratio: 0.82,
      fromPhase: 'diagnosis',
      toPhase: 'diagnosis'
    });
    // then: the existing auto-compact contract applies, and it does not ask
    expect(point.kind).toBe('ratio');
    expect(point.shouldCompact).toBe(true);
    expect(point.action).toBe('auto-compact-now');
  });

  it('when the ratio is in the auto-fire zone at a boundary, should compact at the boundary', () => {
    // given: a batch crossing from diagnosis to topology
    const point = decideBatchCompactionPoint({
      ratio: 0.82,
      fromPhase: 'diagnosis',
      toPhase: 'topology'
    });
    // then: the compaction is attributed to the boundary
    expect(point.kind).toBe('phase-boundary');
    expect(point.shouldCompact).toBe(true);
    expect(point.atBoundary).toBe(true);
  });

  it('when the ratio is at the red line, should compact now whatever the phase', () => {
    // given: a batch at the red line, mid-phase
    const midPhase = decideBatchCompactionPoint({
      ratio: 0.96,
      fromPhase: 'fix',
      toPhase: 'fix'
    });
    // and: a batch at the red line, at a boundary
    const atBoundary = decideBatchCompactionPoint({
      ratio: 0.96,
      fromPhase: 'fix',
      toPhase: 'verify'
    });
    // then: both are the red line, and the boundary does not defer it
    expect(midPhase.kind).toBe('red-line');
    expect(midPhase.action).toBe('red-line');
    expect(midPhase.shouldCompact).toBe(true);
    expect(atBoundary.kind).toBe('red-line');
  });

  it('when the mode is partial, should fire at the partial threshold rather than the standard one', () => {
    // given: a ratio that is above the partial auto-fire line only
    const point = decideBatchCompactionPoint({
      ratio: 0.7,
      fromPhase: 'diagnosis',
      toPhase: 'diagnosis',
      mode: 'partial'
    });
    // then: the mode's threshold is the one applied
    expect(point.shouldCompact).toBe(true);
  });
});

describe('Scenario: render — the decision carries what the caller acts on', () => {
  it('when the decision is made, should carry the kind, the action, the ratio and the boundary flag', () => {
    // when: the decision is made
    const point = decideBatchCompactionPoint({
      ratio: 0.82,
      fromPhase: 'diagnosis',
      toPhase: 'topology'
    });
    // then: all four are there
    expect(point.kind).toBe('phase-boundary');
    expect(point.action).toBe('auto-compact-now');
    expect(point.ratio).toBe(0.82);
    expect(point.atBoundary).toBe(true);
  });
});

describe('Scenario: a11y — the boundary predicate names the two boundaries it knows', () => {
  it('when the batch crosses diagnosis into topology, should recognise the boundary', () => {
    expect(isBatchPhaseBoundary('diagnosis', 'topology')).toBe(true);
  });

  it('when the batch crosses fix into verify, should recognise the boundary', () => {
    expect(isBatchPhaseBoundary('fix', 'verify')).toBe(true);
  });

  it('when the batch crosses any other pair of phases, should not call it a boundary', () => {
    expect(isBatchPhaseBoundary('diagnosis', 'fix')).toBe(false);
    expect(isBatchPhaseBoundary('topology', 'fix')).toBe(false);
    expect(isBatchPhaseBoundary('verify', 'done')).toBe(false);
  });
});

describe('Scenario: behavior — the existing compaction decision is untouched without a batch', () => {
  it('when no batch is in flight, should decide exactly as it did before', () => {
    // given: the decision the shared path makes today
    const before = evaluateAutoCompactDecision({ ratio: 0.9, inFlightBatch: false });
    // when: the same decision is made with the boundary signal present
    const after = evaluateAutoCompactDecision({
      ratio: 0.9,
      inFlightBatch: false,
      atPhaseBoundary: true
    });
    // then: nothing changed
    expect(after).toEqual(before);
  });

  it('when a batch is in flight away from a boundary, should still defer', () => {
    // given: a batch in flight, mid-stage
    const decision = evaluateAutoCompactDecision({ ratio: 0.9, inFlightBatch: true });
    // then: the existing deferral stands
    expect(decision.action).toBe('defer');
    expect(decision.shouldCompact).toBe(false);
  });

  it('when a batch is in flight at a phase boundary, should compact now instead of deferring', () => {
    // given: a batch in flight that has just crossed a boundary
    const decision = evaluateAutoCompactDecision({
      ratio: 0.9,
      inFlightBatch: true,
      atPhaseBoundary: true
    });
    // then: the compaction happens — this is the best point
    expect(decision.shouldCompact).toBe(true);
    expect(decision.action).toBe('auto-compact-now');
  });

  it('when the ratio is at the red line, should be the red line whatever the batch does', () => {
    // given: a batch in flight at a boundary, at the red line
    const decision = evaluateAutoCompactDecision({
      ratio: 0.96,
      inFlightBatch: true,
      atPhaseBoundary: true
    });
    // then: the red line is unchanged
    expect(decision.action).toBe('red-line');
  });
});
