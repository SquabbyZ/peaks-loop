// tests/unit/services/artifacts/backcompat-acceptance-seed.test.ts
//
// The ADOPTION half of the commit-leg expiry gate: the seed `initWorkspace`
// writes, the pin that keeps it agreeing with the repo's tracked list, and the
// doctor check that warns when an initialized project has neither.
//
// Split out of `backcompat-expiry-commit-gate.test.ts` because that file is at
// the tests file-size cap. The gate's decisions stay there; this file owns what
// a project receives and how it is told to get it.
//
// Dimensions covered:
//   - render:      the seeded JSON shape and its note
//   - behavior:    seeding is idempotent and `reviewBy` is derived per build
//   - integration: the seed against the repo's own tracked list, plus the doctor
//   - a11y:        the doctor's remediation text (it asks the LLM, never the user)
//
// 2026-10-24 — the `mut/mut-report.json` acceptance was RETIRED. The seeded
// list and the repo's tracked list no longer carry that window, so the arms
// below assert the ABSENCE of the mut entry explicitly: a list that still
// carried it would fail these arms rather than pass them unnoticed.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { CLI_VERSION } from 'peaks-loop-shared/version';
import { backcompatAcceptanceSeed } from '../../../../src/services/artifacts/backcompat-acceptance.js';
import { compareReleaseVersions } from '../../../../src/services/artifacts/prerequisite-checks.js';
import { check as backcompatDoctorCheck } from '../../../../src/services/doctor/doctor-service/checks/backcompat-acceptance.js';
import { PLUGINS } from '../../../../src/services/doctor/doctor-service/plugin-registry.js';
import type { DoctorContext } from '../../../../src/services/doctor/doctor-service/types.js';
import { initWorkspace } from '../../../../src/services/workspace/workspace-service.js';

declareDimensions('tests/unit/services/artifacts/backcompat-acceptance-seed.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The window RETIRED on 2026-10-24 — it must not appear in the seed or the
 *  tracked list any more. */
const RETIRED_MUT_PATH = 'mut/mut-report.json';
const THIRD_PARTY_PATH = 'rd/third-party-review-<rid>.md';
const ACCEPTANCE_RELATIVE = '.peaks/lint/backcompat-expired-acceptance.json';
/** `initWorkspace` validates the id against `YYYY-MM-DD-<slug>`. */
const SEED_SESSION = '2026-10-18-backcompat-seed';

type SeededList = {
  note: string;
  accepted: Array<{ path: string; until: string; reason: string; reviewBy: string }>;
};

/** The furthest `reviewBy` the gate accepts for `installedVersion`: +2 minors. */
function reviewCapOf(installedVersion: string): string {
  const [major, minor] = installedVersion.replace(/^v/i, '').split('.');
  return `v${major}.${Number(minor) + 2}.0`;
}

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-backcompat-seed-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function acceptanceAbs(root: string): string {
  return join(root, '.peaks', 'lint', 'backcompat-expired-acceptance.json');
}

function writeAcceptance(root: string, accepted: SeededList['accepted']): void {
  const absolute = acceptanceAbs(root);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify({ version: 1, accepted }, null, 2), 'utf8');
}

describe('Scenario: render — the seeded list names the reviewer window and the LLM rule', () => {
  it('when the seed is generated, should carry the reviewer window and an LLM-authored note', () => {
    const seeded = JSON.parse(backcompatAcceptanceSeed()) as SeededList;

    expect(seeded.accepted.map((entry) => entry.path)).toEqual([THIRD_PARTY_PATH]);
    // The mut window was retired: a seed that still carried it would hand a
    // new project the same false debt.
    expect(seeded.accepted.map((entry) => entry.path)).not.toContain(RETIRED_MUT_PATH);
    expect(seeded.note).toContain('The LLM edits this file');
    for (const entry of seeded.accepted) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('Scenario: behavior — seeding is idempotent and reviewBy is derived', () => {
  it('when a workspace is initialized, should seed the list and never overwrite it', async () => {
    const root = makeRoot();
    await initWorkspace({ projectRoot: root, sessionId: SEED_SESSION, noClaudeHooks: true });

    const seeded = JSON.parse(readFileSync(acceptanceAbs(root), 'utf8')) as SeededList;
    expect(seeded.accepted.map((entry) => entry.path)).toEqual([THIRD_PARTY_PATH]);
    expect(seeded.accepted.map((entry) => entry.path)).not.toContain(RETIRED_MUT_PATH);
    // The third-party window documents why it does not re-read reviewer.providers.
    expect(seeded.accepted.find((entry) => entry.path === THIRD_PARTY_PATH)?.reason).toContain(
      'reviewer.providers'
    );

    // A reviewed list survives the next init.
    writeFileSync(acceptanceAbs(root), '{"version":1,"accepted":[]}', 'utf8');
    await initWorkspace({ projectRoot: root, sessionId: SEED_SESSION, noClaudeHooks: true });
    expect(readFileSync(acceptanceAbs(root), 'utf8')).toBe('{"version":1,"accepted":[]}');
  });

  it('when the seed is generated, should set reviewBy ahead of this build and inside the cap', () => {
    // The time-bomb control: a seed written at the review target would make a
    // freshly initialized project hard-fail its first feature slice.
    const seeded = JSON.parse(backcompatAcceptanceSeed()) as SeededList;

    for (const entry of seeded.accepted) {
      expect(compareReleaseVersions(CLI_VERSION, entry.reviewBy)).toBeLessThan(0);
      expect(compareReleaseVersions(entry.reviewBy, reviewCapOf(CLI_VERSION))).toBeLessThanOrEqual(
        0
      );
    }
  });

  it('when the seed is generated for a release boundary, should not be already expired', () => {
    const seeded = JSON.parse(backcompatAcceptanceSeed('v4.2.0')) as SeededList;

    for (const entry of seeded.accepted) {
      expect(compareReleaseVersions('v4.2.0', entry.reviewBy)).toBeLessThan(0);
      expect(compareReleaseVersions(entry.reviewBy, reviewCapOf('v4.2.0'))).toBeLessThanOrEqual(0);
    }
  });
});

describe('Scenario: integration — the seed and the repo list agree on the windows', () => {
  it('when the init seed and the repo tracked list are compared, should agree on the windows', () => {
    // The tracked list is the repo's own acceptance; the seed is the init
    // default. They may differ in `reviewBy` (the seed derives it), never in
    // which window is accepted or why.
    const tracked = JSON.parse(
      readFileSync(join(process.cwd(), ACCEPTANCE_RELATIVE), 'utf8')
    ) as SeededList;
    const seeded = JSON.parse(backcompatAcceptanceSeed()) as SeededList;

    const windows = (list: SeededList): Array<[string, string, string]> =>
      list.accepted.map((entry) => [entry.path, entry.until, entry.reason]);
    expect(windows(seeded)).toEqual(windows(tracked));

    // Adoption is pinned: the repo's list covers the one expired window that is
    // still accepted, its own review target is still ahead of this build, and
    // the retired mut window is gone from BOTH lists.
    expect(tracked.accepted.map((entry) => entry.path)).toEqual([THIRD_PARTY_PATH]);
    expect(tracked.accepted.map((entry) => entry.path)).not.toContain(RETIRED_MUT_PATH);
    for (const entry of tracked.accepted) {
      expect(compareReleaseVersions(CLI_VERSION, entry.until)).toBeGreaterThanOrEqual(0);
      expect(compareReleaseVersions(CLI_VERSION, entry.reviewBy)).toBeLessThan(0);
    }
  });
});

describe('Scenario: a11y — the doctor asks the LLM, never the user', () => {
  it('when the acceptance list is absent, should warn and name the LLM remediation', async () => {
    const root = makeRoot();
    mkdirSync(join(root, '.peaks'), { recursive: true });

    const checks = await backcompatDoctorCheck.run({
      projectRootResolver: () => root
    } as DoctorContext);

    expect(checks).toHaveLength(1);
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.severity).toBe('error');
    expect(checks[0]?.message).toContain('Back-compat acceptance list is absent');
    expect(checks[0]?.message).toContain('fails closed');
    expect(checks[0]?.message).not.toContain('skipped');
    expect(checks[0]?.message).toContain('Ask the LLM to run `peaks workspace init');
    expect(checks[0]?.message).not.toContain('Run `peaks workspace init');
  });

  it('when the acceptance list is present, should pass the doctor check', async () => {
    const root = makeRoot();
    writeAcceptance(root, [
      { path: THIRD_PARTY_PATH, until: 'v2.15.0', reason: 'fixture', reviewBy: 'v9.9.9' }
    ]);

    const checks = await backcompatDoctorCheck.run({
      projectRootResolver: () => root
    } as DoctorContext);

    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.message).toContain('present');
  });

  it('when the doctor registry is read, should carry the acceptance check', () => {
    expect(PLUGINS.some((plugin) => plugin === backcompatDoctorCheck)).toBe(true);
    expect(PLUGINS.map((plugin) => plugin.name)).toContain('backcompat-acceptance');
  });
});
