// tests/unit/services/observability/near-miss.test.ts
//
// WHY THIS FILE EXISTS. The programme's premise is that "the QA verdict says
// pass" is a metric that is BLIND: it cannot see a pass that was bought by
// skipping a check. The near-miss rate is the number that can see it —
// "of the slices that were declared passing, how many passed anyway after a
// required check was still unsatisfied?"
//
// THE REFERENCE MOMENT IS THE SUCCESSFUL PASS. The question is "at the moment
// the slice was declared passing, had the required check been satisfied?" —
// so the reference is the PASS, not the first `verdict-issued` event. A
// `verdict-issued` attempt whose prereq check FAILED is not a pass; it is a
// refused transition recorded under the same `to` state. The pass moment is
// the first `verdict-issued` attempt whose prereq check SUCCEEDED.
//
// THE RULE IS A UNION, NOT A LAST TRANSITION. The size ratchet is live only
// at `implemented`. A slice bypassed there and later advanced to `qa-handoff`
// has an EMPTY live set at its final transition, so a reader who looked only
// at the final transition would see nothing wrong. The union over the slice's
// WHOLE gate history is what catches it.
//
// A CHECK THAT WAS SATISFIED BEFORE THE PASS IS NOT A NEAR-MISS. A key that
// refused and then passed before the slice was declared passing is a gate
// WORKING AS DESIGNED. A key with no successful attempt by the pass moment
// was still unsatisfied when the slice passed, and that IS the finding.
//
// THE STREAM HOLDS TWO EVENTS PER ATTEMPT. One carries the prereq verdict
// (`prereqOk`); the other carries the transition itself and no verdict. The
// attempt IS the verdict event, and the verdict-less one is ignored —
// reading it as an attempt would double-count every attempt.
//
// THE EVENTS ARE READ FROM DISK, NOT HAND-BUILT. The metric reads the same
// JSONL a real session writes, through the same reader, so the shapes under
// test are the shapes on disk.
//
// The report's COVERAGE — what it could and could not observe — has its own
// file, `near-miss-coverage.test.ts`.
//
// Dimensions:
//   - behavior:   the three reasons, the union rule, the pass-moment rule
//   - integration: the metric reading a real metrics file back off disk
//   - render:     the evidence pointers a reader checks the number against
//   - a11y:       OMITTED — the module returns a structure, it renders no surface

import { afterEach, describe, expect, it } from 'vitest';

import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  cleanupRoots,
  gate,
  phaseLessGate,
  reachingVerdict,
  seedSession,
  transition,
  typelessGate,
  unknownGateIdGate,
  unknownOutcomeGate
} from './near-miss-fixture.js';

declareDimensions(
  'tests/unit/services/observability/near-miss.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

afterEach(() => {
  cleanupRoots();
});

describe('Scenario: behavior — a live gate that never got a verdict is a near-miss', () => {
  it('when a gate was bypassed and never evaluated, should report the slice as a near-miss', () => {
    // given: a slice whose size ratchet was bypassed at `implemented`
    // when: the near-miss metric is computed over the session
    // then: the slice is a near-miss, for that gate
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.sliceRid).toBe('slice-1');
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when the live gate was evaluated and passed, should not report the slice as a near-miss', () => {
    // given: a slice whose size ratchet ran and passed
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'pass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.passedSliceCount).toBe(1);
  });

  it('when a live gate has no verdict event at all, should still report the slice as a near-miss', () => {
    // given: a slice whose ONLY gate event is for a different gate — the size
    // when: the near-miss metric is computed over the session
    // then: the unrecorded live gate is still a near-miss
    //        ratchet was live at `implemented` and recorded nothing
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'claim-table', phase: 'implemented', outcome: 'pass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when a gate was live earlier and later evaluated, should not report the slice as a near-miss', () => {
    // given: a slice whose size ratchet was bypassed at `implemented` and
    // when: the near-miss metric is computed over the session
    // then: the gate was evaluated at SOME point, so it is not a near-miss
    //        evaluated at a later phase
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      gate({ gateId: 'file-size-ratchet', phase: 'qa-handoff', outcome: 'pass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
  });
});

describe('Scenario: behavior — a verdict this build cannot read is not a finding', () => {
  it('when the gate event carries an outcome this build does not know, should not report a near-miss', () => {
    // given: a slice that passed cleanly, whose gate event carries an
    //        outcome outside this build's vocabulary
    // when: the near-miss metric is computed over the session
    // then: the slice is NOT a near-miss — an unreadable verdict is not the
    //        same fact as "no verdict" — and the gate is reported as
    //        undetermined instead
    const events = seedSession([
      ...reachingVerdict(),
      unknownOutcomeGate('file-size-ratchet', 'implemented')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.passedSliceCount).toBe(1);
    expect(report.undetermined).toHaveLength(1);
    expect(report.undetermined[0]?.gateId).toBe('file-size-ratchet');
  });

  it('when the gate event names a gate id this build does not know, should not report a near-miss', () => {
    // given: a slice that passed cleanly, whose gate event names a gate this
    //        build's vocabulary does not carry
    // when: the near-miss metric is computed over the session
    // then: the slice is NOT a near-miss — the verdict could not be
    //        attributed to a gate — and the event is reported as undetermined
    const events = seedSession([...reachingVerdict(), unknownGateIdGate('implemented')]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.undetermined).toHaveLength(1);
    expect(report.undetermined[0]?.gateId).toBe('gate-added-upstream');
  });
});

describe('Scenario: behavior — the live set is the union over the slice history', () => {
  it('when a gate was bypassed at an earlier phase, should report the slice as a near-miss', () => {
    // given: a slice bypassed at `implemented` and later advanced to
    // when: the near-miss metric is computed over the session
    // then: the earlier bypass is still a near-miss
    //        `qa-handoff` — the final transition's live set is EMPTY for a
    //        product-typed slice, so only the union sees the skip
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when a gate was bypassed at one phase and evaluated at another, should report the slice as a near-miss', () => {
    // given: a slice whose size ratchet was bypassed at `implemented` and
    // when: the near-miss metric is computed over the session
    // then: the gate is live-and-unevaluated
    //        never evaluated again — the union sees it live once and
    //        unevaluated
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });
});

describe('Scenario: behavior — the reference moment is the successful pass', () => {
  it('when a slice never recorded a successful verdict attempt, should not be in the denominator', () => {
    // given: a slice whose only verdict-issued attempt was REFUSED
    // when: the near-miss metric is computed over the session
    // then: the slice was never declared passing, so it is neither in the
    //        numerator nor in the denominator
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 2 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(0);
    expect(report.nearMissSliceCount).toBe(0);
    expect(report.nearMissRate).toBe(0);
  });

  it('when the first verdict attempt failed and the second succeeded, should use the second as the pass', () => {
    // given: a slice whose first verdict attempt was refused and whose
    // when: the near-miss metric is computed over the session
    // then: the slice IS in the denominator — the second attempt passed
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 2 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
  });

  it('when a key was satisfied before the pass, should not report the slice as a near-miss', () => {
    // given: a slice whose qa-handoff prereq refused and then PASSED before
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss — the gate refused and was then
    //        satisfied, which is a gate WORKING AS DESIGNED
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when a key was still failing at the pass, should report the slice as a near-miss', () => {
    // given: a slice whose qa-handoff prereq refused and was never satisfied
    // when: the near-miss metric is computed over the session
    // then: the slice IS a near-miss — the key was still unsatisfied when
    //        the slice was declared passing
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('prereq-skipped');
    expect(report.records[0]?.unsatisfiedKeys.map((entry) => entry.key)).toContain(
      'rd -> qa-handoff'
    );
  });

  it('when a key was still failing at the pass, should say it was refused', () => {
    // given: a slice whose qa-handoff prereq refused and was never satisfied
    // when: the near-miss metric is computed over the session
    // then: the key's state at the pass moment is `refused` — the check was
    //        running and saying no
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    const entry = report.records[0]?.unsatisfiedKeys.find(
      (item) => item.key === 'rd -> qa-handoff'
    );
    expect(entry?.state).toBe('refused');
    expect(entry?.refusalCount).toBe(1);
  });

  it('when a key had not been attempted at the pass, should say it was unattempted', () => {
    // given: a slice that passed BEFORE its qa-handoff check was ever run
    // when: the near-miss metric is computed over the session
    // then: the key's state at the pass moment is `unattempted` — the owning
    //        role had not tried its transition yet, which is a different
    //        finding from a gate that was firing
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 })
    ]);

    const report = computeNearMiss(events);

    const entry = report.records[0]?.unsatisfiedKeys.find(
      (item) => item.key === 'rd -> qa-handoff'
    );
    expect(entry?.state).toBe('unattempted');
    expect(entry?.refusalCount).toBe(1);
  });

  it('when a key was satisfied only AFTER the pass, should report the slice as a near-miss', () => {
    // given: a slice that passed while its qa-handoff prereq was refusing,
    //        and whose qa-handoff check only passed afterwards
    // when: the near-miss metric is computed over the session
    // then: the slice IS a near-miss — the key was unsatisfied AT THE PASS
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.unsatisfiedKeys.map((entry) => entry.key)).toContain(
      'rd -> qa-handoff'
    );
  });

  it('when one key failed and another key succeeded, should still report the near-miss', () => {
    // given: a slice whose qa-handoff prereq failed and whose verdict passed
    // when: the near-miss metric is computed over the session
    // then: the slice IS a near-miss — the success was for a DIFFERENT
    //        transition, so it did not satisfy the qa-handoff key
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('prereq-skipped');
  });

  it('when a prereq failed after the pass, should not report the slice as a near-miss', () => {
    // given: a slice that passed and was sent back for a repair round whose
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss — the failure came after the pass
    //        and the key HAD been satisfied before it
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 2 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });
});

describe('Scenario: behavior — a gate whose liveness cannot be decided is reported', () => {
  it('when a gate event carries no phase, should report it as undetermined', () => {
    // given: a slice with a gate event that carries NO phase, so the live set
    //        it belonged to cannot be reproduced
    // when: the near-miss metric is computed over the session
    // then: the gate is REPORTED as undetermined — not silently counted as
    //        evaluated and not silently dropped
    const events = seedSession([...reachingVerdict(), phaseLessGate('file-size-ratchet')]);

    const report = computeNearMiss(events);

    expect(report.undetermined.length).toBe(1);
    expect(report.undetermined[0]?.gateId).toBe('file-size-ratchet');
    expect(report.undetermined[0]?.sliceRid).toBe('slice-1');
  });

  it('when a gate event carries no declared type, should not crash the computation', () => {
    // given: a slice with a gate event written BEFORE the type was carried
    // when: the near-miss metric is computed over the session
    // then: the computation completes — the liveness falls back to the
    //        claim-table inference rather than raising
    const events = seedSession([
      ...reachingVerdict(),
      typelessGate('file-size-ratchet', 'implemented')
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.undetermined.length).toBe(0);
  });
});

describe('Scenario: behavior — the rate divides by the passing slices', () => {
  it('when one of two passing slices skipped a gate, should report the rate as one half', () => {
    // given: two passing slices, one of which skipped a gate
    // when: the near-miss metric is computed over the session
    // then: the rate is one near-miss over two passing slices
    const events = seedSession([
      { ...transition('verdict-issued', { prereqOk: true, missingCount: 0 }), sliceRid: 'slice-1' },
      { ...transition('verdict-issued', { prereqOk: true, missingCount: 0 }), sliceRid: 'slice-2' },
      {
        ...gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
        sliceRid: 'slice-1'
      }
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(2);
    expect(report.nearMissSliceCount).toBe(1);
    expect(report.nearMissRate).toBe(0.5);
  });

  it('when no slice passed, should report the rate as zero rather than dividing by zero', () => {
    // given: a session with no passing slice at all
    // when: the near-miss metric is computed over the session
    // then: the rate is zero and the denominator is zero
    const events = seedSession([transition('implemented', { prereqOk: true, missingCount: 0 })]);

    const report = computeNearMiss(events);

    expect(report.nearMissRate).toBe(0);
    expect(report.passedSliceCount).toBe(0);
  });
});

describe('Scenario: integration — the metric reads a real metrics file', () => {
  it('when the session file is read back off disk, should compute the same near-miss', () => {
    // given: a session written to disk with a bypassed gate
    // when: the near-miss metric is computed over the events read from disk
    // then: the file's own content produced the finding
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.records.length).toBe(1);
    expect(report.records[0]?.sliceRid).toBe('slice-1');
  });
});
