// tests/unit/ide/canonical-store.test.ts
//
// The canonical store's own contract, slice 1 of `agents-canonical-store`.
//
// `canonical-store-legacy-repair.test.ts` is the falsifying case for the upgrade
// defect; this file is the contract the repair rests on, each clause measured:
//   - root resolution, with the environment override the tests and downstream
//     redirects depend on
//   - REAL COPIES: a directory, not a link, byte-equal to the package source
//   - idempotence by CONTENT: a second run moves no mtime, a changed source does
//   - the `.peaks-managed` sidecar, same convention the installer already writes
//   - link identity by `realpath`, never by string
//   - bee-level sources land under their FLAT name, as the installer flattens them
//
// THE MTIME CLAUSE IS A PAIR, deliberately. "Second run moves no mtime" alone
// passes for an assertion that measures nothing when the writer is a no-op; its
// partner ("a changed source DOES rewrite") is the positive control showing that a
// rewrite moves the clock. Neither arm is meaningful without the other.
//
// NO REAL $HOME IS TOUCHED. Every write goes under one `mkdtemp` root removed in
// `afterAll`; the default-root clause compares strings and opens nothing.
//
// Dimensions covered:
//   - behavior:    return records, throws, and the filesystem state they describe
//   - integration: the real module against a real filesystem and the real package
//   - render:      OMITTED — the module returns records and prints nothing
//   - a11y:        OMITTED — no human-facing text is produced here

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/canonical-store.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the store returns records and writes no human-facing output' },
    { dim: 'a11y', reason: 'no human-facing text, exit code or error message is asserted here' }
  ]
);

const mod = (await import('../../../scripts/canonical-store.mjs')) as unknown as {
  CANONICAL_ASSET_KINDS: readonly string[];
  CANONICAL_ROOT_ENV: string;
  resolveCanonicalRoot: (options?: Record<string, unknown>) => string;
  resolveKindRoot: (kind: string, options?: Record<string, unknown>) => string;
  readManagedTarget: (targetPath: string) => string | null;
  ensureCanonicalCopy: (options: Record<string, unknown>) => {
    canonicalPath: string;
    action: string;
  };
  linkResolvesTo: (linkPath: string, expectedPath: string) => boolean;
};

const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..');

/** One throwaway root for the whole file; nothing below it is the real home. */
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'peaks-canonical-store-'));
// Deliberately NOT `<FIXTURE_ROOT>/.peaks`: that is what the unprefixed default
// would resolve to if `homedir()` were ever repointed here, which would make the
// override clause below unable to fail. The store dir is named so the two can
// never collide.
const CANONICAL_ROOT = join(FIXTURE_ROOT, 'canonical-store');
const SOURCE_ROOT = join(FIXTURE_ROOT, 'package');

const previousCanonicalRoot = process.env.PEAKS_HOME;

afterAll(() => {
  if (previousCanonicalRoot === undefined) delete process.env.PEAKS_HOME;
  else process.env.PEAKS_HOME = previousCanonicalRoot;
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

/** A package-shaped source tree with directory assets and file assets. */
function writeSource(relativePath: string, body: string): string {
  const target = join(SOURCE_ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
  return target;
}

beforeEach(() => {
  rmSync(CANONICAL_ROOT, { recursive: true, force: true });
  rmSync(SOURCE_ROOT, { recursive: true, force: true });
  writeSource('skills/peaks-code/SKILL.md', '# peaks-code\n');
  writeSource('skills/bee/peaks-rd/SKILL.md', '# peaks-rd\n');
  writeSource('agents/karpathy-reviewer.md', '# reviewer\n');
  writeSource('output-styles/peaks-skill-swarm.md', '# style\n');
  process.env.PEAKS_HOME = CANONICAL_ROOT;
});

describe('Scenario: behavior — canonical root resolution', () => {
  it('when no override is given, should resolve under the home directory as ~/.peaks', () => {
    // given: neither an explicit root option nor the environment override is set
    // when: the canonical root is resolved with no arguments
    // then: it is `~/.peaks` — the home path the contract names
    //
    // DELIBERATELY NOT ASSERTED: that the resolved path is absent. That clause
    // used to ride along here as a proxy for "resolving creates nothing", but
    // absence is a fact about THIS HOST's home, not about this module — on any
    // machine that has run peaks-loop, `~/.peaks` exists (`config.json`, `logs/`,
    // …) and the clause fails for a reason the module is not responsible for.
    // The purity it stood in for is measured on a path that is absent BY
    // CONSTRUCTION in the case below.
    delete process.env[mod.CANONICAL_ROOT_ENV];
    expect(mod.resolveCanonicalRoot()).toBe(resolve(join(homedir(), '.peaks')));
  });

  it('when a root is resolved, should return the path without creating it', () => {
    // given: a root path that does not exist and that nothing in this file writes
    // when: the canonical root and a kind root under it are both resolved
    // then: both come back as paths and the filesystem was left untouched
    const absentRoot = join(FIXTURE_ROOT, 'never-created');
    expect(existsSync(absentRoot)).toBe(false);
    expect(mod.resolveCanonicalRoot({ root: absentRoot })).toBe(resolve(absentRoot));
    expect(mod.resolveKindRoot('skills', { root: absentRoot })).toBe(
      join(resolve(absentRoot), 'skills')
    );
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('when the environment variable is set, should override the home default', () => {
    // given: $PEAKS_HOME points at a throwaway directory
    // when: the canonical root and each of the three kinds is resolved
    // then: the environment wins and the three families hang off it
    process.env[mod.CANONICAL_ROOT_ENV] = CANONICAL_ROOT;
    expect(mod.resolveCanonicalRoot()).toBe(resolve(CANONICAL_ROOT));
    expect(mod.CANONICAL_ASSET_KINDS).toEqual(['skills', 'agents', 'output-styles']);
    for (const kind of mod.CANONICAL_ASSET_KINDS) {
      expect(mod.resolveKindRoot(kind)).toBe(join(resolve(CANONICAL_ROOT), kind));
    }
  });

  it('when an explicit root option is given, should win over the environment variable', () => {
    // given: the environment and the caller both name a root, and they disagree
    // when: the canonical root is resolved with the caller's option
    // then: the caller's explicit root is the one used
    process.env[mod.CANONICAL_ROOT_ENV] = join(FIXTURE_ROOT, 'from-env');
    const explicit = join(FIXTURE_ROOT, 'from-option');
    expect(mod.resolveCanonicalRoot({ root: explicit })).toBe(resolve(explicit));
  });

  it('when an unknown asset kind is requested, should refuse rather than invent a directory', () => {
    // given: a kind that is not one of the three asset families
    // when: its kind root is requested
    // then: the module throws instead of returning a path under the canonical root
    expect(() => mod.resolveKindRoot('skillz')).toThrow(/asset kind must be one of/);
  });
});

describe('Scenario: behavior — the canonical copy is real and idempotent', () => {
  it('when an asset is stored, should write a real directory with the source bytes', () => {
    // given: a package skill source on disk
    // when: the asset is stored canonically
    // then: the copy is a real directory whose bytes equal the source's
    const sourcePath = join(SOURCE_ROOT, 'skills', 'peaks-code');
    const result = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-code', sourcePath });
    expect(result.action).toBe('installed');
    expect(result.canonicalPath).toBe(join(CANONICAL_ROOT, 'skills', 'peaks-code'));
    expect(lstatSync(result.canonicalPath).isDirectory()).toBe(true);
    expect(lstatSync(result.canonicalPath).isSymbolicLink()).toBe(false);
    expect(
      readFileSync(join(result.canonicalPath, 'SKILL.md')).equals(
        readFileSync(join(sourcePath, 'SKILL.md'))
      )
    ).toBe(true);
  });

  it('when the same asset is stored twice, should move no mtime on the second run', () => {
    // given: a stored asset whose copy carries a distinctly old mtime
    // when: the same source is stored a second time
    // then: nothing was rewritten — the asset still carries the old mtime
    const sourcePath = join(SOURCE_ROOT, 'skills', 'peaks-code');
    const first = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-code', sourcePath });
    const copiedSkill = join(first.canonicalPath, 'SKILL.md');
    const pastTime = new Date(Date.now() - 60_000);
    utimesSync(copiedSkill, pastTime, pastTime);
    const before = statSync(copiedSkill).mtimeMs;
    const second = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-code', sourcePath });
    expect(second.action).toBe('unchanged');
    expect(statSync(copiedSkill).mtimeMs).toBe(before);
  });

  it('when the source content changes, should rewrite the copy and move its mtime', () => {
    // given: a stored asset whose copy carries a distinctly old mtime
    // when: the package ships new content for that asset and it is stored again
    // then: the copy is rewritten — the positive control for the arm above
    const sourcePath = join(SOURCE_ROOT, 'skills', 'peaks-code');
    const first = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-code', sourcePath });
    const copiedSkill = join(first.canonicalPath, 'SKILL.md');
    const pastTime = new Date(Date.now() - 60_000);
    utimesSync(copiedSkill, pastTime, pastTime);
    const before = statSync(copiedSkill).mtimeMs;
    writeFileSync(join(sourcePath, 'SKILL.md'), '# peaks-code v2\n', 'utf8');
    const second = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-code', sourcePath });
    expect(second.action).toBe('installed');
    expect(readFileSync(copiedSkill, 'utf8')).toBe('# peaks-code v2\n');
    expect(statSync(copiedSkill).mtimeMs).toBeGreaterThan(before);
  });

  it('when a bee-level source is stored, should land under its flat name', () => {
    // given: a bee-level skill living at `skills/bee/<name>` in the package
    // when: it is stored canonically under its flat name
    // then: the canonical entry has no `bee/` segment and holds the source bytes
    const sourcePath = join(SOURCE_ROOT, 'skills', 'bee', 'peaks-rd');
    const result = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-rd', sourcePath });
    expect(result.canonicalPath).toBe(join(CANONICAL_ROOT, 'skills', 'peaks-rd'));
    expect(readFileSync(join(result.canonicalPath, 'SKILL.md'), 'utf8')).toBe('# peaks-rd\n');
  });

  it('when an asset name escapes its kind root, should refuse it', () => {
    // given: an asset name carrying a path separator
    // when: it is handed to the store
    // then: the store refuses rather than writing outside the canonical root
    const sourcePath = join(SOURCE_ROOT, 'skills', 'peaks-code');
    expect(() =>
      mod.ensureCanonicalCopy({ kind: 'skills', name: '../escape', sourcePath })
    ).toThrow(/single path segment/);
  });

  it('when an asset is stored, should sidecar the source path in a .peaks-managed file', () => {
    // given: a package skill source on disk
    // when: the asset is stored canonically
    // then: the sidecar names the source, in the installer's existing convention
    const sourcePath = join(SOURCE_ROOT, 'skills', 'peaks-code');
    const result = mod.ensureCanonicalCopy({ kind: 'skills', name: 'peaks-code', sourcePath });
    const markerPath = `${result.canonicalPath}.peaks-managed`;
    expect(existsSync(markerPath)).toBe(true);
    expect(mod.readManagedTarget(result.canonicalPath)).toBe(sourcePath);
  });

  it('when a marker path is not a plain file, should refuse to read it', () => {
    // given: an asset path whose sidecar is a directory
    // when: the sidecar is read
    // then: the module throws instead of returning a value read off a directory
    const targetPath = join(CANONICAL_ROOT, 'skills', 'peaks-code');
    mkdirSync(`${targetPath}.peaks-managed`, { recursive: true });
    expect(() => mod.readManagedTarget(targetPath)).toThrow(/marker path must be a file/);
  });

  it('when a single-file asset is stored, should copy the file itself', () => {
    // given: an agent file and an output style file in the package
    // when: each is stored under its own kind
    // then: each canonical entry is a real file holding the source bytes
    const agent = mod.ensureCanonicalCopy({
      kind: 'agents',
      name: 'karpathy-reviewer.md',
      sourcePath: join(SOURCE_ROOT, 'agents', 'karpathy-reviewer.md')
    });
    const style = mod.ensureCanonicalCopy({
      kind: 'output-styles',
      name: 'peaks-skill-swarm.md',
      sourcePath: join(SOURCE_ROOT, 'output-styles', 'peaks-skill-swarm.md')
    });
    expect(lstatSync(agent.canonicalPath).isFile()).toBe(true);
    expect(readFileSync(agent.canonicalPath, 'utf8')).toBe('# reviewer\n');
    expect(lstatSync(style.canonicalPath).isFile()).toBe(true);
    expect(readFileSync(style.canonicalPath, 'utf8')).toBe('# style\n');
  });
});

describe('Scenario: behavior — link identity is decided by realpath, not by string', () => {
  it('when one directory is spelled two ways, should report the two spellings as one directory', () => {
    // given: a stored asset, and the same path spelled with a trailing separator
    // when: the two spellings are compared
    // then: the raw strings differ but the resolved identities match
    const sourcePath = join(SOURCE_ROOT, 'skills', 'peaks-code');
    const { canonicalPath } = mod.ensureCanonicalCopy({
      kind: 'skills',
      name: 'peaks-code',
      sourcePath
    });
    const spelledDifferently = `${canonicalPath}${sep}`;
    expect(spelledDifferently).not.toBe(canonicalPath);
    expect(mod.linkResolvesTo(spelledDifferently, canonicalPath)).toBe(true);
    expect(mod.linkResolvesTo(canonicalPath, spelledDifferently)).toBe(true);
  });

  it('when a path does not exist, should not claim that it resolves', () => {
    // given: a path that does not exist at all
    // when: it is compared against a directory that does
    // then: the comparison is false rather than throwing
    expect(mod.linkResolvesTo(join(FIXTURE_ROOT, 'gone'), FIXTURE_ROOT)).toBe(false);
  });
});

describe('Scenario: integration — the real shipped package', () => {
  it('when every shipped skill is stored, should reproduce all 22 byte-identically', () => {
    // given: the real package tree — 13 top-level skills and 9 bee-level ones
    // when: each one is stored canonically
    // then: all 22 canonical copies exist and are byte-equal to the package source
    const skillsRoot = join(PACKAGE_ROOT, 'skills');
    const sources: Array<{ name: string; sourcePath: string }> = [];
    for (const name of readdirSync(skillsRoot)) {
      if (name === 'bee') continue;
      const sourcePath = join(skillsRoot, name);
      if (lstatSync(sourcePath).isDirectory()) sources.push({ name, sourcePath });
    }
    for (const name of readdirSync(join(skillsRoot, 'bee'))) {
      sources.push({ name, sourcePath: join(skillsRoot, 'bee', name) });
    }
    const stored = sources.map(({ name, sourcePath }) => ({
      sourcePath,
      ...mod.ensureCanonicalCopy({ kind: 'skills', name, sourcePath })
    }));
    expect(sources).toHaveLength(22);
    expect(stored).toHaveLength(22);
    for (const entry of stored) {
      const from = join(entry.sourcePath, 'SKILL.md');
      const to = join(entry.canonicalPath, 'SKILL.md');
      expect(readFileSync(to).equals(readFileSync(from))).toBe(true);
    }
  });
});
