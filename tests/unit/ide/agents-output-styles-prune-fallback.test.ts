// tests/unit/ide/agents-output-styles-prune-fallback.test.ts
//
// SLICE 4 of `agents-canonical-store`: the DELETING half, and the half that must not
// pretend. Two things live here because both are about "what does the user's machine
// look like afterwards" rather than about the happy path.
//
// 1. PRUNE. The install loop only ever ADDS. Before slices 3 and 4, an agent or an
//    output style removed from the package left its canonical copy, its IDE entry and
//    both `.peaks-managed` sidecars on the machine forever. The whole risk of adding a
//    delete is the word "only": a prune one predicate too wide is, from outside,
//    indistinguishable from a correct one — both exit 0 and both leave a shorter
//    listing. So the NEGATIVE CONTROL is the first case in this file: a file the user
//    authored, with no sidecar, must survive byte for byte and must not be adopted.
//    Without it, "deleted the right thing" and "deleted too much" look the same.
//
// 2. THE COPY FALLBACK. On Windows a FILE symlink needs developer mode or
//    Administrator. When the host refuses one, the installer writes a real copy — and
//    the return value says so. This file measures that arm by forcing the refusal
//    through `options.createFileLink`, because this host permits symlinks and an arm
//    that cannot be reached here would be an arm nobody verified. A degradation that
//    carries no reason is indistinguishable from a success: that is the exact lesson
//    this slice must not repeat, so the fallback is asserted to be (a) a real copy,
//    (b) reported, and (c) reported on EVERY run, not only the first.
//
// NO REAL $HOME IS TOUCHED — same discipline as its sibling file: `$HOME` /
// `$USERPROFILE` are repointed at a throwaway directory before the import, `PEAKS_HOME`
// redirects the canonical root out of it, every call names its own `targetRoot` and
// `packageRoot`, and the platform fan-out is never called.
//
// Dimensions covered:
//   - behavior:    what prune deletes and keeps, and what the fallback reports
//   - integration: the real installer against a real package fixture and real links
//   - render:      OMITTED — a build script; its user-facing surface is postinstall stdout
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
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/agents-output-styles-prune-fallback.test.ts',
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
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'peaks-agents-prune-home-'));
const CANONICAL_ROOT = join(FAKE_HOME, 'canonical-store');
const PACKAGE_ROOT = join(FAKE_HOME, 'package-2.0.0');
const IDE_AGENTS_DIR = join(FAKE_HOME, '.claude', 'agents');
const IDE_STYLES_DIR = join(FAKE_HOME, '.claude', 'output-styles');
const BARE_PROJECT = join(FAKE_HOME, 'bare-project');

const KEPT_AGENT = 'karpathy-reviewer.md';
const RETIRED_AGENT = 'retired-reviewer.md';
const RETIRED_STYLE = 'retired-style.md';
const KEPT_STYLE = 'peaks-skill-swarm.md';
const USER_AGENT = 'my-own-notes.md';

const previousEnv: Record<string, string | undefined> = {
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
  PEAKS_HOME: process.env.PEAKS_HOME,
  PEAKS_PROJECT_ROOT: process.env.PEAKS_PROJECT_ROOT,
  PEAKS_SKIP_SKILL_INSTALL: process.env.PEAKS_SKIP_SKILL_INSTALL,
  PEAKS_SKIP_AGENT_INSTALL: process.env.PEAKS_SKIP_AGENT_INSTALL
};

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
    fallbacks: Array<{ name: string; mode: string; code: string | null; reason: string }>;
  };
  installBundledOutputStyles: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    pruned: string[];
    fallbacks: Array<{ name: string; mode: string; code: string | null; reason: string }>;
  };
};

function installAgents(
  options: Record<string, unknown> = {}
): ReturnType<typeof mod.installBundledAgents> {
  return mod.installBundledAgents({
    targetRoot: IDE_AGENTS_DIR,
    packageRoot: PACKAGE_ROOT,
    ...options
  });
}

function installStyles(
  options: Record<string, unknown> = {}
): ReturnType<typeof mod.installBundledOutputStyles> {
  return mod.installBundledOutputStyles({
    targetRoot: IDE_STYLES_DIR,
    packageRoot: PACKAGE_ROOT,
    ...options
  });
}

function shipAgent(name: string, body: string): void {
  mkdirSync(join(PACKAGE_ROOT, 'agents'), { recursive: true });
  writeFileSync(join(PACKAGE_ROOT, 'agents', name), body, 'utf8');
}

function shipStyle(name: string, body: string): void {
  mkdirSync(join(PACKAGE_ROOT, 'output-styles'), { recursive: true });
  writeFileSync(join(PACKAGE_ROOT, 'output-styles', name), body, 'utf8');
}

/** The refusal a Windows host without developer mode really returns. */
function refuseSymlink(): never {
  const error = new Error('EPERM: operation not permitted, symlink') as Error & { code: string };
  error.code = 'EPERM';
  throw error;
}

const mtimes = (paths: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const path of paths) out[path] = lstatSync(path).mtimeMs;
  return out;
};

beforeEach(() => {
  rmSync(CANONICAL_ROOT, { recursive: true, force: true });
  rmSync(join(FAKE_HOME, '.claude'), { recursive: true, force: true });
  rmSync(PACKAGE_ROOT, { recursive: true, force: true });
  mkdirSync(IDE_AGENTS_DIR, { recursive: true });
  mkdirSync(IDE_STYLES_DIR, { recursive: true });
  shipAgent(KEPT_AGENT, '# reviewer v2\n');
  shipStyle(KEPT_STYLE, '# style v2\n');
});

describe('Scenario: behavior — prune only ever removes what peaks-loop owns', () => {
  it('when a user file shares the agents directory, should survive byte for byte with no sidecar', () => {
    // given: ~/.claude/agents/my-own-notes.md is a file the user authored, with no
    //        `.peaks-managed` sidecar — the shape prune must never be able to take
    // when: the installer reconciles and prunes that directory
    // then: the file is untouched, still not a link, and was not adopted either
    const userFile = join(IDE_AGENTS_DIR, USER_AGENT);
    writeFileSync(userFile, '# notes I wrote myself\n', 'utf8');

    const result = installAgents();

    expect(result.pruned).toEqual([]);
    expect(existsSync(userFile)).toBe(true);
    expect(lstatSync(userFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(userFile, 'utf8')).toBe('# notes I wrote myself\n');
    // The proof that it was not adopted: no sidecar appeared beside it.
    expect(existsSync(`${userFile}.peaks-managed`)).toBe(false);
  });

  it('when a user file carries a bundled agent name, should be skipped rather than replaced', () => {
    // given: ~/.claude/agents/karpathy-reviewer.md is a real file the user authored
    //        under a name the package DOES ship, with no `.peaks-managed` sidecar
    // when: the installer reconciles that directory
    // then: the user's bytes survive, the entry is reported skipped and stays unlinked
    const userFile = join(IDE_AGENTS_DIR, KEPT_AGENT);
    writeFileSync(userFile, '# my own reviewer prompt\n', 'utf8');

    const result = installAgents();

    expect(result.skipped).toEqual([KEPT_AGENT]);
    expect(lstatSync(userFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(userFile, 'utf8')).toBe('# my own reviewer prompt\n');
    expect(existsSync(`${userFile}.peaks-managed`)).toBe(false);
  });

  it('when a user tree under the canonical store keeps a retired name, should not be deleted', () => {
    // given: ~/.peaks/agents/<retired name> is a real DIRECTORY the user authored,
    //        with no sidecar — the shape `~/.peaks/agents/ecc` really has today
    // when: prune walks the canonical store and the package no longer ships that name
    // then: the user's tree survives and only the bundled entry is listed as pruned
    const userDir = join(CANONICAL_ROOT, 'agents', RETIRED_AGENT);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'NOTES.md'), '# mine, 69 entries in spirit\n', 'utf8');

    const result = installAgents();

    expect(readFileSync(join(userDir, 'NOTES.md'), 'utf8')).toBe('# mine, 69 entries in spirit\n');
    expect(existsSync(`${userDir}.peaks-managed`)).toBe(false);
    expect(result.installed).toEqual([KEPT_AGENT]);
  });

  it('when the package stops shipping an agent, should delete its copy, its link and both sidecars', () => {
    // given: an agent installed into the store and linked into an IDE directory
    // when: the package drops it entirely and the installer runs again
    // then: all four artefacts are gone, the still-shipped agent is intact
    shipAgent(RETIRED_AGENT, '# retired\n');
    const first = installAgents();
    const storeCopy = join(CANONICAL_ROOT, 'agents', RETIRED_AGENT);
    const ideEntry = join(IDE_AGENTS_DIR, RETIRED_AGENT);
    // Negative control for THIS arm: the artefacts exist before the prune, so the
    // absences asserted below cannot be satisfied by a run that never installed.
    expect(existsSync(storeCopy)).toBe(true);
    expect(existsSync(`${storeCopy}.peaks-managed`)).toBe(true);
    expect(existsSync(ideEntry)).toBe(true);
    expect(existsSync(`${ideEntry}.peaks-managed`)).toBe(true);
    expect([...first.installed].sort()).toEqual([KEPT_AGENT, RETIRED_AGENT].sort());

    rmSync(join(PACKAGE_ROOT, 'agents', RETIRED_AGENT), { force: true });
    const second = installAgents();

    expect(existsSync(storeCopy)).toBe(false);
    expect(existsSync(`${storeCopy}.peaks-managed`)).toBe(false);
    expect(existsSync(ideEntry)).toBe(false);
    expect(existsSync(`${ideEntry}.peaks-managed`)).toBe(false);
    expect(second.pruned.some((entry) => entry.endsWith(RETIRED_AGENT))).toBe(true);
    // The positive control: the package still ships this one, so it is untouched.
    expect(readFileSync(join(CANONICAL_ROOT, 'agents', KEPT_AGENT), 'utf8')).toBe(
      '# reviewer v2\n'
    );
    expect(realpathSync(join(IDE_AGENTS_DIR, KEPT_AGENT))).toBe(
      realpathSync(join(CANONICAL_ROOT, 'agents', KEPT_AGENT))
    );
  });

  it('when the package stops shipping an output style, should delete its copy, its entry and both sidecars', () => {
    // given: an output style installed into the store and linked into an IDE directory
    // when: the package drops it entirely and the installer runs again
    // then: all four artefacts are gone and the still-shipped style is intact
    shipStyle(RETIRED_STYLE, '# retired style\n');
    installStyles();
    const storeCopy = join(CANONICAL_ROOT, 'output-styles', RETIRED_STYLE);
    const ideEntry = join(IDE_STYLES_DIR, RETIRED_STYLE);
    expect(existsSync(storeCopy)).toBe(true);
    expect(existsSync(ideEntry)).toBe(true);

    rmSync(join(PACKAGE_ROOT, 'output-styles', RETIRED_STYLE), { force: true });
    const result = installStyles();

    expect(existsSync(storeCopy)).toBe(false);
    expect(existsSync(`${storeCopy}.peaks-managed`)).toBe(false);
    expect(existsSync(ideEntry)).toBe(false);
    expect(existsSync(`${ideEntry}.peaks-managed`)).toBe(false);
    expect(result.pruned.some((entry) => entry.endsWith(RETIRED_STYLE))).toBe(true);
    expect(readFileSync(join(IDE_STYLES_DIR, KEPT_STYLE), 'utf8')).toBe('# style v2\n');
  });

  it('when nothing has been retired, should report no prune and leave the directory listing alone', () => {
    // given: one completed install of both families
    // when: the installers run again with the package unchanged
    // then: prune reports nothing and the IDE directories list exactly what they did
    installAgents();
    installStyles();
    const agentsListing = readdirSync(IDE_AGENTS_DIR).sort();
    const stylesListing = readdirSync(IDE_STYLES_DIR).sort();

    const agents = installAgents();
    const styles = installStyles();

    expect(agents.pruned).toEqual([]);
    expect(styles.pruned).toEqual([]);
    expect(readdirSync(IDE_AGENTS_DIR).sort()).toEqual(agentsListing);
    expect(readdirSync(IDE_STYLES_DIR).sort()).toEqual(stylesListing);
  });
});

describe('Scenario: behavior — a refused symlink is reported, not swallowed', () => {
  it('when the host refuses the symlink, should write a real copy and say so in the result', () => {
    // given: a host whose file symlink call fails the way Windows does without
    //        developer mode
    // when: the installer reconciles an agent and an output style
    // then: both land as real copies, both are reported as fallbacks, code and all
    const agents = installAgents({ createFileLink: refuseSymlink });
    const styles = installStyles({ createFileLink: refuseSymlink });

    const agentEntry = join(IDE_AGENTS_DIR, KEPT_AGENT);
    expect(agents.installed).toEqual([KEPT_AGENT]);
    expect(lstatSync(agentEntry).isSymbolicLink()).toBe(false);
    expect(readFileSync(agentEntry, 'utf8')).toBe('# reviewer v2\n');
    expect(readFileSync(agentEntry, 'utf8')).toBe(
      readFileSync(join(CANONICAL_ROOT, 'agents', KEPT_AGENT), 'utf8')
    );
    expect(agents.fallbacks).toHaveLength(1);
    expect(agents.fallbacks[0]?.name).toBe(KEPT_AGENT);
    expect(agents.fallbacks[0]?.mode).toBe('copy');
    expect(agents.fallbacks[0]?.code).toBe('EPERM');
    expect(agents.fallbacks[0]?.reason).toContain(agentEntry);
    expect(styles.fallbacks).toHaveLength(1);
    expect(styles.fallbacks[0]?.mode).toBe('copy');
    // The entry is still OURS — the fallback writes the canonical provenance, so a
    // later run can find and update it rather than treating it as user-authored.
    expect(readFileSync(`${agentEntry}.peaks-managed`, 'utf8').trim()).toBe(
      join(CANONICAL_ROOT, 'agents', KEPT_AGENT)
    );
  });

  it('when the host permits the symlink, should link instead — the control for the arm above', () => {
    // given: the same fixture with the real symlink call in place
    // when: the installer reconciles the same agent
    // then: the entry IS a link, so the fallback assertions above measure a difference
    const result = installAgents();

    const agentEntry = join(IDE_AGENTS_DIR, KEPT_AGENT);
    expect(lstatSync(agentEntry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(agentEntry)).toBe(join(CANONICAL_ROOT, 'agents', KEPT_AGENT));
    expect(result.fallbacks).toEqual([]);
  });

  it('when a fallback copy is already current, should move no mtime and still report the fallback', () => {
    // given: an entry that a previous run had to write as a real copy
    // when: the installer runs again on the same host
    // then: nothing is rewritten and the degradation is reported again, not once
    installAgents({ createFileLink: refuseSymlink });
    const watched = [
      join(IDE_AGENTS_DIR, KEPT_AGENT),
      join(IDE_AGENTS_DIR, `${KEPT_AGENT}.peaks-managed`),
      join(CANONICAL_ROOT, 'agents', KEPT_AGENT)
    ];
    const before = mtimes(watched);

    const second = installAgents({ createFileLink: refuseSymlink });

    expect(mtimes(watched)).toEqual(before);
    expect(second.fallbacks).toHaveLength(1);
    expect(second.fallbacks[0]?.mode).toBe('copy');
  });

  it('when the package ships new bytes, should update the fallback copy as well', () => {
    // given: a host that writes real copies, and an installed agent
    // when: the package ships new content for it
    // then: the copy carries the new bytes — the fallback does NOT freeze the entry
    installAgents({ createFileLink: refuseSymlink });
    shipAgent(KEPT_AGENT, '# reviewer v3\n');

    const result = installAgents({ createFileLink: refuseSymlink });

    expect(readFileSync(join(IDE_AGENTS_DIR, KEPT_AGENT), 'utf8')).toBe('# reviewer v3\n');
    expect(readFileSync(join(CANONICAL_ROOT, 'agents', KEPT_AGENT), 'utf8')).toBe(
      '# reviewer v3\n'
    );
    expect(result.fallbacks).toHaveLength(1);
  });
});
