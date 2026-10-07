// tests/unit/ide/install-skills-prune.test.ts
//
// SLICE 3 of `agents-canonical-store`: the installer learns to DELETE.
//
// WHAT WAS WRONG. Every loop in `installBundledSkills` walked the PACKAGE and wrote
// to the destinations; nothing ever walked the destinations. So the installer was
// add-only: when a skill left the package, its canonical copy under
// `~/.peaks/skills/<name>`, its link in every IDE skills directory and both
// `.peaks-managed` sidecars stayed on the user's machine forever, invisible and
// unreferenced. This file is the falsifying test for the loop that removes them.
//
// WHAT THIS FILE PINS. Prune deletes the retired skill's three artefacts, and — the
// half that matters — deletes NOTHING ELSE:
//   - a real directory the user authored under a retired skill's name survives, byte
//     for byte, with no sidecar written beside it. That is the NEGATIVE CONTROL the
//     brief makes mandatory: without it a "deleted the right things" implementation
//     and a "deleted too much" implementation look identical from the outside — both
//     exit 0 and both leave a shorter listing;
//   - a user-authored tree that shares the name of a skill the package DOES ship is
//     left alone rather than replaced. This is the `~/.peaks/agents/ecc` shape made
//     reachable: `ensureCanonicalCopy` used to run `rmSync` on its landing path with
//     no ownership test, and today only the accident that no bundled asset is called
//     `ecc` keeps it from deleting a 69-entry user tree;
//   - a run with nothing to retire reports no prune and moves no mtime.
//
// NO REAL $HOME IS TOUCHED. `$HOME` / `$USERPROFILE` are repointed at a throwaway
// directory BEFORE the installer is imported (its `IDE_SKILL_INSTALL_PROFILES` table
// bakes `homedir()` at module load), `PEAKS_HOME` redirects the canonical root out of
// that home entirely, and every call names its own `targetRoot` and `packageRoot`.
// Nothing below reads or writes the developer's own `~/.peaks` or `~/.claude`.
//
// Dimensions covered:
//   - behavior:    what the prune pass deletes, keeps and reports
//   - integration: the real installer, a real package fixture, real junctions on disk
//   - render:      OMITTED — a build script; its user-facing output is postinstall stdout
//   - a11y:        OMITTED — no human-facing text, exit code or message is asserted here

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/install-skills-prune.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'a build script; its user-visible surface is postinstall stdout' },
    {
      dim: 'a11y',
      reason: 'no human-facing text, exit code or structured message is asserted here'
    }
  ]
);

/** One throwaway home for the whole file; nothing below it is the real one. */
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'peaks-prune-home-'));
// NOT `<FAKE_HOME>/.peaks`: `$HOME` is repointed at FAKE_HOME below, so that spelling
// IS the unprefixed default. Keeping the two distinct means the assertions here would
// fail if the `PEAKS_HOME` override were ever ignored.
const CANONICAL_ROOT = join(FAKE_HOME, 'canonical-store');
const IDE_SKILLS_DIR = join(FAKE_HOME, '.claude', 'skills');
const BARE_PROJECT = join(FAKE_HOME, 'bare-project');
/** A package fixture we own, so "the package dropped a skill" is a fixture edit. */
const PACKAGE_ROOT = join(FAKE_HOME, 'package-9.9.9');
const STORE_SKILLS = join(CANONICAL_ROOT, 'skills');

const previousEnv: Record<string, string | undefined> = {
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
  PEAKS_HOME: process.env.PEAKS_HOME,
  PEAKS_PROJECT_ROOT: process.env.PEAKS_PROJECT_ROOT,
  PEAKS_SKIP_SKILL_INSTALL: process.env.PEAKS_SKIP_SKILL_INSTALL
};

// Repoint the home and the canonical root BEFORE the import below: the installer
// resolves `homedir()` for its profile table at module-load time.
mkdirSync(BARE_PROJECT, { recursive: true });
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.PEAKS_HOME = CANONICAL_ROOT;
process.env.PEAKS_PROJECT_ROOT = BARE_PROJECT;
delete process.env.PEAKS_SKIP_SKILL_INSTALL;

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

const mod = (await import('../../../scripts/install-skills.mjs')) as unknown as {
  installBundledSkills: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    pruned: string[];
  };
};

/** Every call names its own roots, so no default is ever resolved. */
function install(): { installed: string[]; skipped: string[]; pruned: string[] } {
  return mod.installBundledSkills({
    targetRoot: IDE_SKILLS_DIR,
    packageRoot: PACKAGE_ROOT,
    projectRoot: BARE_PROJECT
  });
}

/** The package ships `<name>/SKILL.md`; removing that directory retires the skill. */
function shipSkill(name: string, body: string): void {
  const dir = join(PACKAGE_ROOT, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8');
}

function retireSkill(name: string): void {
  rmSync(join(PACKAGE_ROOT, 'skills', name), { recursive: true, force: true });
}

const ALPHA_BODY = '# peaks-alpha\n\nretired next run.\n';
const BETA_BODY = '# peaks-beta\n\nstill shipped.\n';

/** `lstat` mtime for every path, keyed by path; links measured without following. */
function mtimes(paths: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const path of paths) {
    out[path] = lstatSync(path).mtimeMs;
  }
  return out;
}

beforeEach(() => {
  rmSync(CANONICAL_ROOT, { recursive: true, force: true });
  rmSync(IDE_SKILLS_DIR, { recursive: true, force: true });
  rmSync(join(PACKAGE_ROOT, 'skills'), { recursive: true, force: true });
  mkdirSync(IDE_SKILLS_DIR, { recursive: true });
  shipSkill('peaks-alpha', ALPHA_BODY);
  shipSkill('peaks-beta', BETA_BODY);
});

describe('Scenario: behavior — a skill the package dropped is deleted everywhere', () => {
  it('when the package stops shipping a skill, should delete its copy, its link and both sidecars', () => {
    // given: peaks-alpha is installed into the store and into an IDE skills directory
    // when: the package drops peaks-alpha entirely and the installer runs again
    // then: the copy, the link and the two sidecars are gone, and peaks-beta is intact
    const first = install();
    const canonicalAlpha = join(STORE_SKILLS, 'peaks-alpha');
    const ideAlpha = join(IDE_SKILLS_DIR, 'peaks-alpha');
    // Negative control for THIS arm: the three artefacts exist before the prune, so
    // the absence asserted below cannot be satisfied by a run that never installed.
    expect(existsSync(canonicalAlpha)).toBe(true);
    expect(existsSync(`${canonicalAlpha}.peaks-managed`)).toBe(true);
    expect(existsSync(ideAlpha)).toBe(true);
    expect(existsSync(`${ideAlpha}.peaks-managed`)).toBe(true);
    expect([...first.installed].sort()).toEqual(['peaks-alpha', 'peaks-beta']);

    retireSkill('peaks-alpha');
    const second = install();
    expect(existsSync(canonicalAlpha)).toBe(false);
    expect(existsSync(`${canonicalAlpha}.peaks-managed`)).toBe(false);
    expect(existsSync(ideAlpha)).toBe(false);
    expect(existsSync(`${ideAlpha}.peaks-managed`)).toBe(false);
    // The skill that is still shipped is untouched — the positive control that this
    // pass deletes by NAME SET rather than by "anything not just installed".
    expect(existsSync(join(STORE_SKILLS, 'peaks-beta'))).toBe(true);
    expect(readFileSync(join(STORE_SKILLS, 'peaks-beta', 'SKILL.md'), 'utf8')).toBe(BETA_BODY);
    expect(realpathSync(join(IDE_SKILLS_DIR, 'peaks-beta'))).toBe(
      realpathSync(join(STORE_SKILLS, 'peaks-beta'))
    );
    expect([...second.installed]).toEqual(['peaks-beta']);
    expect(second.pruned.some((entry) => entry.endsWith('peaks-alpha'))).toBe(true);
  });

  it('when a retired skill is pruned, should leave every entry the package still ships alone', () => {
    // given: two installed skills, one of which the package then drops
    // when: the installer runs again
    // then: only the retired name appears in the prune report, and nothing else moved
    install();
    const watched = [
      join(STORE_SKILLS, 'peaks-beta'),
      join(STORE_SKILLS, 'peaks-beta', 'SKILL.md'),
      join(STORE_SKILLS, 'peaks-beta.peaks-managed'),
      join(IDE_SKILLS_DIR, 'peaks-beta'),
      join(IDE_SKILLS_DIR, 'peaks-beta.peaks-managed')
    ];
    const before = mtimes(watched);

    retireSkill('peaks-alpha');
    const result = install();

    expect(mtimes(watched)).toEqual(before);
    expect(result.skipped).toEqual([]);
  });
});

describe('Scenario: behavior — prune only ever removes what peaks-loop owns', () => {
  it('when a real user directory reuses a retired skill name, should keep it byte for byte', () => {
    // given: the package ships neither name, and the user authored a real directory
    //        of that name in the IDE directory AND in the canonical store — neither
    //        carries a `.peaks-managed` sidecar, so neither is peaks-loop's
    // when: the installer runs and prunes
    // then: both directories survive with their bytes intact and no sidecar appears
    retireSkill('peaks-alpha');
    const userIdeSkill = join(IDE_SKILLS_DIR, 'peaks-alpha');
    const userStoreSkill = join(STORE_SKILLS, 'peaks-alpha');
    mkdirSync(userIdeSkill, { recursive: true });
    mkdirSync(userStoreSkill, { recursive: true });
    writeFileSync(join(userIdeSkill, 'SKILL.md'), '# mine, in the IDE dir\n', 'utf8');
    writeFileSync(join(userStoreSkill, 'SKILL.md'), '# mine, in the store\n', 'utf8');
    expect(existsSync(`${userIdeSkill}.peaks-managed`)).toBe(false);
    expect(existsSync(`${userStoreSkill}.peaks-managed`)).toBe(false);

    const result = install();

    expect(result.pruned).toEqual([]);
    expect(lstatSync(userIdeSkill).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(userIdeSkill, 'SKILL.md'), 'utf8')).toBe('# mine, in the IDE dir\n');
    expect(readFileSync(join(userStoreSkill, 'SKILL.md'), 'utf8')).toBe('# mine, in the store\n');
    // The proof that prune did not adopt it either: no sidecar was written beside it.
    expect(existsSync(`${userIdeSkill}.peaks-managed`)).toBe(false);
    expect(existsSync(`${userStoreSkill}.peaks-managed`)).toBe(false);
  });

  it('when a user tree shares a name the package still ships, should refuse to replace it', () => {
    // given: ~/.peaks/skills/peaks-alpha is a real directory the user authored, with
    //        no sidecar — the shape `~/.peaks/agents/ecc` really has on this machine
    // when: the package ships a skill of exactly that name and the installer runs
    // then: the user's tree survives, is reported skipped, and is never linked to
    const userSkill = join(STORE_SKILLS, 'peaks-alpha');
    mkdirSync(userSkill, { recursive: true });
    writeFileSync(join(userSkill, 'SKILL.md'), '# mine, not yours\n', 'utf8');
    writeFileSync(join(userSkill, 'notes.md'), '# 69 entries, in spirit\n', 'utf8');

    const result = install();

    expect(readFileSync(join(userSkill, 'SKILL.md'), 'utf8')).toBe('# mine, not yours\n');
    expect(readFileSync(join(userSkill, 'notes.md'), 'utf8')).toBe('# 69 entries, in spirit\n');
    expect(existsSync(`${userSkill}.peaks-managed`)).toBe(false);
    expect(result.skipped).toEqual(['peaks-alpha']);
    // The installer still did its job for the other skill — refusing one entry is
    // not refusing the run.
    expect([...result.installed]).toEqual(['peaks-beta']);
    expect(existsSync(join(IDE_SKILLS_DIR, 'peaks-alpha'))).toBe(false);
  });

  it('when an IDE entry is a link peaks-loop never wrote, should leave it in place', () => {
    // given: a retired name whose IDE entry is a junction to a foreign directory and
    //        carries no sidecar — an entry peaks-loop did not create
    // when: the installer prunes that name
    // then: the foreign entry is not touched, and the prune report is empty
    retireSkill('peaks-alpha');
    const foreignTarget = join(FAKE_HOME, 'somebody-elses-skill');
    mkdirSync(foreignTarget, { recursive: true });
    const foreignLink = join(IDE_SKILLS_DIR, 'peaks-alpha');
    symlinkSync(foreignTarget, foreignLink, 'junction');
    expect(existsSync(`${foreignLink}.peaks-managed`)).toBe(false);

    const result = install();

    expect(existsSync(foreignLink)).toBe(true);
    expect(readlinkSync(foreignLink)).toBe(foreignTarget);
    expect(result.pruned).toEqual([]);
  });
});

describe('Scenario: behavior — pruning is idempotent', () => {
  it('when nothing has been retired, should report no prune and move no mtime', () => {
    // given: one completed install and a package that still ships everything
    // when: the installer runs again over the same home
    // then: the prune pass is a no-op — nothing reported and nothing restamped
    const first = install();
    const watched = [
      STORE_SKILLS,
      ...first.installed.map((name) => join(STORE_SKILLS, name)),
      ...first.installed.map((name) => join(STORE_SKILLS, `${name}.peaks-managed`)),
      ...first.installed.map((name) => join(IDE_SKILLS_DIR, name)),
      ...first.installed.map((name) => join(IDE_SKILLS_DIR, `${name}.peaks-managed`))
    ];
    const before = mtimes(watched);

    const second = install();

    expect(second.pruned).toEqual([]);
    expect(second.installed).toEqual(first.installed);
    expect(mtimes(watched)).toEqual(before);
  });

  it('when a retired skill has already been pruned, should not report it a second time', () => {
    // given: a skill retired and pruned once
    // when: the installer runs a third time
    // then: the second prune pass reports nothing and the directory listing is stable
    install();
    retireSkill('peaks-alpha');
    const firstPrune = install();
    const listingAfter = readdirSync(IDE_SKILLS_DIR).sort();

    const secondPrune = install();

    expect(firstPrune.pruned).not.toEqual([]);
    expect(secondPrune.pruned).toEqual([]);
    expect(readdirSync(IDE_SKILLS_DIR).sort()).toEqual(listingAfter);
  });
});

describe('Scenario: integration — the prune module ships with the installer', () => {
  it('when the installer imports a sibling module, should ship that module in the tarball', () => {
    // given: `scripts/install-skills.mjs` runs as the npm postinstall, so every
    //        module it imports must be listed in `package.json#files`
    // when: the published-file allowlist is read
    // then: the prune module is published alongside the store it deletes from
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')
    ) as { files: string[] };
    expect(manifest.files).toContain('scripts/canonical-store.mjs');
    expect(manifest.files).toContain('scripts/canonical-store-prune.mjs');
  });
});
