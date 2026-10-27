// tests/unit/services/observability/near-miss-report.test.ts
//
// WHY THIS FILE EXISTS. The near-miss metric produces two things a reader has to be
// able to check: the DENOMINATOR it divides by, and the EVIDENCE behind each finding.
//
// THE DENOMINATOR IS ITS OWN SUBJECT. 'Passed' has two definitions in this
// repository and they do not count the same slices — the status summary counts a
// slice successful by its FINAL state, the metric counts it passed by a SUCCESSFUL
// 'verdict-issued' attempt. The report states the definition it uses and
// reconciles it with the other one, rather than aligning one to the other by fiat.
//
// THE EVIDENCE IS WHAT MAKES A COUNT CHECKABLE. Each near-miss record names the
// session and the instant of the events it came from, and the transition key a
// prereq refusal belongs to — so a reader can check the pairing against the raw
// stream.
//
// Dimensions:
//   - behavior:   the denominator's definition, size and reconciliation
//   - render:     the evidence pointers a reader checks the number against
//   - integration: the metric reading a real metrics file back off disk
//   - a11y:       OMITTED — the module returns a structure, it renders no surface

import { afterEach, describe, expect, it } from 'vitest';

import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { declaredType } from './hotspot-fixture.js';
import {
  cleanupRoots,
  gate,
  reachingVerdict,
  seedSession,
  transition
} from './near-miss-fixture.js';

declareDimensions(
  'tests/unit/services/observability/near-miss-report.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

afterEach(() => {
  cleanupRoots();
});

describe('Scenario: render — the report states its own denominator', () => {
  it('when the denominator is computed, should state its definition and its size', () => {
    // given: a session with one passing slice
    // when: the near-miss metric is computed over the session
    // then: the report states what "passed" means and how many slices that
    //        definition admits
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.denominator.sliceCount).toBe(1);
    expect(report.denominator.definition).toContain('verdict-issued');
    expect(report.denominator.statusSuccessCount).toBe(1);
  });

  it('when the two definitions of passed disagree, should say so and why', () => {
    // given: a slice the status summary counts successful but that recorded
    //        no successful verdict attempt
    // when: the near-miss metric is computed over the session
    // then: the report states BOTH counts and reconciles them
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 1 })
    ]);

    const report = computeNearMiss(events);

    expect(report.denominator.sliceCount).toBe(0);
    expect(report.denominator.statusSuccessCount).toBe(1);
    expect(report.denominator.difference).not.toBeNull();
    expect(report.denominator.difference?.successWithoutPassMoment).toBe(1);
    expect(report.denominator.difference?.note).toContain('terminal-happy');
  });

  it('when the two definitions agree, should report no difference', () => {
    // given: a session whose one slice both definitions count as passed
    // when: the near-miss metric is computed over the session
    // then: there is no difference to reconcile
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.denominator.difference).toBeNull();
  });

  it('when a slice had no verdict prerequisite row, should name the cause', () => {
    // given: a slice of a request type whose table has no `qa:verdict-issued`
    //        prerequisite row — so the transition had no check to verify
    // when: the near-miss metric is computed over the session
    // then: the note names the TYPE, because the pass was never gated rather
    //        than gated-and-unrecorded
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 1 })
    ]);

    const report = computeNearMiss(events, new Map([['slice-1', declaredType('docs')]]));

    expect(report.denominator.difference?.typesWithoutVerdictPrerequisite).toEqual(['docs']);
    expect(report.denominator.difference?.slicesWithoutVerdictPrerequisite).toEqual(['slice-1']);
    expect(report.denominator.difference?.note).toContain(
      'NO `qa:verdict-issued` prerequisite row'
    );
    expect(report.denominator.difference?.note).toContain('never gated');
  });

  it('when a slice had a verdict prerequisite row, should not blame the type', () => {
    // given: a slice of a request type whose table DOES have a
    //        `qa:verdict-issued` prerequisite row
    // when: the near-miss metric is computed over the session
    // then: the note does not blame the type — the cause is not that one
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 1 })
    ]);

    const report = computeNearMiss(events, new Map([['slice-1', declaredType('feature')]]));

    expect(report.denominator.difference?.typesWithoutVerdictPrerequisite).toEqual([]);
    expect(report.denominator.difference?.note).not.toContain('prerequisite row');
  });
});

describe('Scenario: render — the evidence points at the events the count came from', () => {
  it('when a slice is a near-miss, should carry the session and timestamp of its gate event', () => {
    // given: a slice whose size ratchet was bypassed
    // when: the near-miss metric is computed over the session
    // then: the evidence names the session and the instant of the gate event
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    const evidence = report.records[0]?.evidence ?? [];
    expect(evidence.length).toBeGreaterThan(0);
    for (const pointer of evidence) {
      expect(pointer.sessionId).not.toBe('');
      expect(pointer.ts).not.toBe('');
    }
  });

  it('when a key was unsatisfied at the pass, should name the transition key', () => {
    // given: a slice whose qa-handoff prereq failed and never passed
    // when: the near-miss metric is computed over the session
    // then: the evidence names the key the refusal belongs to, so a reader
    //        can check the pairing against the raw stream
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    const pointer = (report.records[0]?.evidence ?? []).find(
      (item) => item.transitionKey !== undefined
    );
    expect(pointer?.transitionKey).toBe('rd -> qa-handoff');
  });
});
