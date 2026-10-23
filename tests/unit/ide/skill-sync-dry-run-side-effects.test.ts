// tests/unit/ide/skill-sync-dry-run-side-effects.test.ts
//
// A dry run must leave the machine exactly as it found it.
//
// WHY THIS FILE EXISTS. `--dry-run` exists so a caller can see what a repair WOULD
// do before it does it. A dry run that creates the platform's skill directory and
// then reports "184 skill symlinks" is not a plan — it is a half-done install
// wearing a plan's name, and the number in the envelope is a lie about what was
// done.
//
// TWO THINGS ARE PINNED HERE, and they are different things:
//
//   - the SIDE EFFECT: nothing is written. Not the platform's skill directory, not
//     the canonical store, not a marker, not a link.
//   - the NUMBER: the envelope says ZERO installed. A dry run that installed
//     nothing must not report an install.
//
// NOTHING HERE TOUCHES A REAL HOME. The home directory is redirected through
// `USERPROFILE` and `HOME` BEFORE the installer module is loaded — the profile
// table bakes `homedir()` at module load, so a redirection that arrives late is a
// redirection that never happened — and the canonical store is redirected through
// `PEAKS_HOME`. The sync path resolves its target through the IDE PROFILE, not
// through the skills-directory environment variable, so `USERPROFILE` is what
// actually keeps the run inside the scratch tree.
//
// Dimensions covered:
//   - behavior:    what the installer reports after a dry run
//   - integration: the real sync service and the real installer against a real
//                  filesystem, with the home and the store redirected
//   - render:      OMITTED — the installer returns records and prints nothing
//   - a11y:        OMITTED — no human-facing text, exit code or error message is
//                  asserted here

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/skill-sync-dry-run-side-effects.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the installer returns records and writes no human-facing output' },
    { dim: 'a11y', reason: 'no human-facing text, exit code or error message is asserted here' }
  ]
);

const SCRATCH_ROOT = mkdtempSync(join(tmpdir(), 'peaks-dry-run-side-effects-'));
const SCRATCH_HOME = join(SCRATCH_ROOT, 'home');
const STORE_ROOT = join(SCRATCH_HOME, '.peaks');
const IDE_SKILLS_DIR = join(SCRATCH_HOME, '.claude', 'skills');
const PACKAGE_ROOT = join(SCRATCH_ROOT, 'package');

const previousUserProfile = process.env.USERPROFILE;
const previousHome = process.env.HOME;
const previousPeaksHome = process.env.PEAKS_HOME;

type Installer = {
  installBundledSkills: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    entries: Array<{ name: string; state: string; action: string }>;
  };
};

let installer: Installer;

/** A package that ships exactly one skill, so the counts are readable. */
function writePackage(): void {
  mkdirSync(join(PACKAGE_ROOT, 'skills', 'peaks-code'), { recursive: true });
  writeFileSync(
    join(PACKAGE_ROOT, 'package.json'),
    `${JSON.stringify({ name: 'peaks-loop-fixture', version: '4.1.17' })}\n`,
    'utf8'
  );
  writeFileSync(join(PACKAGE_ROOT, 'skills', 'peaks-code', 'SKILL.md'), '# peaks-code\n', 'utf8');
}

beforeAll(async () => {
  // The redirections come FIRST: the profile table reads `homedir()` when the
  // installer module is loaded, and that module is loaded by the first call below.
  process.env.USERPROFILE = SCRATCH_HOME;
  process.env.HOME = SCRATCH_HOME;
  process.env.PEAKS_HOME = STORE_ROOT;
  mkdirSync(SCRATCH_HOME, { recursive: true });
  writePackage();
  installer = (await import('../../../scripts/install-skills.mjs')) as unknown as Installer;
});

afterAll(() => {
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousPeaksHome === undefined) delete process.env.PEAKS_HOME;
  else process.env.PEAKS_HOME = previousPeaksHome;
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe('Scenario: behavior — a dry run reports nothing installed', () => {
  it('when a dry run installs into a clean scratch tree, should report no install', () => {
    // given: a package that ships one skill, and a target directory that does not
    //        exist yet
    // when: the installer runs in dry-run mode
    // then: nothing was installed, and the one skill is reported as absent —
    //        the store does not hold it, and "absent" is not "current"
    const result = installer.installBundledSkills({
      packageRoot: PACKAGE_ROOT,
      targetRoot: IDE_SKILLS_DIR,
      dryRun: true
    });

    expect(result.installed).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.state).toBe('absent');
    expect(result.entries[0]?.action).toBe('planned');
  });
});

describe('Scenario: integration — a dry run writes nothing to the filesystem', () => {
  it('when a dry run installs into a clean scratch tree, should create no directory', () => {
    // given: a target directory that does not exist, and a canonical store that
    //        does not exist
    // when: the installer runs in dry-run mode
    // then: the directory the run would have written into is still absent, and
    //        so is the canonical store — a dry run that leaves a directory behind
    //        is not a dry run
    expect(existsSync(IDE_SKILLS_DIR)).toBe(false);
    expect(existsSync(join(STORE_ROOT, 'skills'))).toBe(false);

    installer.installBundledSkills({
      packageRoot: PACKAGE_ROOT,
      targetRoot: IDE_SKILLS_DIR,
      dryRun: true
    });

    expect(existsSync(IDE_SKILLS_DIR)).toBe(false);
    expect(existsSync(join(STORE_ROOT, 'skills'))).toBe(false);
  });

  it('when the sync service runs a dry run, should create no platform directory and report zero installed', async () => {
    // given: the sync service, the real installer, and a home directory that is
    //        a scratch tree
    // when: the sync runs a dry run over every platform
    // then: the envelope says nothing was installed
    const { runSkillSync, __testing } = await import('~/src/services/skills/sync-service');
    __testing.resetInstallerCache();

    const result = await runSkillSync({
      projectRoot: SCRATCH_ROOT,
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.totalInstalled).toBe(0);
    for (const platform of result.perPlatform) {
      expect(platform.installed).toEqual([]);
    }

    // and: the home directory is still EMPTY. Every platform's skill directory and
    //        the canonical store would be under it, so an empty home is the
    //        strongest statement of "a dry run wrote nothing".
    expect(readdirSync(SCRATCH_HOME)).toEqual([]);
    expect(existsSync(join(STORE_ROOT, 'skills'))).toBe(false);
  });
});
