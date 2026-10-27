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
  reachingVerdict,
  seedSession,
  transition
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
    expect(report.records[0]?.unsatisfiedKeys).toContain('rd -> qa-handoff');
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
    expect(report.records[0]?.unsatisfiedKeys).toContain('rd -> qa-handoff');
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
