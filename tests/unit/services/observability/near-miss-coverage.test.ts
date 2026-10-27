// tests/unit/services/observability/near-miss-coverage.test.ts
//
// WHY THIS FILE EXISTS. The near-miss rule has three classes, and each class
// is read from a different kind of event. A scope that holds NONE of a
// class's events cannot produce a finding in that class — and a rate that
// reads as "0 near-misses" when the class was never observable is exactly the
// failure mode this whole programme exists to close: an ABSENCE read as a
// RESULT.
//
// So the report carries, per class: whether the class had events to observe,
// how many there were, how many slices they reached, and the rate the class
// supports. A class with no events has a `null` rate, not a zero.
//
// THIS IS THE CASE THAT MATTERS ON THIS REPOSITORY. The recorded history
// predates the gate emitter, so the `gate-never-evaluated` class has NO
// events at all — and a reader who saw only `nearMissRate: 0` would conclude
// "no near-misses", when the truth is "the bypass class was never measured".
//
// Dimensions:
//   - behavior:   the coverage a class carries, and the rate it supports
//   - render:     the unobserved-class list a consumer reads alongside the rate
//   - integration: the coverage computed from events read back off disk
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
  'tests/unit/services/observability/near-miss-coverage.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

afterEach(() => {
  cleanupRoots();
});

describe('Scenario: behavior — a class with no events is not measurable', () => {
  it('when a class had no events at all, should report it as not observable', () => {
    // given: a session with NO gate events — the gate class was never looked
    // when: the near-miss metric is computed over the session
    // then: the gate class is reported as NOT observable, with no rate
    //        at, so its zero cannot be read as a result
    const events = seedSession([transition('verdict-issued')]);

    const report = computeNearMiss(events);

    const gateClass = report.coverage.find((item) => item.reason === 'gate-never-evaluated');
    expect(gateClass?.observable).toBe(false);
    expect(gateClass?.scopeEventCount).toBe(0);
    expect(gateClass?.rate).toBeNull();
  });

  it('when a class had events, should report it as observable with a rate', () => {
    // given: a session whose prereq checks ran
    // when: the near-miss metric is computed over the session
    // then: the prereq class is observable and carries a rate
    const events = seedSession([
      transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    const prereq = report.coverage.find((item) => item.reason === 'prereq-skipped');
    expect(prereq?.observable).toBe(true);
    expect(prereq?.scopeEventCount).toBe(2);
    expect(prereq?.rate).toBe(0);
  });

  it('when a class reached no passing slice, should report no rate for it', () => {
    // given: a session whose slice never passed, so the class reached no
    //        slice in the denominator
    // when: the near-miss metric is computed over the session
    // then: the class had events but reached no passing slice, so it carries
    //        no rate — a rate over zero slices is not a rate
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      transition('verdict-issued', { prereqOk: false, missingCount: 1 })
    ]);

    const report = computeNearMiss(events);

    const prereq = report.coverage.find((item) => item.reason === 'prereq-skipped');
    expect(prereq?.observable).toBe(true);
    expect(prereq?.observedSliceCount).toBe(0);
    expect(prereq?.rate).toBeNull();
  });

  it('when every class had no events, should report every class as not observable', () => {
    // given: a session whose only event is a verdict-less transition
    // when: the near-miss metric is computed over the session
    // then: no class was measurable, so no class carries a rate
    const events = seedSession([transition('verdict-issued')]);

    const report = computeNearMiss(events);

    for (const item of report.coverage) {
      expect(item.observable).toBe(false);
      expect(item.rate).toBeNull();
    }
  });

  it('when a class reached no passing slice, should report no rate for it', () => {
    // given: a session with gate events on a slice that never reached a verdict
    // when: the near-miss metric is computed over the session
    // then: the gate class had events but reached no passing slice, so it
    //        carries no rate — a rate over zero slices is not a rate
    const events = seedSession([
      transition('implemented'),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    const gateClass = report.coverage.find((item) => item.reason === 'gate-never-evaluated');
    expect(gateClass?.observable).toBe(true);
    expect(gateClass?.observedSliceCount).toBe(0);
    expect(gateClass?.rate).toBeNull();
  });
});

describe('Scenario: render — the report names the classes it could not measure', () => {
  it('when a class had no events, should list it as unobserved', () => {
    // given: a session with no gate events and no tool traces
    // when: the near-miss metric is computed over the session
    // then: the report names both unmeasured classes, so a consumer reading
    //        the rate alone knows the zero is not a result
    const events = seedSession([transition('verdict-issued')]);

    const report = computeNearMiss(events);

    expect(report.unobservedClasses).toContain('gate-never-evaluated');
    expect(report.unobservedClasses).toContain('tool-blocked');
    expect(report.unobservedClasses).toContain('prereq-skipped');
  });

  it('when a class had events, should not list it as unobserved', () => {
    // given: a session with gate events and prereq checks
    // when: the near-miss metric is computed over the session
    // then: those two classes are not in the unobserved list — the
    //        `tool-blocked` one still is, because its event category does
    //        not exist in the schema yet
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'pass' }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    expect(report.unobservedClasses).not.toContain('gate-never-evaluated');
    expect(report.unobservedClasses).not.toContain('prereq-skipped');
    expect(report.unobservedClasses).toContain('tool-blocked');
  });

  it('when the tool-trace category does not exist, should say the class was not measured', () => {
    // given: a session with gate events and prereq checks — everything the
    //        schema can currently record
    // when: the near-miss metric is computed over the session
    // then: the tool-blocked class is still unobserved, because no
    //        tool-trace event can exist yet — and saying so is the point
    const events = seedSession([
      transition('implemented', { prereqOk: true, missingCount: 0 }),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'pass' }),
      transition('verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);

    const report = computeNearMiss(events);

    const toolClass = report.coverage.find((item) => item.reason === 'tool-blocked');
    expect(toolClass?.observable).toBe(false);
    expect(toolClass?.rate).toBeNull();
  });
});

describe('Scenario: integration — the coverage is computed from the events on disk', () => {
  it('when the session file is read back off disk, should count the events it holds', () => {
    // given: a session written to disk with one gate event
    // when: the near-miss metric is computed over the events read from disk
    // then: the coverage counted the file's own gate event
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    const gateClass = report.coverage.find((item) => item.reason === 'gate-never-evaluated');
    expect(gateClass?.scopeEventCount).toBe(1);
    expect(gateClass?.observedSliceCount).toBe(1);
    expect(gateClass?.nearMissSliceCount).toBe(1);
    expect(gateClass?.rate).toBe(1);
  });
});
