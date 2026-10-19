// tests/unit/services/artifacts/backcompat-expiry-commit-gate.test.ts
//
// The COMMIT LEG for a closed back-compat window, and the controls that keep it
// from being either toothless or hostile.
//
// `missingPrerequisiteWarning` already reports a closed window as a warning, and
// `peaks request transition` keeps soft-passing it on purpose: the workflow has
// to reach `qa-handoff` and record the skip. What was missing is the other
// boundary — `peaks workflow verify-pipeline` returned `complete: true` for
// windows that had been closed for many releases, because it never consulted the
// `backCompat` rows at all.
//
// The arms are controls, not demonstrations:
//   - an accepted window warns and does not fail
//   - a missing acceptance for one window fails exactly that window, by name
//   - an acceptance whose `reviewBy` has been reached stops accepting
//   - a `reviewBy` far beyond the two-minor cap is refused rather than trusted
//   - a window that is still open needs no acceptance file at all
//   - an ABSENT list FAILS CLOSED, with one violation naming `peaks workspace init`
//     as the seeding path the LLM runs
//   - a PRESENT but malformed list fails closed
//   - a present artifact needs no acceptance
//   - an unsafe session id is refused where the roots are joined
//   - `verifyPipeline` folds the verdict into `complete`, not only into
//     `violations`
//   - the transition still soft-passes (AC-5)
//
// Dimensions covered:
//   - render:      the warning / violation envelope fields
//   - behavior:    accept, refuse, expire, cap, absent vs malformed, unsafe id
//   - integration: a real `.peaks/lint` list, a real session tree, `initWorkspace`
//                  and the real transition
//   - a11y:        the text a human acts on — path, release, installed version
//                  and the remediation

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { CLI_VERSION } from 'peaks-loop-shared/version';
import {
  checkExpiredBackCompatCommitGate,
  getPrerequisitesFor
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { transitionRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';
import {
  makeProjectRoot,
  RID_A,
  seedCompleteSlice,
  seedVerifiablePipeline,
  SESSION_ID as FIXTURE_SESSION,
  writeArtifact
} from './_audit-artifact-rid-fixtures.js';

declareDimensions('tests/unit/services/artifacts/backcompat-expiry-commit-gate.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = 'test-session-backcompat-expiry';
const RID = '2026-10-18-backcompat-expiry-commit-gate';
const MUT_PATH = 'mut/mut-report.json';
/** The acceptance key is the DECLARED path: one entry covers every slice. */
const THIRD_PARTY_PATH = 'rd/third-party-review-<rid>.md';
/** Where the artifact actually lands for this request id. */
const THIRD_PARTY_RESOLVED = `rd/third-party-review-${RID}.md`;
const ACCEPTANCE_RELATIVE = '.peaks/lint/backcompat-expired-acceptance.json';
/** The release every acceptance arm is judged against. Injected so the suite
 *  does not depend on the version this checkout builds, and so the seeded
 *  `reviewBy: v4.2.0` stays a fixture rather than an expiring assertion. */
const INSTALLED = 'v4.1.6';
const REVIEW_BY = 'v4.2.0';

type AcceptedWindow = { path: string; until: string; reason: string; reviewBy: string };

/** The `until` the SHIPPED table declares for `path`. Read from the table rather
 *  than copied here: a test holding its own release number would keep passing
 *  after the window moved, and the acceptance key is `path` + `until` together. */
function windowUntil(path: string): string {
  const row = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
    (prerequisite) => prerequisite.relativePath === path
  );
  expect(row?.backCompat, `${path} is not a backCompat row in the rd:qa-handoff table`).toBe(true);
  return row?.backCompatUntil ?? '';
}

/** A `reviewBy` one minor ahead of the release this build ships — always inside
 *  the two-minor cap, so `verifyPipeline` arms (which cannot inject a version)
 *  never go red on a release boundary. */
function reviewWithinCap(): string {
  const [major, minor] = CLI_VERSION.replace(/^v/i, '').split('.');
  return `v${major}.${Number(minor) + 1}.0`;
}

function acceptedWindow(path: string, reviewBy = REVIEW_BY): AcceptedWindow {
  return {
    path,
    until: windowUntil(path),
    reason: `accepted for the commit leg: ${path}`,
    reviewBy
  };
}

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-backcompat-expiry-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeFile(root: string, relative: string, body: string): string {
  const absolute = join(root, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
  return absolute;
}

function writeAcceptance(root: string, accepted: ReadonlyArray<AcceptedWindow>): void {
  writeFile(root, ACCEPTANCE_RELATIVE, JSON.stringify({ version: 1, accepted }, null, 2));
}

function writeSessionArtifact(root: string, relative: string): void {
  writeFile(root, join('.peaks', '_runtime', SESSION_ID, relative), '{}');
}

function gateAt(projectRoot: string, installedVersion: string = INSTALLED) {
  return checkExpiredBackCompatCommitGate({
    projectRoot,
    sessionId: SESSION_ID,
    requestType: 'feature',
    requestId: RID,
    installedVersion
  });
}

describe('Scenario: render — the envelope names the window and the decision', () => {
  it('when a window is accepted, should warn with the path, releases and reviewBy', async () => {
    const root = makeRoot();
    writeAcceptance(root, [acceptedWindow(MUT_PATH), acceptedWindow(THIRD_PARTY_PATH)]);

    const result = await gateAt(root);

    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    const mutWarning = result.warnings.find((warning) => warning.includes(MUT_PATH));
    expect(mutWarning).toContain('accepted expired back-compat window');
    expect(mutWarning).toContain(windowUntil(MUT_PATH));
    expect(mutWarning).toContain(INSTALLED);
    expect(mutWarning).toContain(`reviewBy ${REVIEW_BY}`);
  });

  it('when a window is unaccepted, should return exactly the string fields the caller prints', async () => {
    const root = makeRoot();
    writeAcceptance(root, [acceptedWindow(THIRD_PARTY_PATH)]);

    const result = await gateAt(root);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('expired back-compat window and no current acceptance');
    expect(result.violations[0]).toContain(MUT_PATH);
    expect(result.violations[0]).toContain(windowUntil(MUT_PATH));
    expect(result.violations[0]).toContain(INSTALLED);
  });
});

describe('Scenario: behavior — accept, refuse, expire, cap, and fail closed', () => {
  it('when both seeded windows are accepted, should warn without a violation', async () => {
    const root = makeRoot();
    writeAcceptance(root, [acceptedWindow(MUT_PATH), acceptedWindow(THIRD_PARTY_PATH)]);

    const result = await gateAt(root);

    expect(result.violations).toEqual([]);
    expect(result.warnings.map((warning) => warning.split(' until ')[0])).toEqual([
      `accepted expired back-compat window: ${THIRD_PARTY_PATH}`,
      `accepted expired back-compat window: ${MUT_PATH}`
    ]);
  });

  it('when one window is removed from the list, should fail exactly that window', async () => {
    const root = makeRoot();
    writeAcceptance(root, [acceptedWindow(THIRD_PARTY_PATH)]);

    const result = await gateAt(root);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain(MUT_PATH);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(THIRD_PARTY_PATH);
  });

  it('when reviewBy is at the installed release, should stop accepting', async () => {
    const root = makeRoot();
    writeAcceptance(root, [
      acceptedWindow(MUT_PATH, REVIEW_BY),
      acceptedWindow(THIRD_PARTY_PATH, 'v4.3.0')
    ]);

    const result = await gateAt(root, REVIEW_BY);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain(MUT_PATH);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(THIRD_PARTY_PATH);
  });

  it('when reviewBy is behind the installed release, should stop accepting', async () => {
    const root = makeRoot();
    writeAcceptance(root, [
      acceptedWindow(MUT_PATH, 'v4.2.0'),
      acceptedWindow(THIRD_PARTY_PATH, 'v4.4.0')
    ]);

    const result = await gateAt(root, 'v4.3.0');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain(MUT_PATH);
  });

  it('when reviewBy is more than two minors ahead, should refuse it — the cap arm', async () => {
    // given: entries that would otherwise accept for decades
    const root = makeRoot();
    writeAcceptance(root, [
      acceptedWindow(MUT_PATH, 'v99.0.0'),
      acceptedWindow(THIRD_PARTY_PATH, 'v99.0.0')
    ]);

    const result = await gateAt(root);

    // then: two cap violations and no accepted warnings
    expect(result.warnings).toEqual([]);
    expect(result.violations).toHaveLength(2);
    for (const violation of result.violations) {
      expect(violation).toContain('beyond the review cap');
      expect(violation).toContain('v99.0.0');
      expect(violation).toContain('cap v4.3.0');
    }
  });

  it('when the window is still open, should need no acceptance file at all', async () => {
    const root = makeRoot();

    const result = await gateAt(root, 'v1.0.0');

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('when the request type carries no backCompat row, should not consult the list', async () => {
    const root = makeRoot();

    const result = await checkExpiredBackCompatCommitGate({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestType: 'docs',
      requestId: RID
    });

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('when the artifact exists at its declared path, should accept without an entry', async () => {
    const root = makeRoot();
    writeSessionArtifact(root, MUT_PATH);
    writeSessionArtifact(root, THIRD_PARTY_RESOLVED);

    const result = await gateAt(root);

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('when an upgraded project tracks only the bare legacy entry, should accept the scoped window', async () => {
    // given: the list a pre-scoping project already has on disk — the bare path
    const root = makeRoot();
    writeAcceptance(root, [
      acceptedWindow(MUT_PATH),
      {
        path: 'rd/third-party-review.md',
        until: windowUntil(THIRD_PARTY_PATH),
        reason: 'seeded before the rid scoping',
        reviewBy: REVIEW_BY
      }
    ]);

    // when: the commit leg runs for the scoped prerequisite
    const result = await gateAt(root);

    // then: the tracked entry still covers the window; an upgrade must not
    //       refuse commits until the list is edited by hand
    expect(result.violations).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes(THIRD_PARTY_PATH))).toBe(true);
  });

  it('when the tracked entry names a DIFFERENT path, should still refuse — the alias control', async () => {
    // given: an entry for the same window release but a different artifact,
    //        so the alias must not act as a wildcard
    const root = makeRoot();
    writeAcceptance(root, [
      acceptedWindow(MUT_PATH),
      {
        path: 'rd/other-review.md',
        until: windowUntil(THIRD_PARTY_PATH),
        reason: 'wrong artifact',
        reviewBy: REVIEW_BY
      }
    ]);

    const result = await gateAt(root);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain(THIRD_PARTY_PATH);
  });

  it('when the acceptance list is absent, should fail closed and name the seeding path', async () => {
    // given: no list on disk, and windows whose acceptance is required
    const root = makeRoot();

    const result = await gateAt(root);

    // then: absence is a violation, not an opt-out, and the remedy is the
    //       seeding command the LLM runs on the user's behalf
    expect(result.violations).toHaveLength(3);
    expect(result.violations[0]).toContain(ACCEPTANCE_RELATIVE);
    expect(result.violations[0]).toContain('is absent');
    expect(result.violations[0]).toContain('Ask the LLM to run `peaks workspace init`');
    expect(result.warnings).toEqual([]);
  });

  it('when the acceptance list is not valid JSON, should fail closed and name the file', async () => {
    const root = makeRoot();
    writeFile(root, ACCEPTANCE_RELATIVE, '{ "accepted": [');

    const result = await gateAt(root);

    expect(result.violations).toHaveLength(3);
    expect(result.violations[0]).toContain(ACCEPTANCE_RELATIVE);
    expect(result.violations[0]).toContain('not valid JSON');
  });

  it('when the acceptance list parses to a non-object, should fail closed by name', async () => {
    const root = makeRoot();
    writeFile(root, ACCEPTANCE_RELATIVE, 'null');

    const result = await gateAt(root);

    expect(result.violations).toHaveLength(3);
    expect(result.violations[0]).toContain(ACCEPTANCE_RELATIVE);
    expect(result.violations[0]).toContain('is not a JSON object');
  });

  it('when an acceptance entry is missing a field, should fail closed rather than trust it', async () => {
    const root = makeRoot();
    writeFile(
      root,
      ACCEPTANCE_RELATIVE,
      JSON.stringify({ accepted: [{ path: MUT_PATH, until: windowUntil(MUT_PATH), reason: 'x' }] })
    );

    const result = await gateAt(root);

    expect(result.violations[0]).toContain(ACCEPTANCE_RELATIVE);
    expect(result.violations[0]).toContain('path/until/reason/reviewBy');
  });

  it('when the session id escapes the project root, should refuse it by name', async () => {
    const root = makeRoot();

    await expect(
      checkExpiredBackCompatCommitGate({
        projectRoot: root,
        sessionId: '../../../PWNED',
        requestType: 'feature',
        requestId: RID,
        installedVersion: INSTALLED
      })
    ).rejects.toThrow('Invalid session id: ../../../PWNED (must be a single path segment)');
  });
});

describe('Scenario: integration — the seed, verifyPipeline, and the soft transition', () => {
  it('when the seeded windows are accepted, should complete with the accepted warnings', async () => {
    const root = makeRoot();
    await seedVerifiablePipeline(root, RID, SESSION_ID);
    const reviewBy = reviewWithinCap();
    writeAcceptance(root, [
      acceptedWindow(MUT_PATH, reviewBy),
      acceptedWindow(THIRD_PARTY_PATH, reviewBy)
    ]);

    const result = await verifyPipeline({ projectRoot: root, rid: RID, sessionId: SESSION_ID });

    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.nextActions.join('\n')).toContain('accepted expired back-compat window');
  });

  it('when one seeded window is unaccepted, should report complete false', async () => {
    const root = makeRoot();
    await seedVerifiablePipeline(root, RID, SESSION_ID);
    writeAcceptance(root, [acceptedWindow(THIRD_PARTY_PATH, reviewWithinCap())]);

    const result = await verifyPipeline({ projectRoot: root, rid: RID, sessionId: SESSION_ID });

    // `complete` is a conjunction of gate booleans, so a violation that was only
    // pushed would leave it true; this asserts the flag itself.
    expect(result.complete).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain(MUT_PATH);
  });

  it('when both windows are closed and missing, should still transition to qa-handoff (AC-5)', async () => {
    // given: a complete slice, no mut report and no third-party review
    const root = makeProjectRoot();
    try {
      writeArtifact(
        root,
        `rd/requests/001-${RID_A}.md`,
        `# RD Request ${RID_A}\n\n- session: ${FIXTURE_SESSION}\n- state: implemented\n- type: feature\n`
      );
      seedCompleteSlice(root, RID_A);

      // when: the transition runs
      const result = await transitionRequestArtifact({
        role: 'rd',
        requestId: RID_A,
        projectRoot: root,
        newState: 'qa-handoff',
        sessionId: FIXTURE_SESSION,
        confirmed: true
      });

      // then: it succeeds, and both closed windows are still reported softly
      expect(result?.state).toBe('qa-handoff');
      expect(result?.prerequisiteWarnings?.map((warning) => warning.code)).toEqual([
        'third-party-review-<rid>-missing-deprecated-in-v2.15.0',
        'mut-report-missing-deprecated-in-v2.14.0'
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Scenario: a11y — the text names the artifact, the release, and the remediation', () => {
  it('when a window is unaccepted, should name the repair and who performs it', async () => {
    const root = makeRoot();
    writeAcceptance(root, []);

    const result = await gateAt(root);
    const text = result.violations.join('\n');

    expect(text).toContain(`add an entry to ${ACCEPTANCE_RELATIVE}`);
    expect(text).toContain('a reason and a future reviewBy');
    expect(text).toContain("the LLM edits the tracked file on the user's behalf");
    expect(text).toContain('or produce the artifact');
    expect(text).toContain(`installed ${INSTALLED}`);
  });

  it('when the list is absent, should name the seeding path and the LLM-authored rule', async () => {
    const root = makeRoot();

    const result = await gateAt(root);

    expect(result.violations[0]).toContain('peaks workspace init');
    expect(result.violations[0]).toContain("the LLM edits it on the user's behalf");
  });

  it('when a window is accepted, should show the recorded reason and review target', async () => {
    const root = makeRoot();
    const entry = acceptedWindow(MUT_PATH, REVIEW_BY);
    writeAcceptance(root, [entry, acceptedWindow(THIRD_PARTY_PATH)]);

    const result = await gateAt(root);
    const mutWarning = result.warnings.find((warning) => warning.includes(MUT_PATH));

    expect(mutWarning).toContain(entry.reason);
    expect(mutWarning).toContain(`reviewBy ${entry.reviewBy}`);
  });
});
