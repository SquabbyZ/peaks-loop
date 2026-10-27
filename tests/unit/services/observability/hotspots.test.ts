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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getPrerequisitesFor,
  type RequestType
} from '~/src/services/artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '~/src/services/artifacts/artifact-templates.js';
import type { RequestArtifactState } from '~/src/services/artifacts/request-artifact-state-helpers.js';
import { aggregateHotspots } from '~/src/services/observability/hotspots.js';
import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '~/src/services/observability/observability-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/hotspots.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

const SESSION_A = '2026-10-27-session-hotspots-a';
const SESSION_B = '2026-10-27-session-hotspots-b';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Write a session's metrics file with the given events, then read them back
 * through the real reader — so the shapes under test are the shapes on disk.
 */
function seedSession(
  sessionId: string,
  events: ReadonlyArray<Record<string, unknown>>
): readonly ObservabilityEvent[] {
  const root = mkdtempSync(join(tmpdir(), 'peaks-hotspots-'));
  roots.push(root);
  const dir = join(root, '.peaks', '_runtime', sessionId, 'metrics');
  mkdirSync(dir, { recursive: true });
  const lines = events.map((event, index) =>
    JSON.stringify({
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 9, 27, 0, 0, index)).toISOString(),
      sessionId,
      ...event
    })
  );
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return readObservabilityEvents(root, sessionId);
}

/** A forward event whose missing list was measured when it was recorded. */
function forwardMissing(
  sliceRid: string,
  missing: ReadonlyArray<{ path: string; kind: 'absent' | 'body'; ownerSkill: string | null }>
): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid,
    detail: {
      artifactRole: 'rd',
      to: 'qa-handoff',
      prereqOk: false,
      missingCount: missing.length,
      missing: missing.map((entry) => ({ ...entry, description: 'missing' }))
    }
  };
}

/** A historical event that recorded only a count. */
function historicalFailure(
  sliceRid: string,
  missingCount: number,
  role: RequestArtifactRole = 'rd',
  to: RequestArtifactState = 'qa-handoff'
): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid,
    detail: { artifactRole: role, to, prereqOk: false, missingCount }
  };
}

/** The prerequisite list of one transition, read from the real table. */
function prereqPaths(
  role: RequestArtifactRole,
  to: RequestArtifactState,
  type: RequestType
): readonly string[] {
  return getPrerequisitesFor(role, to, type).map((prereq) => prereq.relativePath);
}

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
    const requestTypes = new Map([['slice-a', type]]);

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
    const requestTypes = new Map([['slice-a', type]]);

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
    const requestTypes = new Map([['slice-a', type]]);

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
    const requestTypes = new Map([['slice-b', type]]);

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
    const requestTypes = new Map([['slice-a', type]]);

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
    const requestTypes = new Map([['slice-a', type]]);

    const rows = aggregateHotspots(events, requestTypes);

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(paths.length);
    expect(total).toBeGreaterThan(1);
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
