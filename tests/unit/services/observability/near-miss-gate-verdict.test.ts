// tests/unit/services/observability/near-miss-gate-verdict.test.ts
//
// WHY THIS FILE EXISTS. A gate's verdict is carried by the event that NAMES
// that gate. This file asks what happens when a gate event names a gate or an
// outcome this build cannot read — the case where the verdict exists but
// cannot be used.
//
// THE SCOPE IS THE POINT. An unreadable verdict must not BECOME a finding —
// that is what the previous wave fixed. But it must not ERASE a finding that
// is fully readable either: a `bypass` on a named gate is this module's
// primary evidence of a near-miss, and an unreadable SIBLING event says
// nothing about it. When the scope of the unreadable verdict was the whole
// phase, that sibling erased the bypass and the near-miss count fell to
// zero.
//
// It gets its own file because the question it asks is DIFFERENT from the
// one the metric's other tests ask: the others ask "what did the metric
// find", and this one asks "what did the metric refuse to conclude, and did
// it refuse the right thing".
//
// Dimensions:
//   - behavior:   the scope of an unreadable gate verdict
//   - integration: the metric reading a real metrics file back off disk
//   - a11y:       OMITTED — the module returns a structure; it renders no surface

import { afterEach, describe, expect, it } from 'vitest';

import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import { markdownNearMissSection } from '~/src/services/observability/report-formatter-near-miss.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  cleanupRoots,
  reachingVerdict,
  seedSession,
  toolingGate,
  unknownGateIdGate,
  unknownGateIdToolingGate,
  unknownOutcomeGate
} from './near-miss-fixture.js';

declareDimensions(
  'tests/unit/services/observability/near-miss-gate-verdict.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

afterEach(() => {
  cleanupRoots();
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

  it('when an unknown gate id sits beside a genuine bypass, should still report the bypass', () => {
    // given: a tooling slice whose size ratchet was BYPASSED, alongside a
    //        gate event naming a gate id this build does not know
    // when: the near-miss metric is computed over the session
    // then: the bypass is STILL the finding — each gate's verdict is carried
    //        by its own event, so an unattributable sibling says nothing
    //        about whether the ratchet was bypassed
    const events = seedSession([
      ...reachingVerdict(),
      toolingGate('file-size-ratchet', 'bypass'),
      toolingGate('declared-type-corroboration', 'pass'),
      toolingGate('claim-table', 'pass'),
      unknownGateIdToolingGate('implemented')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when an unknown gate id sits beside a genuine bypass, should match the control without it', () => {
    // given: the same tooling slice, once with the unknown sibling and once
    //        without it
    // when: the near-miss metric is computed over both sessions
    // then: the unknown sibling changes NOTHING — the bypass is the finding
    //        in both, and the unattributable event is reported as
    //        undetermined
    const withSibling = computeNearMiss(
      seedSession([
        ...reachingVerdict(),
        toolingGate('file-size-ratchet', 'bypass'),
        toolingGate('declared-type-corroboration', 'pass'),
        toolingGate('claim-table', 'pass'),
        unknownGateIdToolingGate('implemented')
      ])
    );
    const control = computeNearMiss(
      seedSession([
        ...reachingVerdict(),
        toolingGate('file-size-ratchet', 'bypass'),
        toolingGate('declared-type-corroboration', 'pass'),
        toolingGate('claim-table', 'pass')
      ])
    );

    expect(withSibling.nearMissSliceCount).toBe(control.nearMissSliceCount);
    expect(withSibling.nearMissSliceCount).toBe(1);
    expect(withSibling.undetermined).toHaveLength(1);
    expect(control.undetermined).toHaveLength(0);
  });

  it('when the named gate itself carries an unreadable outcome, should not report it as skipped', () => {
    // given: a slice whose size ratchet carries an outcome this build does
    //        not know
    // when: the near-miss metric is computed over the session
    // then: the ratchet is NOT reported as skipped — its verdict could not
    //        be read, so it is reported as undetermined instead
    const events = seedSession([
      ...reachingVerdict(),
      toolingGate('file-size-ratchet', 'bypass'),
      unknownOutcomeGate('file-size-ratchet', 'implemented')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.undetermined).toHaveLength(1);
    expect(report.undetermined[0]?.kind).toBe('verdict');
  });
});

describe('Scenario: render — the report says what the stream did not decide', () => {
  it('when a gate verdict could not be read, should say the stream did not decide it', () => {
    // given: a slice whose gate event carries an outcome this build does
    //        not know
    // when: the report is rendered
    // then: the report says the gate's LIVENESS OR VERDICT was not decided —
    //        a count that said only "liveness" would misdescribe two of the
    //        three kinds it carries
    const events = seedSession([
      ...reachingVerdict(),
      unknownOutcomeGate('file-size-ratchet', 'implemented')
    ]);

    const markdown = markdownNearMissSection(computeNearMiss(events));

    expect(markdown).toContain('- **undetermined**: 1 gate(s) whose liveness or verdict');
    expect(markdown).toContain('`file-size-ratchet`');
  });
});
