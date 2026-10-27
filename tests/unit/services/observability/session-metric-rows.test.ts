// tests/unit/services/observability/session-metric-rows.test.ts
//
// WHY THIS FILE EXISTS. The per-session row is the tracked artifact a later
// run compares against, and three of its properties are only visible on a
// REAL tree: the numbers it carries, the fact that the write publishes a
// complete file or nothing at all, and the fact that the compliance rate is
// computed with the request id substituted into the declared paths.
//
// THE ARMS:
//   1. the numbers -> the row carries the near-miss rate, the two counts
//      behind it, and the size of the hotspot ranking
//   2. the round trip -> a published row reads back field for field
//   3. the atomic publish -> a failed rename leaves the previous row intact
//      and no temporary file behind
//   4. the location -> the row lives under `.peaks/observability/sessions/`,
//      NOT in the gitignored runtime tree
//   5. the compliance rate -> artifacts that exist do not read as absent
//   6. the redaction -> the published file carries no free text
//   7. the skills version -> the `skills/` tree's git object id, or nothing
//
// THE TREE IS REAL. The session directory, the metrics file and the artifacts
// are written under a temp root and read back through the repository's own
// reader, so the shapes under test are the shapes on disk. Only the rename
// is hooked, to observe and to interrupt the publish.
//
// Dimensions:
//   behavior:   the numbers the row carries and the compliance reading
//   integration: a real temp tree, a real metrics file, a real git repository
//   render:     OMITTED - the module publishes a file, it renders no surface
//   a11y:       OMITTED - no operator-facing message originates here

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PEAKS_RD_SPEC } from '~/src/services/observability/compliance-specs/peaks-rd.spec.js';
import {
  SESSION_METRIC_ROWS_RELATIVE_PATH,
  buildSessionMetricRow,
  judgeSessionCompliance,
  readSessionMetricRow,
  readSkillsBlobSha,
  sessionMetricRowPath,
  writeSessionMetricRow
} from '~/src/services/observability/session-metric-rows.js';
import {
  SESSION_ID,
  SLICE_RID,
  cleanupRoots,
  makeRoot,
  seedArtifact,
  seedCompliantArtifacts,
  seedTwoSliceSession
} from './session-metric-rows-fixture.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/session-metric-rows.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module publishes a file; it renders no surface' },
    { dim: 'a11y', reason: 'no operator-facing message originates in this module' }
  ]
);

/** Rename observation + one-shot failure injection. */
const renameHook = vi.hoisted(() => ({
  calls: [] as Array<{ from: string; to: string }>,
  failOn: null as null | string,
  armed: false
}));

/** The rename seam the hook below observes and can fail; every other `node:fs`
 *  export passes straight through from the real module. */
type FsRenameSeam = { renameSync: (from: string, to: string) => void } & Record<string, unknown>;

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<FsRenameSeam>('node:fs');
  return {
    ...actual,
    renameSync: (from: unknown, to: unknown): void => {
      const fromPath = String(from);
      const toPath = String(to);
      if (renameHook.armed) {
        renameHook.calls.push({ from: fromPath, to: toPath });
      }
      if (renameHook.armed && renameHook.failOn !== null && toPath === renameHook.failOn) {
        throw Object.assign(new Error('injected rename failure'), { code: 'EPERM' });
      }
      actual.renameSync(fromPath, toPath);
    }
  };
});

afterEach(() => {
  renameHook.armed = false;
  renameHook.failOn = null;
  renameHook.calls = [];
  cleanupRoots();
});

describe("Scenario: behavior — the row carries the session's aggregate numbers", () => {
  it('when a session has one clean slice and one bypassed slice, should carry the near-miss rate and the counts behind it', () => {
    // given: a session whose stream holds two passing slices, one of them bought by a bypassed gate
    // when: the row is built from the session's events
    // then: the rate is one half, and the two counts say which numbers produced it
    const root = makeRoot();
    const events = seedTwoSliceSession(root);

    const row = buildSessionMetricRow({ sessionId: SESSION_ID, events });

    expect(row.sessionId).toBe(SESSION_ID);
    expect(row.schemaVersion).toBe(1);
    expect(row.nearMissRate).toBe(0.5);
    expect(row.passedSliceCount).toBe(2);
    expect(row.nearMissSliceCount).toBe(1);
  });

  it('when the stream records a measured missing artifact, should carry the size of the hotspot ranking', () => {
    // given: a session whose stream records one measured missing artifact
    // when: the row is built from the session's events
    // then: the row counts one hotspot, because the ranking has one row
    const root = makeRoot();
    const events = seedTwoSliceSession(root);

    const row = buildSessionMetricRow({ sessionId: SESSION_ID, events });

    expect(row.hotspotCount).toBe(1);
  });

  it('when no events are recorded, should carry zero counts rather than no row', () => {
    // given: a session with no events at all
    // when: the row is built from that empty stream
    // then: every count is zero and the row still exists
    const row = buildSessionMetricRow({ sessionId: SESSION_ID, events: [] });

    expect(row.nearMissRate).toBe(0);
    expect(row.passedSliceCount).toBe(0);
    expect(row.nearMissSliceCount).toBe(0);
    expect(row.hotspotCount).toBe(0);
    expect(row.compliance).toEqual([]);
  });
});

describe('Scenario: behavior — a published row reads back whole', () => {
  it('when a row is published and read back, should return the same row field for field', () => {
    // given: a row built from a session's events
    // when: it is published and read back
    // then: every field is the one that was written
    const root = makeRoot();
    const events = seedTwoSliceSession(root);
    const row = buildSessionMetricRow({
      sessionId: SESSION_ID,
      events,
      skillsBlobSha: 'a'.repeat(40),
      compliance: [{ specId: 'peaks-rd', sliceRid: SLICE_RID, complianceRate: 1 }]
    });

    writeSessionMetricRow(root, row);
    const read = readSessionMetricRow(root, SESSION_ID);

    expect(read).toEqual(row);
    expect(read?.schemaVersion).toBe(1);
    expect(read?.sessionId).toBe(SESSION_ID);
    expect(read?.generatedAt).toBe(row.generatedAt);
    expect(read?.nearMissRate).toBe(row.nearMissRate);
    expect(read?.passedSliceCount).toBe(row.passedSliceCount);
    expect(read?.nearMissSliceCount).toBe(row.nearMissSliceCount);
    expect(read?.hotspotCount).toBe(row.hotspotCount);
    expect(read?.compliance).toEqual(row.compliance);
    expect(read?.skillsBlobSha).toBe('a'.repeat(40));
  });

  it('when the project has no row for a session, should report no row', () => {
    // given: a project that has never published a row
    // when: the row is read
    // then: the answer is null, not an empty row
    const root = makeRoot();

    expect(readSessionMetricRow(root, SESSION_ID)).toBeNull();
  });

  it('when the publish fails, should leave the previous row untouched and no temporary file behind', () => {
    // given: a row already published for the session
    // when: a second row fails to be published
    // then: the first row still holds its own bytes, and the temporary file is gone
    const root = makeRoot();
    const first = buildSessionMetricRow({ sessionId: SESSION_ID, events: [] });
    writeSessionMetricRow(root, first);
    const path = sessionMetricRowPath(root, SESSION_ID);
    const published = readFileSync(path, 'utf8');

    renameHook.armed = true;
    renameHook.failOn = path;
    const second = buildSessionMetricRow({
      sessionId: SESSION_ID,
      events: [],
      compliance: [{ specId: 'peaks-rd', sliceRid: SLICE_RID, complianceRate: 1 }]
    });

    expect(() => writeSessionMetricRow(root, second)).toThrow(/injected rename failure/);
    expect(readFileSync(path, 'utf8')).toBe(published);
    const leftovers = readdirSync(dirname(path)).filter((name) => name !== `${SESSION_ID}.json`);
    expect(leftovers).toEqual([]);
  });

  it('when a row is published, should write it through a temporary file in the same directory', () => {
    // given: a row about to be published
    // when: it is published
    // then: the publish is a rename from the target's own directory, so it cannot be observed half-written
    const root = makeRoot();
    const path = sessionMetricRowPath(root, SESSION_ID);

    renameHook.armed = true;
    writeSessionMetricRow(root, buildSessionMetricRow({ sessionId: SESSION_ID, events: [] }));

    const renames = renameHook.calls.filter((call) => call.to === path);
    expect(renames).toHaveLength(1);
    expect(dirname(renames[0]?.from ?? '')).toBe(dirname(path));
    expect(existsSync(renames[0]?.from ?? '')).toBe(false);
  });
});

describe('Scenario: behavior — the row lives in the tracked sessions directory', () => {
  it('when a row is published, should land under `.peaks/observability/sessions/`', () => {
    // given: a project root and a session
    // when: the row for that session is published
    // then: the file is the tracked one, and not a file in the runtime tree
    const root = makeRoot();

    writeSessionMetricRow(root, buildSessionMetricRow({ sessionId: SESSION_ID, events: [] }));

    expect(SESSION_METRIC_ROWS_RELATIVE_PATH).toBe(
      '.peaks/observability/sessions/<sessionId>.json'
    );
    expect(
      existsSync(join(root, '.peaks', 'observability', 'sessions', `${SESSION_ID}.json`))
    ).toBe(true);
    expect(existsSync(join(root, '.peaks', '_runtime', SESSION_ID, 'observability'))).toBe(false);
  });
});

describe('Scenario: behavior — the compliance rate is computed with the request id substituted', () => {
  it('when the slice left every required artifact behind, should read a full compliance rate', async () => {
    // given: a session whose slice left every required artifact behind, at the names they really have
    // when: the spec is judged against that session
    // then: the rate is 1 — artifacts that exist must not read as absent
    const root = makeRoot();
    seedCompliantArtifacts(root);

    const reading = await judgeSessionCompliance({
      projectRoot: root,
      sessionId: SESSION_ID,
      spec: PEAKS_RD_SPEC,
      sliceRid: SLICE_RID
    });

    expect(reading.complianceRate).toBe(1);
    expect(reading.specId).toBe('peaks-rd');
    expect(reading.sliceRid).toBe(SLICE_RID);
  });

  it('when the slice left one required artifact behind, should read a partial rate', async () => {
    // given: a session whose slice left only the per-request artifact behind
    // when: the spec is judged against that session
    // then: the rate is the share of required steps that ran, and not zero
    const root = makeRoot();
    seedArtifact(root, `rd/requests/001-${SLICE_RID}.md`);

    const reading = await judgeSessionCompliance({
      projectRoot: root,
      sessionId: SESSION_ID,
      spec: PEAKS_RD_SPEC,
      sliceRid: SLICE_RID
    });

    expect(reading.complianceRate).toBeCloseTo(1 / 6, 10);
    expect(reading.complianceRate).not.toBe(0);
  });

  it('when the slice left nothing behind, should read no compliance', async () => {
    // given: a session with no artifacts at all
    // when: the spec is judged against that session
    // then: the rate is zero
    const root = makeRoot();

    const reading = await judgeSessionCompliance({
      projectRoot: root,
      sessionId: SESSION_ID,
      spec: PEAKS_RD_SPEC,
      sliceRid: SLICE_RID
    });

    expect(reading.complianceRate).toBe(0);
  });
});

describe('Scenario: behavior — the published row carries no free text', () => {
  it('when the stream carries free text, should publish only the aggregate numbers', () => {
    // given: a session whose stream records free text inside an event detail
    // when: the row is published
    // then: the published file holds the row's fields and none of that text
    const root = makeRoot();
    const events = seedTwoSliceSession(root);

    writeSessionMetricRow(root, buildSessionMetricRow({ sessionId: SESSION_ID, events }));
    const published = readFileSync(sessionMetricRowPath(root, SESSION_ID), 'utf8');

    expect(published).not.toContain('free text that must not reach the tracked row');
    expect(published).not.toContain('rd/code-review-');
    expect(Object.keys(JSON.parse(published) as Record<string, unknown>).sort()).toEqual([
      'compliance',
      'generatedAt',
      'hotspotCount',
      'nearMissRate',
      'nearMissSliceCount',
      'passedSliceCount',
      'schemaVersion',
      'sessionId',
      'typesWithoutVerdictPrerequisite'
    ]);
  });
});

describe('Scenario: behavior — the skills version is read from the git tree', () => {
  it('when the project has a committed skills tree, should report its git object id', () => {
    // given: a git repository with a committed `skills/` directory
    // when: the skills version is read
    // then: the object id of that tree is reported
    const root = makeRoot();
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore', windowsHide: true });
    mkdirSync(join(root, 'skills'), { recursive: true });
    writeFileSync(join(root, 'skills', 'demo.md'), '# demo\n', 'utf8');
    execFileSync('git', ['add', 'skills'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=fixture@example.com',
        '-c',
        'user.name=Fixture',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'seed'
      ],
      { cwd: root, stdio: 'ignore', windowsHide: true }
    );

    const sha = readSkillsBlobSha(root);

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('when the directory is not a git repository, should report no skills version and not throw', () => {
    // given: a directory that is not a git repository
    // when: the skills version is read
    // then: the answer is undefined, and reading it raised nothing
    const root = makeRoot();

    expect(() => readSkillsBlobSha(root)).not.toThrow();
    expect(readSkillsBlobSha(root)).toBeUndefined();
  });
});
