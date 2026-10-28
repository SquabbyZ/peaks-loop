// tests/unit/services/observability/near-miss-unmeasured.test.ts
//
// WHY THIS FILE EXISTS. A slice whose `verdict-issued` attempt records a
// prereq verdict this build CANNOT READ is neither a pass nor a non-pass:
// whether it passed is unknown. Before this was handled, the slice had no
// readable pass moment, so the metric skipped it — and a slice that vanishes
// from the accounting reads as "no passing slices", which is an absence read
// as a result.
//
// It gets its own file because the question it asks is DIFFERENT from the
// one the metric's other tests ask: the others ask "what did the metric
// find", and this one asks "what did the metric NOT measure, and did it say
// so".
//
// THE THREE PLACES THE ANSWER MUST APPEAR. The slice must be reported (a
// reader has to be able to see it), it must be out of the denominator (its
// verdict is unknown, so counting it as a pass would be a guess), and the
// coverage must count it (so the class's population is not silently short).
//
// Dimensions:
//   - behavior:   the unmeasured bucket, the denominator, and the coverage
//   - render:     the reason a reader sees for an unmeasured slice
//   - integration: the metric reading a real metrics file back off disk
//   - a11y:       OMITTED — the module returns a structure; it renders no surface

import { afterEach, describe, expect, it } from 'vitest';

import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import { markdownNearMissSection } from '~/src/services/observability/report-formatter-near-miss.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  cleanupRoots,
  malformedVerdictAttempt,
  reachingVerdict,
  seedSession,
  transition
} from './near-miss-fixture.js';

declareDimensions(
  'tests/unit/services/observability/near-miss-unmeasured.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

afterEach(() => {
  cleanupRoots();
});

describe('Scenario: behavior — a verdict that was RECORDED but cannot be READ', () => {
  it('when the verdict attempt records a prereqOk that is not a boolean, should report the slice as unmeasured', () => {
    // given: a slice whose `verdict-issued` attempt records `prereqOk` as
    //        the STRING "true" — recorded, but not a boolean
    // when: the near-miss metric is computed over the session
    // then: the slice is REPORTED as unmeasured with the reason — it is
    //        neither a pass nor a non-pass, and it must not vanish
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      malformedVerdictAttempt()
    ]);

    const report = computeNearMiss(events);

    expect(report.unmeasured).toHaveLength(1);
    expect(report.unmeasured[0]?.sliceRid).toBe('slice-1');
    expect(report.unmeasured[0]?.reason).toContain('prereqOk');
    expect(report.unmeasured[0]?.reason).toContain('the string "true"');
  });

  it('when the verdict attempt records a prereqOk that is not a boolean, should keep the slice out of the denominator', () => {
    // given: the same slice, with the malformed verdict attempt
    // when: the near-miss metric is computed over the session
    // then: the slice is NOT counted as a pass — its verdict is unknown —
    //        and it is not a near-miss either
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      malformedVerdictAttempt()
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(0);
    expect(report.nearMissSliceCount).toBe(0);
    expect(report.denominator.sliceCount).toBe(0);
    expect(report.denominator.unmeasuredSliceCount).toBe(1);
  });

  it('when the verdict attempt records a prereqOk that is not a boolean, should count it in the coverage', () => {
    // given: the same slice, with the malformed verdict attempt
    // when: the near-miss metric is computed over the session
    // then: the coverage says the slice's verdict could not be READ — the
    //        slice is in neither the observed nor the unobserved count
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      malformedVerdictAttempt()
    ]);

    const report = computeNearMiss(events);

    const prereq = report.coverage.find((item) => item.reason === 'prereq-skipped');
    expect(prereq?.unreadableSliceCount).toBe(1);
    expect(prereq?.observedSliceCount).toBe(0);
    expect(prereq?.unobservedSliceCount).toBe(0);
  });

  it('when the verdict attempt records a boolean, should count the slice as a pass', () => {
    // given: the same slice with a READABLE verdict attempt
    // when: the near-miss metric is computed over the session
    // then: the slice IS a pass — one malformed record is not a rule about
    //        every slice
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.unmeasured).toHaveLength(0);
    expect(report.passedSliceCount).toBe(1);
    expect(report.denominator.unmeasuredSliceCount).toBe(0);
  });

  it('when a malformed verdict attempt comes before the readable one, should report the slice as unmeasured', () => {
    // given: a slice whose FIRST verdict attempt records a prereqOk this
    //        build cannot read, and whose LATER attempt is readable
    // when: the near-miss metric is computed over the session
    // then: the slice is REPORTED as unmeasured — the reference moment is
    //        the FIRST successful verdict attempt, and the earlier one may
    //        have been it
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      malformedVerdictAttempt(),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.unmeasured).toHaveLength(1);
    expect(report.unmeasured[0]?.reason).toContain('pass moment');
  });

  it('when a malformed verdict attempt comes after the readable one, should still count the slice as a pass', () => {
    // given: a slice whose verdict attempt is readable AND a later attempt
    //        whose prereqOk is not a boolean
    // when: the near-miss metric is computed over the session
    // then: the slice IS a pass — the reference moment is the FIRST
    //        successful verdict attempt, and a later record cannot unsettle it
    const events = seedSession([...reachingVerdict(), malformedVerdictAttempt()]);

    const report = computeNearMiss(events);

    expect(report.unmeasured).toHaveLength(0);
    expect(report.passedSliceCount).toBe(1);
  });
});

describe('Scenario: render — the report says which slices it could not measure', () => {
  it('when a slice verdict could not be read, should say so with the reason', () => {
    // given: a slice whose `verdict-issued` attempt records `prereqOk` as
    //        the STRING "true"
    // when: the report is rendered
    // then: the report names the slice, says it is in neither the numerator
    //        nor the denominator, and says what the record actually held
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      malformedVerdictAttempt()
    ]);

    const markdown = markdownNearMissSection(computeNearMiss(events));

    expect(markdown).toContain('- **unmeasured**: 1 slice(s) whose pass verdict could not be READ');
    expect(markdown).toContain('`slice-1`');
    expect(markdown).toContain('the string "true"');
  });
});
