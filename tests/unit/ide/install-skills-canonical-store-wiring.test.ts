// tests/unit/ide/install-skills-canonical-store-wiring.test.ts
//
// SLICE 2 of `agents-canonical-store`: the installer's IDE entries stop pointing at
// the package source tree and start pointing at the canonical store.
//
// WHAT WAS WRONG. `installBundledSkills` linked `~/.claude/skills/<name>` straight at
// `<packageRoot>/skills/<name>` — the source tree of the version installed AT THAT
// MOMENT. `<packageRoot>` changes on every `npm i -g peaks-loop@latest`, so those
// links bound to a VERSION and broke on upgrade. Worse, the only branch that could
// repair a stale link was gated behind `options.reconcileJunctions === true`, which
// the postinstall never passes, so every stale entry landed in the silent `skipped`
// bucket: no repair, no error, 22 dead links per IDE directory.
//
// WHAT THIS FILE PINS. After `installBundledSkills` runs:
//   - each IDE entry resolves to `~/.agents/skills/<name>`, a path peaks-loop owns
//     and that does NOT drift when the package version changes;
//   - the canonical entry is a REAL COPY (a directory, not a link) byte-equal to the
//     package source — so the IDE links never need rebuilding on upgrade;
//   - all 22 bundled skills arrive (13 top-level + 9 bee-level), FLAT in both
//     locations (`skills/bee/peaks-rd` → `skills/peaks-rd`);
//   - a second run rewrites nothing (no mtime moves) and reports the same set;
//   - a REAL directory the user authored is left alone — the negative control that
//     stops "reconcile everything" from becoming "clobber the user's work".
//
// NO REAL $HOME IS TOUCHED. `$HOME` / `$USERPROFILE` are repointed at a throwaway
// directory BEFORE the installer is imported (its `IDE_SKILL_INSTALL_PROFILES` table
// bakes `homedir()` at module load), and `PEAKS_AGENTS_HOME` redirects the canonical
// root at the same throwaway tree. Everything is removed in `afterAll`.
//
// Dimensions covered:
//   - behavior:    the installed/skipped records and the state they describe
//   - integration: the real installer, the real package `skills/` tree, real junctions
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
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/install-skills-canonical-store-wiring.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'a build script; its user-visible surface is postinstall stdout' },
    {
      dim: 'a11y',
      reason: 'no human-facing text, exit code or structured message is asserted here'
    }
  ]
);

const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..');

/** One throwaway home for the whole file; nothing below it is the real one. */
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'peaks-wiring-home-'));
const CANONICAL_ROOT = join(FAKE_HOME, '.agents');
const BARE_PROJECT = join(FAKE_HOME, 'bare-project');
const IDE_SKILLS_DIR = join(FAKE_HOME, '.claude', 'skills');

const previousEnv: Record<string, string | undefined> = {
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
  PEAKS_AGENTS_HOME: process.env.PEAKS_AGENTS_HOME,
  PEAKS_PROJECT_ROOT: process.env.PEAKS_PROJECT_ROOT,
  PEAKS_SKIP_SKILL_INSTALL: process.env.PEAKS_SKIP_SKILL_INSTALL
};

// Repoint the home and the canonical root BEFORE the import below: the installer
// resolves `homedir()` for its profile table at module-load time.
mkdirSync(BARE_PROJECT, { recursive: true });
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.PEAKS_AGENTS_HOME = CANONICAL_ROOT;
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
  };
};

interface Candidate {
  readonly name: string;
  readonly sourcePath: string;
}

/** The bundled skills, discovered the same way the installer discovers them. */
function candidatesIn(root: string): Candidate[] {
  const found: Candidate[] = [];
  for (const name of readdirSync(root)) {
    const sourcePath = join(root, name);
    if (!lstatSync(sourcePath).isDirectory()) continue;
    if (!existsSync(join(sourcePath, 'SKILL.md'))) continue;
    found.push({ name, sourcePath });
  }
  return found;
}

const SKILLS_ROOT = join(PACKAGE_ROOT, 'skills');
const TOP_LEVEL_CANDIDATES = candidatesIn(SKILLS_ROOT).filter(
  (candidate) => candidate.name !== 'bee'
);
const BEE_CANDIDATES = candidatesIn(join(SKILLS_ROOT, 'bee'));
const ALL_CANDIDATES: Candidate[] = [...TOP_LEVEL_CANDIDATES, ...BEE_CANDIDATES];

/** `lstat` mtime for every path, keyed by path; links measured without following. */
function mtimes(paths: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const path of paths) out[path] = lstatSync(path).mtimeMs;
  return out;
}

beforeEach(() => {
  rmSync(CANONICAL_ROOT, { recursive: true, force: true });
  rmSync(IDE_SKILLS_DIR, { recursive: true, force: true });
  mkdirSync(IDE_SKILLS_DIR, { recursive: true });
});

describe('Scenario: behavior — the installer points IDE entries at the canonical store', () => {
  it('when a legacy junction points at a vanished package path, should be repaired onto the canonical store', () => {
    // given: ~/.claude/skills/peaks-rd is a junction into a package version that
    //        `npm i -g peaks-loop@latest` has since deleted, sidecar and all
    // when: the installer reconciles that IDE directory
    // then: the entry resolves to the canonical copy and is readable again
    const linkPath = join(IDE_SKILLS_DIR, 'peaks-rd');
    const vanished = join(FAKE_HOME, 'package-3.0.0', 'skills', 'bee', 'peaks-rd');
    symlinkSync(vanished, linkPath, 'junction');
    writeFileSync(`${linkPath}.peaks-managed`, `${vanished}\n`, 'utf8');

    // Negative control: BEFORE the repair the entry is dangling, so the assertion
    // below cannot be satisfied by a no-op.
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(CANONICAL_ROOT)).toBe(false);

    mod.installBundledSkills({ targetRoot: IDE_SKILLS_DIR });

    const canonicalPath = join(CANONICAL_ROOT, 'skills', 'peaks-rd');
    expect(realpathSync(linkPath)).toBe(realpathSync(canonicalPath));
    expect(readlinkSync(linkPath)).toBe(canonicalPath);
    expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(linkPath, 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(PACKAGE_ROOT, 'skills', 'bee', 'peaks-rd', 'SKILL.md'), 'utf8')
    );
  });

  it('when the installer runs against the real package, should place all 22 skills flat in both locations', () => {
    // given: the bundled package ships 13 top-level skills and 9 bee-level skills
    // when: the installer links them into an IDE skills directory
    // then: every skill is present under its FLAT name in the store and in the IDE dir
    expect(TOP_LEVEL_CANDIDATES).toHaveLength(13);
    expect(BEE_CANDIDATES).toHaveLength(9);
    expect(ALL_CANDIDATES).toHaveLength(22);

    const result = mod.installBundledSkills({ targetRoot: IDE_SKILLS_DIR });

    expect(result.skipped).toEqual([]);
    expect([...result.installed].sort()).toEqual(ALL_CANDIDATES.map((c) => c.name).sort());

    for (const { name, sourcePath } of ALL_CANDIDATES) {
      const canonicalPath = join(CANONICAL_ROOT, 'skills', name);
      // The store holds a REAL COPY: a directory, never a link, byte-equal to source.
      expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
      expect(lstatSync(canonicalPath).isDirectory()).toBe(true);
      expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(
        readFileSync(join(sourcePath, 'SKILL.md'), 'utf8')
      );
      // The IDE entry is a link that resolves to that copy.
      expect(realpathSync(join(IDE_SKILLS_DIR, name))).toBe(realpathSync(canonicalPath));
    }
    // Flatness, stated as a fact about the tree: there is no nested `bee` directory.
    expect(existsSync(join(CANONICAL_ROOT, 'skills', 'bee'))).toBe(false);
  });

  it('when the installer runs twice, should rewrite nothing the second time', () => {
    // given: one completed install
    // when: the installer runs again over the same home
    // then: the same skills are reported and no mtime moved anywhere
    const first = mod.installBundledSkills({ targetRoot: IDE_SKILLS_DIR });
    const watched = [
      ...ALL_CANDIDATES.map((c) => join(CANONICAL_ROOT, 'skills', c.name)),
      ...ALL_CANDIDATES.map((c) => join(CANONICAL_ROOT, 'skills', c.name, 'SKILL.md')),
      ...ALL_CANDIDATES.map((c) => join(IDE_SKILLS_DIR, c.name)),
      ...ALL_CANDIDATES.map((c) => `${join(IDE_SKILLS_DIR, c.name)}.peaks-managed`)
    ];
    const before = mtimes(watched);
    const canonicalStamp = statSync(join(CANONICAL_ROOT, 'skills')).mtimeMs;

    const second = mod.installBundledSkills({ targetRoot: IDE_SKILLS_DIR });

    expect(second.skipped).toEqual([]);
    expect([...second.installed].sort()).toEqual([...first.installed].sort());
    expect(mtimes(watched)).toEqual(before);
    expect(statSync(join(CANONICAL_ROOT, 'skills')).mtimeMs).toBe(canonicalStamp);
  });

  it('when a real user directory shares a bundled skill name, should leave it untouched', () => {
    // given: ~/.claude/skills/peaks-code is a real directory the user authored,
    //        with no `.peaks-managed` sidecar — not ours
    // when: the installer reconciles that IDE directory
    // then: the user's copy survives verbatim and is reported skipped
    const userSkill = join(IDE_SKILLS_DIR, 'peaks-code');
    mkdirSync(userSkill, { recursive: true });
    writeFileSync(join(userSkill, 'SKILL.md'), '# my own peaks-code\n', 'utf8');
    expect(existsSync(`${userSkill}.peaks-managed`)).toBe(false);

    const result = mod.installBundledSkills({ targetRoot: IDE_SKILLS_DIR });

    expect(result.skipped).toEqual(['peaks-code']);
    expect(lstatSync(userSkill).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(userSkill, 'SKILL.md'), 'utf8')).toBe('# my own peaks-code\n');
    expect(result.installed).toHaveLength(21);
  });

  it('when the installer imports a sibling module, should ship that module in the tarball', () => {
    // given: `scripts/install-skills.mjs` runs as the npm postinstall, so every
    //        module it imports must be listed in `package.json#files`
    // when: the published-file allowlist is read
    // then: the canonical store module is published alongside the installer
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(manifest.files).toContain('scripts/install-skills.mjs');
    expect(manifest.files).toContain('scripts/canonical-store.mjs');
  });
});
