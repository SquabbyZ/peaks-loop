// tests/unit/services/observability/hotspot-groups.test.ts
//
// WHY THIS FILE EXISTS. A hotspot row's count means DIFFERENT THINGS depending on
// how the row was known: an `exact` row counted the artifact being MISSING, and a
// reconstructed row counted the artifact being one of the CANDIDATES. A consumer
// that sees a number has to know which it is, and the GROUP a row is in is what
// says so — the same split the CLI's JSON payload and the markdown report use.
//
// The split is a SHARED function, so the two surfaces cannot disagree about which
// rows are measurements and which are candidates. This file pins that: the split
// is by the row's own `countMeaning`, and no row is lost by it.
//
// Dimensions:
//   - behavior:   the grouping by what each row's count counts
//   - render:     the group names a reader sees
//   - a11y:       OMITTED — the module returns a structure, it renders no surface

import { describe, expect, it } from 'vitest';

import type { RequestType } from '~/src/services/artifacts/artifact-prerequisites.js';
import { groupHotspotsByMeaning } from '~/src/services/observability/hotspot-shared.js';
import { aggregateHotspots } from '~/src/services/observability/hotspots.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  forwardMissing,
  historicalFailure,
  SESSION_A,
  SESSION_B,
  seedSession
} from './hotspot-fixture.js';

declareDimensions(
  'tests/unit/services/observability/hotspot-groups.test.ts',
  ['behavior', 'render'],
  [
    {
      dim: 'integration',
      reason:
        'the grouping is a pure function of the ranking it is given: no file, process or environment is read, so there is nothing to integrate with'
    },
    { dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }
  ]
);

describe('Scenario: behavior — the ranking splits by what each count counts', () => {
  it('when the ranking has both kinds of row, should group them by meaning', () => {
    // given: one measured missing artifact and one candidate row
    // when: the ranking is grouped by what each row's count counts
    // then: the measured row is in the observed group and the candidate row
    //        is in the candidate group — the GROUP NAME says what the
    //        number means, so a consumer cannot misread it
    const type: RequestType = 'feature';
    const measured = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const candidate = seedSession(SESSION_B, [historicalFailure('slice-b', 1)]);
    const requestTypes = new Map([['slice-b', type]]);

    const groups = groupHotspotsByMeaning(
      aggregateHotspots([...measured, ...candidate], requestTypes)
    );

    expect(groups.observedOmissions.length).toBe(1);
    expect(groups.observedOmissions[0]?.countMeaning).toBe('observed-missing');
    expect(groups.candidateMentions.length).toBeGreaterThan(0);
    for (const row of groups.candidateMentions) {
      expect(row.countMeaning).toBe('candidate-mentions');
    }
  });

  it('when every row is a candidate, should leave the observed group empty', () => {
    // given: a ranking with only candidate rows
    // when: the ranking is grouped by what each row's count counts
    // then: the observed group is empty — the split cannot lose a row
    const type: RequestType = 'feature';
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 1)]);
    const requestTypes = new Map([['slice-a', type]]);

    const groups = groupHotspotsByMeaning(aggregateHotspots(events, requestTypes));

    expect(groups.observedOmissions.length).toBe(0);
    expect(groups.candidateMentions.length).toBeGreaterThan(0);
  });

  it('when the ranking is split, should keep every row in exactly one group', () => {
    // given: a ranking with a measured row and a candidate row
    // when: the ranking is grouped by what each row's count counts
    // then: the two groups together hold as many rows as the ranking did —
    //        the split partitions, it does not drop
    const type: RequestType = 'feature';
    const measured = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const candidate = seedSession(SESSION_B, [historicalFailure('slice-b', 1)]);
    const requestTypes = new Map([['slice-b', type]]);

    const rows = aggregateHotspots([...measured, ...candidate], requestTypes);
    const groups = groupHotspotsByMeaning(rows);

    expect(groups.observedOmissions.length + groups.candidateMentions.length).toBe(rows.length);
  });
});
