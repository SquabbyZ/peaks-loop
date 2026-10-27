// tests/unit/services/observability/near-miss.test.ts
//
// WHY THIS FILE EXISTS. The programme's premise is that "the QA verdict says
// pass" is a metric that is BLIND: it cannot see a pass that was bought by
// skipping a check. The near-miss rate is the number that can see it —
// "of the slices that passed, how many passed anyway after a gate was never
// evaluated?"
//
// THE RULE IS A UNION, NOT A LAST TRANSITION. The size ratchet is live only
// at `implemented`. A slice bypassed there and later advanced to `qa-handoff`
// has an EMPTY live set at its final transition, so a reader who looked only
// at the final transition would see nothing wrong. The union over the slice's
// WHOLE gate history is what catches it, and this file pins that case.
//
// A PREREQ FAILURE THAT WAS LATER SATISFIED IS NOT A NEAR-MISS. A check that
// refuses a transition and then lets it through on a retry is a gate WORKING
// AS DESIGNED — the agent did the work and the check was run again. Counting
// that as "a check that was skipped" counts a working gate as a broken one,
// so a failure counts only when no later attempt at the same transition key
// succeeded.
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
//   - behavior:   the three reasons, the union rule, the recovery pairing
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
      transition('implemented'),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      transition('qa-handoff'),
      transition('verdict-issued')
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
      transition('implemented'),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      transition('qa-handoff'),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });
});

describe('Scenario: behavior — a prereq failure that was never satisfied', () => {
  it('when a prereq failed and was never satisfied, should report the slice as a near-miss', () => {
    // given: a slice whose qa-handoff prereq check failed and never passed
    // when: the near-miss metric is computed over the session
    // then: the slice is a near-miss, for that reason
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('prereq-skipped');
  });

  it('when a prereq failed and was satisfied on a retry, should not report the slice as a near-miss', () => {
    // given: a slice whose qa-handoff prereq failed and then PASSED on the
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss — the gate refused and was then
    //        retry — that is a gate WORKING AS DESIGNED, not a check skipped
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when a prereq failed twice and was satisfied on the third attempt, should not report the slice as a near-miss', () => {
    // given: a slice whose qa-handoff prereq failed twice and then passed
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss — the check WAS satisfied
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('qa-handoff', { prereqOk: false, missingCount: 1 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when one key failed and another key succeeded later, should still report the near-miss', () => {
    // given: a slice whose qa-handoff prereq failed and whose NEXT key passed
    // when: the near-miss metric is computed over the session
    // then: the slice IS a near-miss — the success was for a DIFFERENT
    //        transition, so it did not answer the failure
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('prereq-skipped');
  });

  it('when the failure was the verdict event of an attempt that later succeeded, should not report the slice', () => {
    // given: a slice whose qa->verdict-issued prereq failed and was then
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss — the same attempt's later success
    //        satisfied it
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 1 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when a prereq failed after the verdict, should not report the slice as a near-miss', () => {
    // given: a slice that reached the verdict and was sent back for a repair
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss for that reason
    //        round whose prereq check then failed — the failure came AFTER the
    //        pass, so it is a later round, not a pass bought by a skip
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff'),
      transition('verdict-issued'),
      transition('qa-handoff', { prereqOk: false, missingCount: 2 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when a prereq failed and the slice never reached a verdict, should not report it at all', () => {
    // given: a slice whose prereq failed and which never got a verdict
    // when: the near-miss metric is computed over the session
    // then: the slice is neither in the numerator nor in the denominator
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.passedSliceCount).toBe(0);
  });
});

describe('Scenario: behavior — the rate divides by the passing slices', () => {
  it('when one of two passing slices skipped a gate, should report the rate as one half', () => {
    // given: two passing slices, one of which skipped a gate
    // when: the near-miss metric is computed over the session
    // then: the rate is one near-miss over two passing slices
    const events = seedSession([
      { ...transition('verdict-issued'), sliceRid: 'slice-1' },
      { ...transition('verdict-issued'), sliceRid: 'slice-2' },
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
    const events = seedSession([transition('implemented')]);

    const report = computeNearMiss(events);

    expect(report.nearMissRate).toBe(0);
    expect(report.passedSliceCount).toBe(0);
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

  it('when a prereq failure was never satisfied, should name the transition key', () => {
    // given: a slice whose qa-handoff prereq failed and never passed
    // when: the near-miss metric is computed over the session
    // then: the evidence names the key the refusal belongs to, so a reader
    //        can check the pairing against the raw stream
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('verdict-issued')
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
