// tests/unit/services/observability/hotspots.test.ts
//
// WHY THIS FILE EXISTS. The programme needs to name the artifact a skill
// keeps failing to deliver, and the owner of it — so a reader can go and
// fix THAT skill rather than guess. The spec (§2.2 S2.2) calls this the
// hotspot ranking; the gate it feeds (§2.4) says the ranking must be able
// to point at a real SKILL.md.
//
// THE RANKING HAS TWO SOURCES AND THEY MUST NOT BE CONFLATED.
//   - a FORWARD event (v2) carries the missing list as it was measured:
//     `exact`, and the mode (`absent` / `body`) is known.
//   - a HISTORICAL event (v1) carries only a count. The artifact is then a
//     CANDIDATE, and the confidence says so: `inferred` when the count
//     matches the whole prerequisite list, `ambiguous` when it does not.
//     A reader must be able to tell the two apart, which is why the
//     confidence is a COLUMN and not a footnote.
//
// THE RANKING MUST NOT DROP A ROW. An artifact whose directory the owner
// map does not know still gets a row, with a null owner: a newly introduced
// artifact type has to be VISIBLE, and a mapping that silently swallowed it
// is how a whole class of failures stops being counted.
//
// THE EVENTS ARE READ FROM DISK, NOT HAND-BUILT. The metric reads the same
// JSONL a real session writes, through the same reader, so the shapes under
// test are the shapes on disk.
//
// Dimensions:
//   - behavior:   the grouping key, the ranking, the two sources, the null owner
//   - integration: the metric reading a real metrics file back off disk
//   - render:     the row's evidence and timestamps, as a reader sees them
//   - a11y:       OMITTED — the module returns a structure, it renders no surface

import { afterEach, describe, expect, it } from 'vitest';

import type { RequestType } from '~/src/services/artifacts/artifact-prerequisites.js';
import { aggregateHotspots } from '~/src/services/observability/hotspots.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  cleanupRoots,
  declaredType,
  forwardMissing,
  historicalFailure,
  prereqPaths,
  SESSION_A,
  SESSION_B,
  seedSession
} from './hotspot-fixture.js';

declareDimensions(
  'tests/unit/services/observability/hotspots.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

afterEach(() => {
  cleanupRoots();
});

describe('Scenario: behavior — the same artifact counts once per occurrence', () => {
  it('when two sessions miss the same artifact, should count them in one row', () => {
    // given: two sessions, each missing the same artifact under its own rid
    // when: the ranking is computed over both sessions
    // then: one row carries the count of two and the two sessions
    const eventsA = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const eventsB = seedSession(SESSION_B, [
      forwardMissing('slice-b', [
        { path: 'rd/code-review-slice-b.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots([...eventsA, ...eventsB]);

    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.sessions).toBe(2);
  });

  it('when the owner of the artifact is the one the event recorded, should carry it', () => {
    // given: an event whose missing list names the owning skill
    // when: the ranking is computed over that session
    // then: the row names that skill
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'audit/security-slice-a.md', kind: 'absent', ownerSkill: 'peaks-security-audit' }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows[0]?.ownerSkill).toBe('peaks-security-audit');
  });

  it('when the artifact has no known owner, should still produce a row with no owner', () => {
    // given: an event missing an artifact in a directory the owner map does not know
    // when: the ranking is computed over that session
    // then: the row is present and says the owner is unknown
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'unmapped/thing-slice-a.md', kind: 'absent', ownerSkill: null }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows.length).toBe(1);
    expect(rows[0]?.ownerSkill).toBeNull();
  });

  it('when the artifact has no owner because it is an ownerless shape, should carry the reason', () => {
    // given: an event missing the unreadable-capsule shape, which no skill
    //        produces
    // when: the ranking is computed over that session
    // then: the row says WHY it has no owner — "no owner" reaches the reader
    //        as a stated fact, not as a gap
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'gateEvidence(frontmatter-malformed)', kind: 'absent', ownerSkill: null }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows.length).toBe(1);
    expect(rows[0]?.ownerSkill).toBeNull();
    expect(rows[0]?.ownerReason).toContain('capsule');
  });

  it('when the artifact has an owner, should carry no reason for having none', () => {
    // given: an event missing an artifact an owning skill produces
    // when: the ranking is computed over that session
    // then: the row carries no ownerless reason — the reason belongs to a row
    //        that has no owner
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows[0]?.ownerReason).toBeNull();
  });

  it('when the artifact is missing in two modes, should keep the modes apart', () => {
    // given: one event missing the same artifact in two modes
    // when: the ranking is computed over that session
    // then: the two modes are two rows, each counting one
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' },
        { path: 'rd/code-review-slice-a.md', kind: 'body', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows.length).toBe(2);
    expect(rows.map((row) => row.kind).sort()).toEqual(['absent', 'body']);
  });
});

describe('Scenario: behavior — the artifact is named by its template', () => {
  it('when the artifact path carries the rid placeholder, should keep it in the name', () => {
    // given: a historical failure whose candidate list is the table's templates
    // when: the ranking is computed over that session
    // then: the templates that carry a rid slot still name it, so the name
    //        still names a real file rather than an empty segment
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    const withSlot = paths.filter((path) => path.includes('<rid>'));
    expect(withSlot.length).toBeGreaterThan(0);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 3)]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const rows = aggregateHotspots(events, requestTypes);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(paths).toContain(row.artifact);
      if (withSlot.includes(row.artifact)) expect(row.artifact).toContain('<rid>');
    }
  });

  it('when the same artifact is missed under two rids, should land on one row', () => {
    // given: two sessions, each missing the same artifact under its own rid
    // when: the ranking is computed over both sessions
    // then: the two rid-specific paths are one artifact
    const eventsA = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const eventsB = seedSession(SESSION_B, [
      forwardMissing('slice-b', [
        { path: 'rd/code-review-slice-b.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots([...eventsA, ...eventsB]);

    expect(rows.length).toBe(1);
    expect(rows[0]?.artifact).not.toContain('slice-a');
    expect(rows[0]?.artifact).not.toContain('slice-b');
  });
});

describe('Scenario: behavior — the confidence says which source a row came from', () => {
  it('when the missing list was measured, should mark the row exact', () => {
    // given: a forward event whose missing list was measured
    // when: the ranking is computed over that session
    // then: the row says it was measured
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows[0]?.confidence).toBe('exact');
  });

  it('when the count matches the whole prerequisite list, should mark the row inferred', () => {
    // given: a historical failure whose count matches the prerequisite list
    // when: the ranking is computed over that session
    // then: the row says the whole list was inferred missing
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(0);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', paths.length)]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const rows = aggregateHotspots(events, requestTypes);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.confidence).toBe('inferred');
  });

  it('when the count does not match the prerequisite list, should mark the row ambiguous', () => {
    // given: a historical failure whose count does not match the list
    // when: the ranking is computed over that session
    // then: the row says the artifact is only a candidate
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(1);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 1)]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const rows = aggregateHotspots(events, requestTypes);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.confidence).toBe('ambiguous');
  });
});

describe('Scenario: behavior — the ranking is ordered by count, then by confidence', () => {
  it('when two rows have the same count, should put the measured one first', () => {
    // given: one measured row and one candidate row, each counting once
    // when: the ranking is computed over both sessions
    // then: the measured row is ahead of the candidate rows
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(1);
    const measured = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const candidate = seedSession(SESSION_B, [historicalFailure('slice-b', 1)]);
    const requestTypes = new Map([['slice-b', declaredType(type)]]);

    const rows = aggregateHotspots([...measured, ...candidate], requestTypes);

    const measuredIndex = rows.findIndex((row) => row.confidence === 'exact');
    const candidateIndex = rows.findIndex((row) => row.confidence === 'ambiguous');
    expect(measuredIndex).toBeGreaterThanOrEqual(0);
    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    expect(measuredIndex).toBeLessThan(candidateIndex);
  });

  it('when one row counts more, should put it first', () => {
    // given: one artifact missed twice and another missed once
    // when: the ranking is computed over both sessions
    // then: the twice-missed artifact is first
    const eventsA = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const eventsB = seedSession(SESSION_B, [
      forwardMissing('slice-b', [
        { path: 'rd/code-review-slice-b.md', kind: 'absent', ownerSkill: 'peaks-rd' },
        { path: 'qa/test-report-slice-b.md', kind: 'absent', ownerSkill: 'peaks-qa' }
      ])
    ]);

    const rows = aggregateHotspots([...eventsA, ...eventsB]);

    expect(rows[0]?.count).toBe(2);
  });
});

describe('Scenario: render — the row carries what a reader checks the number against', () => {
  it('when a row exists, should carry the sessions, the span and the evidence', () => {
    // given: one artifact missed in two sessions
    // when: the ranking is computed over both sessions
    // then: the row names both sessions, spans them, and points at both events
    const eventsA = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);
    const eventsB = seedSession(SESSION_B, [
      forwardMissing('slice-b', [
        { path: 'rd/code-review-slice-b.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots([...eventsA, ...eventsB]);

    expect(rows[0]?.sessions).toBe(2);
    expect(rows[0]?.firstSeen).toBe('2026-10-27T00:00:00.000Z');
    expect(rows[0]?.lastSeen).toBe('2026-10-27T00:00:00.000Z');
    expect(rows[0]?.evidence.length).toBe(2);
  });

  it('when the missing list was measured, should say the count is missing artifacts', () => {
    // given: a forward event whose missing list was measured
    // when: the ranking is computed over that session
    // then: the row says its count counts OBSERVED missing artifacts
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows[0]?.countMeaning).toBe('observed-missing');
  });

  it('when the row is a candidate, should say the count is candidate mentions', () => {
    // given: a historical failure whose artifact is only a candidate
    // when: the ranking is computed over that session
    // then: the row says its count counts CANDIDATE MENTIONS — one real
    //        failure counts toward every candidate it could not narrow
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(1);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 1)]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const rows = aggregateHotspots(events, requestTypes);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.countMeaning).toBe('candidate-mentions');
  });

  it('when a candidate row counts more mentions than there were failures, should say so', () => {
    // given: ONE historical failure whose candidates could not be narrowed
    // when: the ranking is computed over that session
    // then: every candidate row counts that one failure — the number is a
    //        mention count, which is why the row carries the meaning
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(1);
    const events = seedSession(SESSION_A, [historicalFailure('slice-a', 1)]);
    const requestTypes = new Map([['slice-a', declaredType(type)]]);

    const rows = aggregateHotspots(events, requestTypes);

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(paths.length);
    expect(total).toBeGreaterThan(1);
  });
});

describe('Scenario: behavior — one artifact can be a candidate under two transitions', () => {
  it('when two transitions of different length name the same artifact, should keep the confidences apart', () => {
    // given: two historical failures — one whose transition demands a single
    //        artifact, one whose transition demands many — and the artifact
    //        BOTH name is the one the short transition could localise
    // when: the ranking is computed over that session
    // then: that artifact is TWO rows, one per confidence, each counting only
    //        the failures of its own transition — a reader who adds the two
    //        counts together would read one artifact as failing twice as often
    //        as it did
    const type: RequestType = 'bugfix';
    const narrow = prereqPaths('rd', 'implemented', type);
    const wide = prereqPaths('rd', 'qa-handoff', type);
    const shared = narrow.filter((path) => wide.includes(path));
    expect(shared.length).toBe(1);
    expect(wide.length).toBeGreaterThan(narrow.length);
    const events = seedSession(SESSION_A, [
      historicalFailure('slice-narrow', 1, 'rd', 'implemented'),
      historicalFailure('slice-wide', 1, 'rd', 'qa-handoff')
    ]);
    const requestTypes = new Map([
      ['slice-narrow', declaredType(type)],
      ['slice-wide', declaredType(type)]
    ]);

    const rows = aggregateHotspots(events, requestTypes);

    const sharedRows = rows.filter((row) => row.artifact === shared[0]);
    expect(sharedRows.length).toBe(2);
    expect(sharedRows.map((row) => row.confidence).sort()).toEqual(['ambiguous', 'inferred']);
    expect(sharedRows.every((row) => row.count === 1)).toBe(true);
  });
});

describe('Scenario: behavior — a ranking built only from historical failures', () => {
  it('when every failure recorded only a count, should count no artifact as measured missing', () => {
    // given: a whole session of HISTORICAL failures — the shape this
    //        repository's recorded history has, where every slice-transition
    //        event wrote a missingCount and never a missing LIST
    // when: the ranking is computed over that session
    // then: NOT ONE row claims a measured omission — every row is a
    //        candidate mention, and the counts are mentions rather than
    //        failures. A reader who took the top count as "this artifact was
    //        missing N times" would be reading a number this history never
    //        measured.
    const type: RequestType = 'feature';
    const paths = prereqPaths('rd', 'qa-handoff', type);
    expect(paths.length).toBeGreaterThan(1);
    const events = seedSession(SESSION_A, [
      historicalFailure('slice-a', 1),
      historicalFailure('slice-b', 1),
      historicalFailure('slice-c', 1)
    ]);
    const requestTypes = new Map([
      ['slice-a', declaredType(type)],
      ['slice-b', declaredType(type)],
      ['slice-c', declaredType(type)]
    ]);

    const rows = aggregateHotspots(events, requestTypes);

    expect(rows.length).toBe(paths.length);
    expect(rows.every((row) => row.confidence !== 'exact')).toBe(true);
    expect(rows.every((row) => row.countMeaning === 'candidate-mentions')).toBe(true);
    // Three failures, each counted toward every candidate it could not be
    // narrowed to — so the mentions outnumber the failures.
    expect(rows.every((row) => row.count === 3)).toBe(true);
    const mentions = rows.reduce((sum, row) => sum + row.count, 0);
    expect(mentions).toBe(3 * paths.length);
    expect(mentions).toBeGreaterThan(3);
  });
});

describe('Scenario: integration — the metric reads a real metrics file', () => {
  it('when the session file is read back off disk, should rank what it holds', () => {
    // given: a session written to disk with one measured missing artifact
    // when: the ranking is computed over the events read from disk
    // then: the file's own content produced the row
    const events = seedSession(SESSION_A, [
      forwardMissing('slice-a', [
        { path: 'rd/code-review-slice-a.md', kind: 'absent', ownerSkill: 'peaks-rd' }
      ])
    ]);

    const rows = aggregateHotspots(events);

    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(1);
  });
});
