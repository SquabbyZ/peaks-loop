// tests/unit/services/observability/session-metric-row-request-types.test.ts
//
// WHY THIS FILE EXISTS. The per-session row is the tracked artifact a later
// run compares against, and it outlives the session that produced it. Two of
// its numbers are only right when the request types are supplied:
//
//   1. the CAUSE of the gap between the two "passed" definitions — the types
//      whose passes were never GATED (their prerequisite table has no
//      `qa:verdict-issued` row, so there was no check to verify against)
//   2. the SIZE of the hotspot ranking — the retro-attribution needs the
//      type to re-derive a transition's prerequisite list, so without it the
//      ranking holds nothing and the count reads as "no hotspot"
//
// The row builder used to compute both WITHOUT the types, so a row written
// today would have named "the prereq verdict was never recorded" instead of
// the cause, and would have counted no hotspot on a history that has some.
//
// Dimensions:
//   behavior:   the row carries the cause, and the ranking it counts
//   integration: a real temp tree, a real metrics file, read back off disk
//   render:     OMITTED - the module publishes a file, it renders no surface
//   a11y:       OMITTED - no operator-facing message originates here

import { afterEach, describe, expect, it } from 'vitest';

import { buildSessionMetricRow } from '~/src/services/observability/session-metric-rows.js';
import {
  SESSION_ID,
  cleanupRoots,
  makeRoot,
  seedEvents,
  transition
} from './session-metric-rows-fixture.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/session-metric-row-request-types.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module publishes a file; it renders no surface' },
    { dim: 'a11y', reason: 'no operator-facing message originates in this module' }
  ]
);

afterEach(() => {
  cleanupRoots();
});

describe('Scenario: behavior — the row is built WITH the request types', () => {
  it('when the request types are supplied, should name the type whose pass was never gated', () => {
    // given: a slice that reached the verdict state without a successful
    //        verdict attempt, and the type of that slice
    // when: the row is built from the events and the request types
    // then: the row names the type whose pass was never GATED, so a reader
    //        is not sent hunting for an emitter bug that does not exist
    const root = makeRoot();
    const events = seedEvents(root, [
      transition('slice-ungated', 'implemented', { prereqOk: true, missingCount: 0 }),
      transition('slice-ungated', 'qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('slice-ungated', 'verdict-issued', { prereqOk: false, missingCount: 1 })
    ]);

    const row = buildSessionMetricRow({
      sessionId: SESSION_ID,
      events,
      requestTypes: new Map([['slice-ungated', { requestType: 'chore', source: 'declared' }]])
    });

    expect(row.typesWithoutVerdictPrerequisite).toEqual(['chore']);
  });

  it('when the request types are missing, should not name a cause it cannot know', () => {
    // given: the same slice, with no request types supplied
    // when: the row is built from the events alone
    // then: no cause is claimed — the row does not guess a type it never read
    const root = makeRoot();
    const events = seedEvents(root, [
      transition('slice-ungated', 'implemented', { prereqOk: true, missingCount: 0 }),
      transition('slice-ungated', 'qa-handoff', { prereqOk: true, missingCount: 0 }),
      transition('slice-ungated', 'verdict-issued', { prereqOk: false, missingCount: 1 })
    ]);

    const row = buildSessionMetricRow({ sessionId: SESSION_ID, events });

    expect(row.typesWithoutVerdictPrerequisite).toEqual([]);
  });

  it('when a historical failure is recorded, should count the rows its type resolves', () => {
    // given: a historical failure the attribution can place, and the type
    //        of the slice it belongs to
    // when: the row is built from the events and the request types
    // then: the ranking holds the attributed row — without the types it
    //        would hold nothing, and the count would read as "no hotspot"
    const root = makeRoot();
    const events = seedEvents(root, [
      transition('slice-old', 'qa-handoff', { prereqOk: false, missingCount: 1 })
    ]);

    const withoutTypes = buildSessionMetricRow({ sessionId: SESSION_ID, events });
    const withTypes = buildSessionMetricRow({
      sessionId: SESSION_ID,
      events,
      requestTypes: new Map([['slice-old', { requestType: 'feature', source: 'declared' }]])
    });

    expect(withoutTypes.hotspotCount).toBe(0);
    expect(withTypes.hotspotCount).toBeGreaterThan(0);
  });
});
