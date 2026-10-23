// tests/unit/cli/commands/hooks-install-help-truth.test.ts
//
// WHY THIS FILE EXISTS.
//
// `peaks hooks install --help` used to describe two things the command does
// not do:
//
//   A. `--no-progress` promised "install ONLY the gate-enforce entry". The
//      flag is a NO-OP: `resolveHookEntries` takes a progress parameter and
//      never reads it (the progress-start entry was removed on purpose in
//      slice #014), and the flag itself is published CLI surface that must
//      keep being accepted.
//
//   B. the install description said the command writes the adapter's
//      settings.json and nothing else. A `--global` install ALSO copies the
//      two hook scripts and writes the package-root pointer into the
//      USER-GLOBAL `~/.claude/skills/peaks-code/hooks/` directory — the side
//      effect a reader of `--help` had no way to learn.
//
// WHAT IS PINNED HERE, AND WHY THIS SHAPE. The prose arms are
// missing-mention assertions: the text must NAME the global copy and its
// target directory, must describe `--no-progress` as a compatibility no-op,
// and must not claim the flag installs "ONLY the gate-enforce entry". Such an
// assertion survives rewording, but it is blind to a NEW entry the install
// gains — so the entry LIST is pinned structurally instead: each description
// must name every sentinel `resolveHookEntries` produces and must not name a
// sentinel only the legacy set carries. Both directions are read from the
// CODE, so the text cannot drift without a case here failing.
//
// The filesystem arms are here because a documentation fix that changes
// behaviour is not a documentation fix: the install must still write exactly
// the same files, and `--no-progress` must still be accepted and change
// nothing.
//
// Style: BDD given/when/then per the peaks-loop 4.0.11+ contract.

import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerHooksCommands } from '../../../../src/cli/commands/hooks-commands.js';
import {
  hasHookSpec,
  resolveHookEntries,
  resolveLegacySentinels
} from '../../../../src/services/skills/hooks-codegate-superpowers.js';
import { listAdapterIds } from '../../../../src/services/ide/ide-registry.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/cli/commands/hooks-install-help-truth.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The user-global directory a `--global` install copies the hook scripts into. */
const USER_GLOBAL_HOOKS_DIR = ['.claude', 'skills', 'peaks-code', 'hooks'] as const;

/** The two scripts the global copy carries, plus the package-root pointer. */
const GLOBAL_COPIES = [
  'pre-tool-code-gate.sh',
  'pre-tool-superpowers-bridge.sh',
  'pre-tool-code-gate.package-root'
] as const;

/** Every adapter the registry knows, minus the ones that can host no hook. */
const HOOKABLE_IDES = listAdapterIds().filter((ide) => hasHookSpec(ide));

/** The `hooks` command as Commander holds it — the surface `--help` renders. */
function hooksCommand(): Command {
  const program = new Command();
  registerHooksCommands(program, makeCapturedIo().io);
  const hooks = program.commands.find((cmd) => cmd.name() === 'hooks');
  if (!hooks) throw new Error('the hooks command was not registered');
  return hooks;
}

/** The `hooks install` sub-command. */
function installCommand(): Command {
  const install = hooksCommand().commands.find((cmd) => cmd.name() === 'install');
  if (!install) throw new Error('the hooks install command was not registered');
  return install;
}

/** The `--no-progress` option's own help text (unwrapped). */
function noProgressHelp(): string {
  const option = installCommand().options.find((opt) => opt.long === '--no-progress');
  if (!option) throw new Error('the --no-progress option was not registered');
  return option.description;
}

/** Run the REAL install command in-process and return its JSON envelope. */
async function runInstall(
  args: readonly string[],
  projectRoot: string
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerHooksCommands(program, io);
  await program.parseAsync([
    'node',
    'peaks',
    'hooks',
    'install',
    '--ide',
    'claude-code',
    '--project',
    projectRoot,
    '--json',
    ...args
  ]);
  return JSON.parse(captured.text()) as { ok: boolean; data: Record<string, unknown> };
}

/** A fresh scratch directory, removed when the test ends. */
const scratchDirs: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

// Every scratch directory goes when its test ends, whichever describe made it,
// and the install action's failure exit code never leaks into the run.
afterEach(() => {
  process.exitCode = 0;
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('render — the help text of `peaks hooks install`', () => {
  it('when the help is rendered, should name the global copy and its target directory', () => {
    // given: the command as Commander holds it
    // when: the help is rendered the way `--help` renders it
    // then: the user-global copy and where it lands are both named
    const install = installCommand();
    const help = install.helpInformation();
    expect(help).toContain('~/.claude/skills/peaks-code/hooks/');
    expect(help).toContain('pre-tool-code-gate.sh');
    expect(help).toContain('pre-tool-superpowers-bridge.sh');
    expect(help).toContain('pre-tool-code-gate.package-root');
    // ...and the scope that does NOT copy is named too
    expect(help).toContain('user-global');
    expect(help).toMatch(/project scope copies nothing/i);
  });

  it('when the help is rendered, should still offer the --no-progress flag', () => {
    // given: the command as Commander holds it
    // when: the declared options are read
    // then: the published flag is still there — removing it is a breaking change
    const install = installCommand();
    const longs = install.options.map((opt) => opt.long);
    expect(longs).toContain('--no-progress');
  });
});

describe('behavior — the progress parameter of the entry resolver', () => {
  it('when the progress parameter is flipped, should the resolved entry set stay the same', () => {
    // given: every adapter that can host a hook
    // when: the resolver is asked for the entries with and without the flag
    // then: the two calls agree — this is the fact that makes the flag a no-op
    expect(HOOKABLE_IDES.length).toBeGreaterThan(0);
    for (const ide of HOOKABLE_IDES) {
      expect(resolveHookEntries(ide, true), `ide '${ide}'`).toEqual(resolveHookEntries(ide, false));
    }
  });

  it('when --no-progress is passed, should the install be accepted and write the same files', async () => {
    // given: two scratch projects and a scratch home
    // when: the install runs once with the flag and once without
    // then: the flag was accepted, and it changed nothing
    const home = scratch('peaks-hooks-home-');
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    const withFlagProject = scratch('peaks-hooks-project-a-');
    const withoutFlagProject = scratch('peaks-hooks-project-b-');
    const withFlag = await runInstall(['--no-progress'], withFlagProject);
    const withoutFlag = await runInstall([], withoutFlagProject);
    expect(withFlag.ok).toBe(true);
    expect(withoutFlag.ok).toBe(true);
    expect(withFlag.data.skipProgress).toBe(true);
    expect(withoutFlag.data.skipProgress).toBe(false);
    expect(withFlag.data.entries).toEqual(withoutFlag.data.entries);
    expect(readFileSync(join(withFlagProject, '.claude', 'settings.json'), 'utf8')).toBe(
      readFileSync(join(withoutFlagProject, '.claude', 'settings.json'), 'utf8')
    );
  });
});

describe('integration — the files the install writes', () => {
  it('when the project scope is installed, should only the project settings files change', async () => {
    // given: a scratch home and a scratch project
    // when: the project-scoped install runs
    // then: the project's own settings files are written
    const home = scratch('peaks-hooks-home-');
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    const project = scratch('peaks-hooks-project-');
    const result = await runInstall([], project);
    expect(result.ok).toBe(true);
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(project, '.claude', 'settings.local.json'))).toBe(true);
    // ...and nothing is copied into the user-global directory
    expect(existsSync(join(home, ...USER_GLOBAL_HOOKS_DIR))).toBe(false);
  });

  it('when the global scope is installed, should the user-global settings file and the copies be written', async () => {
    // given: a scratch home and a scratch project
    // when: the global-scoped install runs
    // then: the user-global settings file is written
    const home = scratch('peaks-hooks-home-');
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    const project = scratch('peaks-hooks-project-');
    const result = await runInstall(['--global'], project);
    expect(result.ok).toBe(true);
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(true);
    // ...and the two hook scripts plus the package-root pointer are copied
    for (const name of GLOBAL_COPIES) {
      expect(existsSync(join(home, ...USER_GLOBAL_HOOKS_DIR, name)), name).toBe(true);
    }
    // ...and the project is left alone by the global scope
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(false);
  });
});

describe('a11y — the words a human reads', () => {
  it('when the --no-progress help is read, should it say the flag has no effect and why it stays', () => {
    // given: the option's own help text
    // when: it is read
    // then: it says the flag is a compatibility no-op, not an installer
    const help = noProgressHelp();
    expect(help).toMatch(/backward compatibility/i);
    expect(help).toMatch(/no-op/i);
    // ...and it does NOT claim the flag installs only the gate-enforce entry
    expect(help).not.toMatch(/ONLY the gate-enforce/i);
    expect(help).not.toMatch(/skip the progress-start/i);
  });

  it('when each description is read, should it name every entry the install actually writes', () => {
    // given: the live sentinels and the legacy-only ones
    // when: both descriptions are read
    // then: every live entry is named — a new entry cannot slip in unnoticed
    const live = new Set(resolveHookEntries('claude-code').map((entry) => entry.sentinel));
    const legacyOnly = resolveLegacySentinels('claude-code').filter(
      (sentinel) => !live.has(sentinel)
    );
    expect(live.size).toBeGreaterThan(1);
    expect(legacyOnly.length).toBeGreaterThan(0);
    for (const description of [installCommand().description(), hooksCommand().description()]) {
      for (const sentinel of live) {
        expect(description, sentinel).toContain(sentinel);
      }
      // ...and no removed entry is named
      for (const sentinel of legacyOnly) {
        expect(description, sentinel).not.toContain(sentinel);
      }
    }
  });

  it('when the descriptions are read, should they not claim the gate-enforce entry is the only one', () => {
    // given: the two descriptions
    // when: they are read
    // then: neither claims the install writes only the gate-enforce entry
    for (const description of [installCommand().description(), hooksCommand().description()]) {
      expect(description).not.toMatch(/only the gate-enforce/i);
      expect(description).not.toMatch(/the only installed entry/i);
    }
  });
});
