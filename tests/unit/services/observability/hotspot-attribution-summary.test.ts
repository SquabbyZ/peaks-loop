// tests/unit/services/observability/hotspot-attribution-summary.test.ts
//
// WHY THIS FILE EXISTS. The ranking answers "which artifact does a skill keep
// failing to deliver"; the attribution summary answers "how much of that rests
// on a fact nobody wrote down". The two are different questions, and the
// second one used to be unanswerable: a request artifact that carried no
// usable `- type:` line was read as if a human had written the type down.
//
// The summary reports the two provenance facts apart — `fromDeclaredType` and
// `fromDefaultedType` — and keeps a THIRD fact apart from both of them:
// `unresolved`, a failure whose request artifact could not be read at all.
// Conflating "nobody wrote the type down" with "the artifact is missing" would
// report a missing file as a missing line.
//
// WHY THE COUNTS ARE PER FAILURE AND NOT PER ROW. One failure fans out into
// many candidate rows, so counting rows would count one failure many times.
// This counts failures.
//
// Dimensions:
//   - behavior:   the confidence split, the provenance split, the unresolved bucket
//   - render:     the summary is the structure a reader consumes
//   - a11y:       OMITTED — the module returns a structure, it renders no surface

import { describe, expect, it } from 'vitest';

import { summarizeAttribution } from '~/src/services/observability/hotspot-attribution-summary.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  declaredType,
  defaultedType,
  forwardMissing,
  historicalFailure,
  prereqPaths,
  SESSION_A,
  SESSION_B,
  seedSession
} from './hotspot-fixture.js';

declareDimensions(
  'tests/unit/services/observability/hotspot-attribution-summary.test.ts',
  ['behavior', 'render'],
  [
    {
      dim: 'integration',
      reason:
        'the summary is a pure function of the events and the readings it is given: no file, process or environment is read, so there is nothing to integrate with'
    },
    { dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }
  ]
);

const NO_ARTIFACTS = { unreadable: 0, withoutTypeLine: 0 };

describe('Scenario: behavior — the summary splits the confidence of the attributions', () => {
  it('when a count matches the whole prerequisite list, should count it inferred', () => {
    // given: a transition whose prereq list holds exactly one entry
    // when: the summary is computed over a failure with a count of one
    // then: the failure is attributed and it is counted inferred
    const type = 'feature' as const;
    const paths = prereqPaths('qa', 'running', type);
    expect(paths).toHaveLength(1);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 1, 'qa', 'running')]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const summary = summarizeAttribution(events, requestTypes, NO_ARTIFACTS);

    expect(summary.attributed).toBe(1);
    expect(summary.inferred).toBe(1);
    expect(summary.ambiguous).toBe(0);
  });

  it('when a count does not localise to one entry, should count it ambiguous', () => {
    // given: a transition whose prereq list holds several entries
    // when: the summary is computed over a failure with a count of one
    // then: the failure is attributed and it is counted ambiguous
    const type = 'feature' as const;
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(1);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 1)]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const summary = summarizeAttribution(events, requestTypes, NO_ARTIFACTS);

    expect(summary.attributed).toBe(1);
    expect(summary.ambiguous).toBe(1);
    expect(summary.inferred).toBe(0);
  });
});

describe('Scenario: behavior — the summary keeps the provenance apart from the confidence', () => {
  it('when a failure rests on a type nobody wrote down, should count it defaulted', () => {
    // given: two failures of the same transition, one whose type was declared
    //        and one whose type nobody wrote down
    // when: the summary is computed over them
    // then: both are attributed, and the PROVENANCE counts split them — the
    //        confidence counts do not change, because the effective type is
    //        the same either way
    const type = 'feature' as const;
    const events = seedSession(SESSION_A, [
      historicalFailure('slice-declared', 1),
      historicalFailure('slice-defaulted', 1)
    ]);
    const requestTypes = new Map([
      ['slice-declared', declaredType(type)],
      ['slice-defaulted', defaultedType(type)]
    ]);

    const summary = summarizeAttribution(events, requestTypes, NO_ARTIFACTS);

    expect(summary.attributed).toBe(2);
    expect(summary.fromDeclaredType).toBe(1);
    expect(summary.fromDefaultedType).toBe(1);
    // The same count against the same list gives the same confidence, so the
    // confidence split cannot answer the provenance question.
    expect(summary.ambiguous).toBe(2);
  });

  it('when a failure has no usable request artifact, should count it unresolved', () => {
    // given: a failure whose slice has no request artifact at all
    // when: the summary is computed over it
    // then: it is UNRESOLVED — a third fact, not a defaulted type and not a
    //        declared one
    const events = seedSession(SESSION_A, [historicalFailure('slice-orphan', 1)]);

    const summary = summarizeAttribution(events, new Map(), NO_ARTIFACTS);

    expect(summary.attributed).toBe(0);
    expect(summary.unresolved).toBe(1);
    expect(summary.fromDeclaredType).toBe(0);
    expect(summary.fromDefaultedType).toBe(0);
  });

  it('when a measured failure is present, should not count it at all', () => {
    // given: a forward event whose missing list was MEASURED
    // when: the summary is computed over it
    // then: it is not an attribution — the retro-attribution never saw it
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const summary = summarizeAttribution(events, new Map(), NO_ARTIFACTS);

    expect(summary.attributed).toBe(0);
    expect(summary.unresolved).toBe(0);
  });
});

describe('Scenario: render — the summary reports the artifact facts beside the failure facts', () => {
  it('when the reader found artifacts, should report them apart from each other', () => {
    // given: a scope whose request artifacts included an unreadable one and
    //        one that carried no usable type line
    // when: the summary is computed over it
    // then: the two counts are reported separately, and neither is folded
    //        into the failure counts
    const events = seedSession(SESSION_B, [historicalFailure('slice-a', 1)]);
    const requestTypes = new Map([['slice-a', declaredType('feature' as const)]]);

    const summary = summarizeAttribution(events, requestTypes, {
      unreadable: 2,
      withoutTypeLine: 5
    });

    expect(summary.artifactsUnreadable).toBe(2);
    expect(summary.artifactsWithoutTypeLine).toBe(5);
    expect(summary.attributed).toBe(1);
  });
});
