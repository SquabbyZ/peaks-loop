// tests/unit/ide/agents-output-styles-canonical-store.test.ts
//
// SLICE 4 of `agents-canonical-store`: the two FILE-shaped asset families join the
// canonical store, and the defect that froze them forever is closed.
//
// WHAT WAS WRONG. `installBundledAgents` / `installBundledOutputStyles` wrote a real
// `.md` file into the IDE directory and sidecarred it with
// `resolve(marker.sourcePath) === resolve(sourcePath)` — a STRING comparison against
// the package path of the installing version. Measured on this machine,
// `~/.claude/agents/karpathy-reviewer.md.peaks-managed` records
// `…\nvm\v24.21.0\node_modules\peaks-loop\agents\karpathy-reviewer.md`: a path with a
// NODE VERSION embedded in it. The moment that path changes — a node upgrade, a
// worktree instead of the global package, a different package manager — the
// comparison is false forever, `getManagedPeaksAgentIdentity` returns null, and the
// entry lands in the silent `skipped` bucket. The agent then NEVER updates again and
// nothing is logged. Same root cause as the skills defect of slice 2 (provenance
// bound to a version-scoped path), different symptom: skills broke VISIBLY (dangling
// link), these two froze INVISIBLY (stale content, no error).
//
// WHAT THIS FILE PINS. After the installer runs:
//   - the real source of truth is `~/.peaks/{agents,output-styles}/<name>`, a REAL
//     FILE (never a link) byte-equal to the package source;
//   - the IDE entry is a FILE SYMLINK resolving to that copy, so a package upgrade
//     moves the content without recreating anything;
//   - an entry whose sidecar names a package path that NO LONGER EXISTS is repaired:
//     new bytes, provenance re-pointed at the canonical store. That is the case the
//     old string comparison skipped, and the assertions below are written so they
//     FAIL against the old behaviour — the entry stays the old file, byte for byte;
//   - output-styles stay SINGLE-TARGET (the dispatch-strategy note above
//     `installBundledOutputStyles` is the reason) and `installBundledOutputStyleDefault`
//     still finds the bundled style and writes `settings.json` through the link.
//
// NO REAL $HOME IS TOUCHED. `$HOME` / `$USERPROFILE` are repointed at a throwaway
// directory BEFORE the installer is imported (its `IDE_SKILL_INSTALL_PROFILES` table
// bakes `homedir()` at module load), `PEAKS_HOME` redirects the canonical root out of
// that home entirely, and every call names its own `targetRoot` / `packageRoot`. The
// agents fan-out (`installBundledAgentsForAllPlatforms`) is deliberately NEVER called
// here: it walks every platform the user HAS, which is how an earlier slice rewrote
// the developer's real `~/.claude`, `~/.trae` and `~/.codex` directories twice.
//
// Dimensions covered:
//   - behavior:    the records returned and the filesystem state they describe
//   - integration: the real installer, the real module tree, real file symlinks
//   - render:      OMITTED — a build script; its user-facing surface is postinstall stdout
//   - a11y:        OMITTED — no human-facing text, exit code or message is asserted here

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/agents-output-styles-canonical-store.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'a build script; its user-visible surface is postinstall stdout' },
    {
      dim: 'a11y',
      reason: 'no human-facing text, exit code or structured message is asserted here'
    }
  ]
);

const PACKAGE_ROOT_REPO = resolve(__dirname, '..', '..', '..');

/** One throwaway home for the whole file; nothing below it is the real one. */
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'peaks-agents-store-home-'));
// NOT `<FAKE_HOME>/.peaks`: `$HOME` is repointed at FAKE_HOME below, so that spelling
// IS the unprefixed default. Keeping the two distinct means the assertions here would
// fail if the `PEAKS_HOME` override were ever ignored.
const CANONICAL_ROOT = join(FAKE_HOME, 'canonical-store');
/** A package fixture we own, so "the package shipped new content" is a fixture edit. */
const PACKAGE_ROOT = join(FAKE_HOME, 'package-2.0.0');
const IDE_AGENTS_DIR = join(FAKE_HOME, '.claude', 'agents');
const IDE_STYLES_DIR = join(FAKE_HOME, '.claude', 'output-styles');
const BARE_PROJECT = join(FAKE_HOME, 'bare-project');

const AGENT_NAME = 'karpathy-reviewer.md';
const STYLE_NAME = 'peaks-skill-swarm.md';
const OLD_AGENT_BODY = '# karpathy-reviewer v1\n\nthe previous prompt.\n';
const NEW_AGENT_BODY = '# karpathy-reviewer v2\n\nthe new prompt.\n';
const OLD_STYLE_BODY = '# peaks-skill-swarm v1\n';
const NEW_STYLE_BODY = '# peaks-skill-swarm v2\n';

const previousEnv: Record<string, string | undefined> = {
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
  PEAKS_HOME: process.env.PEAKS_HOME,
  PEAKS_PROJECT_ROOT: process.env.PEAKS_PROJECT_ROOT,
  PEAKS_SKIP_SKILL_INSTALL: process.env.PEAKS_SKIP_SKILL_INSTALL,
  PEAKS_SKIP_AGENT_INSTALL: process.env.PEAKS_SKIP_AGENT_INSTALL
};

// Repoint the home and the canonical root BEFORE the import below: the installer
// resolves `homedir()` for its profile table at module-load time.
mkdirSync(BARE_PROJECT, { recursive: true });
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.PEAKS_HOME = CANONICAL_ROOT;
process.env.PEAKS_PROJECT_ROOT = BARE_PROJECT;
delete process.env.PEAKS_SKIP_SKILL_INSTALL;
delete process.env.PEAKS_SKIP_AGENT_INSTALL;

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

const mod = (await import('../../../scripts/install-skills.mjs')) as unknown as {
  installBundledAgents: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    pruned: string[];
    fallbacks: Array<{ name: string; mode: string }>;
  };
  installBundledOutputStyles: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    pruned: string[];
    fallbacks: Array<{ name: string; mode: string }>;
  };
  installBundledOutputStyleDefault: (options: Record<string, unknown>) => {
    installed?: boolean;
    outputStyle?: string;
  };
};

/** Prune's ownership predicate, asked about the same entries the reconciler sees. */
const storeMod = (await import('../../../scripts/canonical-store.mjs')) as unknown as {
  isManagedEntry: (targetPath: string) => boolean;
};

/** Ship the package fixture the installer is pointed at. */
function shipPackage(): void {
  mkdirSync(join(PACKAGE_ROOT, 'agents'), { recursive: true });
  mkdirSync(join(PACKAGE_ROOT, 'output-styles'), { recursive: true });
  writeFileSync(join(PACKAGE_ROOT, 'agents', AGENT_NAME), NEW_AGENT_BODY, 'utf8');
  writeFileSync(join(PACKAGE_ROOT, 'output-styles', STYLE_NAME), NEW_STYLE_BODY, 'utf8');
}

function installAgents(options: Record<string, unknown> = {}): {
  installed: string[];
  skipped: string[];
  pruned: string[];
  fallbacks: Array<{ name: string; mode: string }>;
} {
  return mod.installBundledAgents({
    targetRoot: IDE_AGENTS_DIR,
    packageRoot: PACKAGE_ROOT,
    ...options
  });
}

function installStyles(options: Record<string, unknown> = {}): {
  installed: string[];
  skipped: string[];
  pruned: string[];
  fallbacks: Array<{ name: string; mode: string }>;
} {
  return mod.installBundledOutputStyles({
    targetRoot: IDE_STYLES_DIR,
    packageRoot: PACKAGE_ROOT,
    ...options
  });
}

/**
 * The state the upgrade defect produces: a real file of the PREVIOUS version whose
 * sidecar names the package path it was copied from, in the JSON shape the
 * pre-canonical-store installer wrote.
 */
function writeLegacyEntry(options: {
  entryPath: string;
  body: string;
  vanishedSource: string;
  kind: string;
  name: string;
}): void {
  const { entryPath, body, vanishedSource, kind, name } = options;
  writeFileSync(entryPath, body, 'utf8');
  writeFileSync(
    `${entryPath}.peaks-managed`,
    `${JSON.stringify({
      version: 1,
      kind,
      [kind === 'agent' ? 'agentName' : 'outputStyleName']: name,
      sourcePath: vanishedSource,
      contentSha256: hashOf(body)
    })}\n`,
    'utf8'
  );
}

function hashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Every path the two families touch, so "nothing moved" can be asserted as a set. */
function watchedPaths(): string[] {
  return [
    join(CANONICAL_ROOT, 'agents', AGENT_NAME),
    join(CANONICAL_ROOT, 'agents', `${AGENT_NAME}.peaks-managed`),
    join(CANONICAL_ROOT, 'output-styles', STYLE_NAME),
    join(CANONICAL_ROOT, 'output-styles', `${STYLE_NAME}.peaks-managed`),
    join(IDE_AGENTS_DIR, AGENT_NAME),
    join(IDE_AGENTS_DIR, `${AGENT_NAME}.peaks-managed`),
    join(IDE_STYLES_DIR, STYLE_NAME),
    join(IDE_STYLES_DIR, `${STYLE_NAME}.peaks-managed`)
  ];
}

function mtimes(paths: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const path of paths) out[path] = lstatSync(path).mtimeMs;
  return out;
}

beforeEach(() => {
  rmSync(CANONICAL_ROOT, { recursive: true, force: true });
  rmSync(join(FAKE_HOME, '.claude'), { recursive: true, force: true });
  rmSync(PACKAGE_ROOT, { recursive: true, force: true });
  mkdirSync(IDE_AGENTS_DIR, { recursive: true });
  mkdirSync(IDE_STYLES_DIR, { recursive: true });
  shipPackage();
});

describe('Scenario: behavior — the upgrade reaches an entry the old installer froze', () => {
  it('when a JSON sidecar sits beside a real file, should be adopted as ours by BOTH predicates', () => {
    // given: the real upgrade state — an IDE entry that is a REAL FILE beside the JSON
    //        sidecar the pre-canonical-store installer wrote (not a link, not skills'
    //        plain-path sidecar), and both ownership predicates are asked about it
    // when: the installer reconciles it
    // then: prune's predicate and the reconciler AGREE it is ours, and it is adopted
    const entry = join(IDE_AGENTS_DIR, AGENT_NAME);
    writeLegacyEntry({
      entryPath: entry,
      body: OLD_AGENT_BODY,
      vanishedSource: join(FAKE_HOME, 'package-1.0.0', 'agents', AGENT_NAME),
      kind: 'agent',
      name: AGENT_NAME
    });
    const store = storeMod;
    // The asymmetry this case pins: `isManagedEntry` says "ours" (so prune may delete
    // it) while the reconciler's link-only test said "not ours" (so it was skipped and
    // left frozen). One piece of evidence, two answers — the defect in one line.
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(store.isManagedEntry(entry)).toBe(true);

    const result = installAgents();

    expect(result.skipped).toEqual([]);
    expect(result.installed).toEqual([AGENT_NAME]);
    expect(readFileSync(entry, 'utf8')).toBe(NEW_AGENT_BODY);
    expect(readFileSync(`${entry}.peaks-managed`, 'utf8').trim()).toBe(
      join(CANONICAL_ROOT, 'agents', AGENT_NAME)
    );
    // And the adopted entry is still ours by the same predicate, now as a link.
    expect(store.isManagedEntry(entry)).toBe(true);
  });

  it('when the recorded agent package path is gone, should re-point provenance and install the new bytes', () => {
    // given: ~/.claude/agents/karpathy-reviewer.md is a real file of the previous
    //        version whose sidecar names a package path that no longer exists — the
    //        exact shape measured in the user's own `…\.peaks-managed` file
    // when: the installer runs against the package that ships the new version
    // then: the entry resolves to the canonical copy and carries the NEW bytes
    const entry = join(IDE_AGENTS_DIR, AGENT_NAME);
    const vanished = join(FAKE_HOME, 'package-1.0.0', 'agents', AGENT_NAME);
    writeLegacyEntry({
      entryPath: entry,
      body: OLD_AGENT_BODY,
      vanishedSource: vanished,
      kind: 'agent',
      name: AGENT_NAME
    });
    // Negative control: before the fix BOTH of these describe the failure — the
    // entry holds the old prompt and nothing in the fixture could produce the new
    // one, so the assertions after the run cannot be satisfied by a no-op.
    expect(readFileSync(entry, 'utf8')).toBe(OLD_AGENT_BODY);
    expect(existsSync(join(CANONICAL_ROOT, 'agents', AGENT_NAME))).toBe(false);

    const result = installAgents();

    const canonicalPath = join(CANONICAL_ROOT, 'agents', AGENT_NAME);
    expect(result.skipped).toEqual([]);
    expect(realpathSync(entry)).toBe(realpathSync(canonicalPath));
    expect(readFileSync(entry, 'utf8')).toBe(NEW_AGENT_BODY);
    // Provenance moved off the package path and onto the canonical store.
    expect(readFileSync(`${entry}.peaks-managed`, 'utf8').trim()).toBe(canonicalPath);
  });

  it('when the recorded output-style package path is gone, should re-point provenance and install the new bytes', () => {
    // given: ~/.claude/output-styles/peaks-skill-swarm.md is a real file of the
    //        previous version whose sidecar names a vanished package path
    // when: the installer runs against the package that ships the new version
    // then: the entry resolves to the canonical copy and carries the NEW bytes
    const entry = join(IDE_STYLES_DIR, STYLE_NAME);
    const vanished = join(FAKE_HOME, 'package-1.0.0', 'output-styles', STYLE_NAME);
    writeLegacyEntry({
      entryPath: entry,
      body: OLD_STYLE_BODY,
      vanishedSource: vanished,
      kind: 'output-style',
      name: STYLE_NAME
    });
    expect(readFileSync(entry, 'utf8')).toBe(OLD_STYLE_BODY);

    const result = installStyles();

    const canonicalPath = join(CANONICAL_ROOT, 'output-styles', STYLE_NAME);
    expect(result.skipped).toEqual([]);
    expect(realpathSync(entry)).toBe(realpathSync(canonicalPath));
    expect(readFileSync(entry, 'utf8')).toBe(NEW_STYLE_BODY);
    expect(readFileSync(`${entry}.peaks-managed`, 'utf8').trim()).toBe(canonicalPath);
  });

  it('when the recorded package path IS the installing package, should still upgrade the bytes', () => {
    // given: an in-place `npm i -g` — the sidecar names the very package path this run
    //        installs from, while the entry still holds the previous version's bytes
    // when: the installer runs
    // then: the entry is repaired onto the canonical copy with the NEW bytes
    const entry = join(IDE_AGENTS_DIR, AGENT_NAME);
    writeLegacyEntry({
      entryPath: entry,
      body: OLD_AGENT_BODY,
      vanishedSource: join(PACKAGE_ROOT, 'agents', AGENT_NAME),
      kind: 'agent',
      name: AGENT_NAME
    });

    const result = installAgents();

    const canonicalPath = join(CANONICAL_ROOT, 'agents', AGENT_NAME);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(entry, 'utf8')).toBe(NEW_AGENT_BODY);
    expect(realpathSync(entry)).toBe(realpathSync(canonicalPath));
  });

  it('when the recorded package path still exists, should leave the entry to the other live installation', () => {
    // given: a sidecar naming a package path that DOES resolve — a second live
    //        installation, not a stale one
    // when: a different package installs the asset of the same name
    // then: the entry is reported skipped and survives byte for byte, unlinked
    const entry = join(IDE_AGENTS_DIR, AGENT_NAME);
    const liveElsewhere = join(FAKE_HOME, 'other-install', 'agents', AGENT_NAME);
    mkdirSync(join(FAKE_HOME, 'other-install', 'agents'), { recursive: true });
    writeFileSync(liveElsewhere, '# somebody elses reviewer\n', 'utf8');
    writeLegacyEntry({
      entryPath: entry,
      body: OLD_AGENT_BODY,
      vanishedSource: liveElsewhere,
      kind: 'agent',
      name: AGENT_NAME
    });

    const result = installAgents();

    expect(result.skipped).toEqual([AGENT_NAME]);
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(readFileSync(entry, 'utf8')).toBe(OLD_AGENT_BODY);
  });
});

describe('Scenario: behavior — the real source of truth is a copy, the IDE entry is a link', () => {
  it('when a clean install runs, should store byte-equal real files and link the IDE entries at them', () => {
    // given: a package shipping one agent and one output style, and empty IDE dirs
    // when: both families are installed
    // then: the store holds real files and the IDE entries are links resolving there
    const agentsResult = installAgents();
    const stylesResult = installStyles();

    const canonicalAgent = join(CANONICAL_ROOT, 'agents', AGENT_NAME);
    const canonicalStyle = join(CANONICAL_ROOT, 'output-styles', STYLE_NAME);
    expect(agentsResult.installed).toEqual([AGENT_NAME]);
    expect(stylesResult.installed).toEqual([STYLE_NAME]);
    for (const canonicalPath of [canonicalAgent, canonicalStyle]) {
      expect(lstatSync(canonicalPath).isFile()).toBe(true);
      expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
    }
    expect(readFileSync(canonicalAgent, 'utf8')).toBe(NEW_AGENT_BODY);
    expect(readFileSync(canonicalStyle, 'utf8')).toBe(NEW_STYLE_BODY);
    // The IDE side is a link whose raw target IS the canonical path.
    expect(lstatSync(join(IDE_AGENTS_DIR, AGENT_NAME)).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(IDE_AGENTS_DIR, AGENT_NAME))).toBe(canonicalAgent);
    expect(realpathSync(join(IDE_AGENTS_DIR, AGENT_NAME))).toBe(realpathSync(canonicalAgent));
    expect(realpathSync(join(IDE_STYLES_DIR, STYLE_NAME))).toBe(realpathSync(canonicalStyle));
    // No fallback was taken, so nothing was degraded silently.
    expect(agentsResult.fallbacks).toEqual([]);
    expect(stylesResult.fallbacks).toEqual([]);
  });

  it('when the installer runs twice, should rewrite nothing and add no link the second time', () => {
    // given: one completed install of both families
    // when: both installers run again over the same home
    // then: no mtime moves, no prune fires and the reports are identical
    const firstAgents = installAgents();
    const firstStyles = installStyles();
    const before = mtimes(watchedPaths());

    const secondAgents = installAgents();
    const secondStyles = installStyles();

    expect(secondAgents.installed).toEqual(firstAgents.installed);
    expect(secondStyles.installed).toEqual(firstStyles.installed);
    expect(secondAgents.pruned).toEqual([]);
    expect(secondStyles.pruned).toEqual([]);
    expect(mtimes(watchedPaths())).toEqual(before);
  });
});

describe('Scenario: behavior — output styles stay single-target and still register', () => {
  it('when the bundled style is installed, should remain readable by the settings auto-register step', () => {
    // given: the style installed into ONE IDE directory, as the dispatch strategy requires
    // when: the auto-register step looks for the bundled style at that same target
    // then: it finds it through the link and writes outputStyle into settings.json
    const settingsFile = join(FAKE_HOME, 'settings.json');
    const otherIdeStyles = join(FAKE_HOME, '.trae', 'output-styles');
    installStyles();

    const registered = mod.installBundledOutputStyleDefault({
      targetRoot: IDE_STYLES_DIR,
      settingsFile
    });

    expect(registered.installed).toBe(true);
    expect(registered.outputStyle).toBe('peaks-skill-swarm');
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({
      outputStyle: 'peaks-skill-swarm'
    });
    // Single-target, stated as a filesystem fact: the second IDE dir was never written.
    expect(existsSync(otherIdeStyles)).toBe(false);
  });
});

describe('Scenario: integration — the new module ships with the installer', () => {
  it('when the installer imports a sibling module, should ship that module in the tarball', () => {
    // given: `scripts/install-skills.mjs` runs as the npm postinstall, so every
    //        module it imports must be listed in `package.json#files`
    // when: the published-file allowlist is read
    // then: the file-entry module is published alongside the store it writes into
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT_REPO, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(manifest.files).toContain('scripts/canonical-store.mjs');
    expect(manifest.files).toContain('scripts/canonical-store-link.mjs');
  });
});
