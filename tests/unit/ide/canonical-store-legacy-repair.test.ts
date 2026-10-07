// tests/unit/ide/canonical-store-legacy-repair.test.ts
//
// THE FALSIFYING TEST for the `npm i -g peaks-loop@latest` upgrade defect.
//
// WHAT WAS WRONG. `install-skills.mjs` linked each IDE skills dir straight at
// `<packageRoot>/skills/<name>` — the source tree of the version installed AT
// THAT MOMENT. `<packageRoot>` changes on every global install, so the links
// bound to a source that is about to be deleted. Measured on this machine: 8
// IDE dirs x 44 `peaks-*` entries, 22 of them links, ALL 22 pointing into a
// development worktree and ZERO at the installed global package. The repair
// branch that could have fixed them (`reconcileJunctions`) is never passed by
// the postinstall, so every stale entry landed in the silent `skipped` bucket.
//
// WHAT THIS FILE PINS. `reconcileCanonicalEntry` must move the IDE entry off
// the ephemeral package path and onto `~/.peaks/<kind>/<name>`, a path
// peaks-loop owns and that does not drift when the package version changes.
//
// THIS FILE TOUCHES NO REAL $HOME. The canonical root is redirected through
// `PEAKS_HOME` at every call, and every fixture lives under one
// `mkdtemp` root removed in `afterAll`. The sidecar/absent-path assertions are
// the negative control: without repair the entry stays dangling, so this file
// cannot pass by measuring nothing.
//
// Dimensions covered:
//   - behavior:    the entry's post-repair state (resolves / is a real dir / bytes)
//   - integration: the real module against a real filesystem with real junctions
//   - render:      OMITTED — the module returns a record, it prints nothing
//   - a11y:        OMITTED — no human-facing text is produced here

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  'tests/unit/ide/canonical-store-legacy-repair.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the reconciler returns a record and writes no human-facing output' },
    { dim: 'a11y', reason: 'no human-facing text, exit code or error message is asserted here' }
  ]
);

const mod = (await import('../../../scripts/canonical-store.mjs')) as unknown as {
  reconcileCanonicalEntry: (options: Record<string, unknown>) => {
    canonicalPath: string;
    action: string;
    linkAction: string;
  };
  resolveKindRoot: (kind: string, options?: Record<string, unknown>) => string;
};

/** One throwaway home for the whole file; nothing below it is the real one. */
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'peaks-canonical-repair-'));
const CANONICAL_ROOT = join(FIXTURE_ROOT, '.peaks');
const PACKAGE_ROOT = join(FIXTURE_ROOT, 'package-4.1.1');
const STALE_PACKAGE_ROOT = join(FIXTURE_ROOT, 'package-3.0.0');
const IDE_SKILLS_DIR = join(FIXTURE_ROOT, '.claude', 'skills');

const previousCanonicalRoot = process.env.PEAKS_HOME;

afterAll(() => {
  if (previousCanonicalRoot === undefined) delete process.env.PEAKS_HOME;
  else process.env.PEAKS_HOME = previousCanonicalRoot;
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

/** Materialise `skills/<relative>/SKILL.md` with an exact body; return its dir. */
function writeSkill(packageRoot: string, relative: string, body: string): string {
  const dir = join(packageRoot, 'skills', relative);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8');
  return dir;
}

const CURRENT_BODY = '# peaks-rd\n\nbee-level role skill, current version.\n';

beforeEach(() => {
  rmSync(CANONICAL_ROOT, { recursive: true, force: true });
  rmSync(IDE_SKILLS_DIR, { recursive: true, force: true });
  rmSync(PACKAGE_ROOT, { recursive: true, force: true });
  rmSync(STALE_PACKAGE_ROOT, { recursive: true, force: true });
  mkdirSync(IDE_SKILLS_DIR, { recursive: true });

  writeSkill(PACKAGE_ROOT, 'peaks-code', '# peaks-code\n');
  writeSkill(PACKAGE_ROOT, 'bee/peaks-rd', CURRENT_BODY);
  // The version the user upgraded AWAY from: its own copy, then deleted, which
  // is what `npm i -g peaks-loop@latest` does to the previous install dir.
  writeSkill(STALE_PACKAGE_ROOT, 'bee/peaks-rd', '# peaks-rd\n\nold version.\n');
  rmSync(STALE_PACKAGE_ROOT, { recursive: true, force: true });

  process.env.PEAKS_HOME = CANONICAL_ROOT;
});

describe('Scenario: behavior — legacy layout repair', () => {
  it('when a legacy junction points at a vanished package path, should be repaired onto the canonical store', () => {
    // given: ~/.claude/skills/peaks-rd is a junction into a since-deleted package
    // when: the canonical store reconciles that entry
    // then: the entry resolves to the canonical copy, not to the vanished one
    const linkPath = join(IDE_SKILLS_DIR, 'peaks-rd');
    const vanishedSource = join(STALE_PACKAGE_ROOT, 'skills', 'bee', 'peaks-rd');
    const sourcePath = join(PACKAGE_ROOT, 'skills', 'bee', 'peaks-rd');
    symlinkSync(vanishedSource, linkPath, 'junction');

    // Negative control: BEFORE repair the entry is dangling and unreachable.
    // Without this the repair assertion below could pass on a no-op.
    expect(existsSync(linkPath)).toBe(false);
    expect(readlinkSync(linkPath)).toBe(vanishedSource);
    expect(existsSync(CANONICAL_ROOT)).toBe(false);

    const result = mod.reconcileCanonicalEntry({
      kind: 'skills',
      name: 'peaks-rd',
      sourcePath,
      linkPath
    });

    const canonicalPath = join(CANONICAL_ROOT, 'skills', 'peaks-rd');
    expect(result.canonicalPath).toBe(canonicalPath);
    expect(result.action).toBe('installed');
    expect(result.linkAction).toBe('repaired');
    expect(realpathSync(linkPath)).toBe(realpathSync(canonicalPath));
    expect(readlinkSync(linkPath)).toBe(canonicalPath);
    expect(readFileSync(join(linkPath, 'SKILL.md'), 'utf8')).toBe(CURRENT_BODY);
  });

  it('when the canonical copy is already correct, should rewrite nothing at all', () => {
    // given: a first reconcile has already put the entry in the canonical layout
    // when: the same asset is reconciled a second time
    // then: nothing was copied and nothing was relinked
    const linkPath = join(IDE_SKILLS_DIR, 'peaks-code');
    const sourcePath = join(PACKAGE_ROOT, 'skills', 'peaks-code');
    const first = mod.reconcileCanonicalEntry({
      kind: 'skills',
      name: 'peaks-code',
      sourcePath,
      linkPath
    });
    const second = mod.reconcileCanonicalEntry({
      kind: 'skills',
      name: 'peaks-code',
      sourcePath,
      linkPath
    });
    expect(first.action).toBe('installed');
    expect(second.action).toBe('unchanged');
    expect(second.linkAction).toBe('unchanged');
    expect(realpathSync(linkPath)).toBe(realpathSync(first.canonicalPath));
  });

  it('when the IDE entry is a real user directory, should leave it alone', () => {
    // given: peaks-code in the IDE dir is a real directory the user authored
    // when: the canonical store reconciles that entry
    // then: the user's copy survives and no link was forced over it
    const linkPath = join(IDE_SKILLS_DIR, 'peaks-code');
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, 'SKILL.md'), '# my own skill\n', 'utf8');
    const result = mod.reconcileCanonicalEntry({
      kind: 'skills',
      name: 'peaks-code',
      sourcePath: join(PACKAGE_ROOT, 'skills', 'peaks-code'),
      linkPath
    });
    expect(result.linkAction).toBe('skipped');
    expect(existsSync(linkPath)).toBe(true);
    expect(readFileSync(join(linkPath, 'SKILL.md'), 'utf8')).toBe('# my own skill\n');
  });
});
