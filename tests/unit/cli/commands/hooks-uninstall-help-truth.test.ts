// tests/unit/cli/commands/hooks-uninstall-help-truth.test.ts
//
// WHY THIS FILE EXISTS.
//
// `peaks hooks uninstall --help` described an effect the command does not
// have, in the same class as the install-side fix that landed beside it:
//
//   A. the description said it removes "the peaks-managed gate-enforce hook
//      entry" — but an install writes SEVERAL peaks-managed entries, and the
//      uninstall strips every one of them.
//
//   B. the doc comment on `HookInstallOptions.skipProgress` said the install
//      "only ever emits the gate-enforce entry" — the same false claim, on the
//      type that carries the flag.
//
// WHAT IS PINNED HERE, AND WHY IT IS READ FROM THE CODE. The install-side fix
// pinned the entry LIST structurally: each description must name every
// sentinel the resolver yields, and must not name a sentinel only the legacy
// set carries. That pin did not reach the uninstall description nor the option
// type's doc comment, so the two texts that carry this defect class were free
// to drift again. This file closes that gap, reading the truth from the code
// rather than from a hand-written list:
//
//   - `resolveHookEntries` — what an install writes;
//   - `resolveLegacySentinels` — what the uninstall strips.
//
// The four arms:
//
//   1. the uninstall description names every entry an install writes;
//   2. the uninstall description names no peaks command the uninstall does
//      not strip;
//   3. the option type's doc comment names every entry an install writes, and
//      no longer claims the install emits one entry;
//   4. a live install followed by a live uninstall leaves no peaks-managed
//      entry behind — the behavioural fact the words above describe.
//
// Arm 4 is why the prose is not the only witness: the descriptions are checked
// against the code, and the code is checked against the disk.
//
// A doc comment is not visible at runtime, so arm 3 reads the source file.
// That is the only way to hold prose honest about a list that lives in
// another file.
//
// Style: BDD given/when/then per the peaks-loop 4.0.11+ contract.

import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerHooksUninstallCommand } from '../../../../src/cli/commands/hooks-uninstall-command.js';
import {
  hasHookSpec,
  resolveHookEntries,
  resolveLegacySentinels
} from '../../../../src/services/skills/hooks-codegate-superpowers.js';
import { listAdapterIds } from '../../../../src/services/ide/ide-registry.js';
import {
  applyHookInstall,
  removeHookInstall
} from '../../../../src/services/skills/hooks-settings-service.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/cli/commands/hooks-uninstall-help-truth.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The repository root, four levels up from this file. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The adapter whose installed set is the one the descriptions enumerate. */
const IDE = 'claude-code' as const;

/** Every distinct sentinel an install writes for the adapter. */
const INSTALLED_SENTINELS: ReadonlyArray<string> = [
  ...new Set(resolveHookEntries(IDE).map((entry) => entry.sentinel))
];

/** Every sentinel the uninstall strips for the adapter. */
const REMOVED_SENTINELS: ReadonlyArray<string> = resolveLegacySentinels(IDE);

/**
 * Every sentinel the codebase knows, across the adapters that can host a hook.
 * A sentinel outside the removal set belongs to another adapter, so naming it
 * in the Claude Code texts would be a claim about an entry that is not there.
 */
const ALL_SENTINELS: ReadonlyArray<string> = [
  ...new Set(
    listAdapterIds()
      .filter((ide) => hasHookSpec(ide))
      .flatMap((ide) => [
        ...resolveHookEntries(ide).map((entry) => entry.sentinel),
        ...resolveLegacySentinels(ide)
      ])
  )
];

/** The sentinels neither the install nor the uninstall touches for this adapter. */
const FOREIGN_SENTINELS: ReadonlyArray<string> = ALL_SENTINELS.filter(
  (sentinel) => !REMOVED_SENTINELS.includes(sentinel)
);

/**
 * The uninstall command's own description, as Commander holds it — the string
 * `--help` prints.
 */
function uninstallDescription(): string {
  const hooks = new Command('hooks');
  registerHooksUninstallCommand(hooks, makeCapturedIo().io);
  const uninstall = hooks.commands.find((cmd) => cmd.name() === 'uninstall');
  if (!uninstall) throw new Error('the hooks uninstall command was not registered');
  return uninstall.description();
}

/** The doc comment that sits above the `skipProgress` field. */
function skipProgressDoc(): string {
  const source = readFileSync(
    join(REPO_ROOT, 'src', 'services', 'skills', 'hooks-settings-types.ts'),
    'utf8'
  );
  const field = source.indexOf('readonly skipProgress?: boolean;');
  if (field === -1) throw new Error('the skipProgress field is gone from the options type');
  const before = source.slice(0, field);
  const start = before.lastIndexOf('/**');
  if (start === -1) throw new Error('the skipProgress field carries no doc comment');
  return before.slice(start);
}

/** The scratch directories this file creates, removed when a test ends. */
const scratchDirs: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

/** Every JSON settings file the install wrote under the project. */
function projectSettingsText(project: string): string {
  const dir = join(project, '.claude');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}

afterEach(() => {
  process.exitCode = 0;
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('render — the help of `peaks hooks uninstall`', () => {
  it('when the uninstall help is rendered, should name every entry the uninstall strips', () => {
    // given: the uninstall command as Commander holds it
    // when:  the rendered help is read
    // then:  it names every entry an install writes, and no legacy-only one
    const help = uninstallDescription();
    for (const sentinel of INSTALLED_SENTINELS) {
      expect(help, sentinel).toContain(sentinel);
    }
    // the legacy progress-start command is not one the current install writes,
    // so the help names that leftover in prose rather than as a command
    expect(help).not.toContain('peaks progress start');
  });

  it('when the uninstall help is rendered, should name no entry it does not strip', () => {
    // given: the description and the sentinels of every adapter
    // when:  each sentinel the codebase knows is checked against the text
    // then:  no sentinel belonging to another adapter is named
    const description = uninstallDescription();
    expect(FOREIGN_SENTINELS.length).toBeGreaterThan(0);
    for (const sentinel of FOREIGN_SENTINELS) {
      expect(description, sentinel).not.toContain(sentinel);
    }
  });
});

describe('behavior — the entry set the uninstall really removes', () => {
  it('when the two sentinel sets are compared, should every installed entry be removable', () => {
    // given: the sentinels an install writes and the ones the uninstall strips
    // when:  the installed set is checked against the removed set
    // then:  every installed entry is in the removed set
    for (const sentinel of INSTALLED_SENTINELS) {
      expect(REMOVED_SENTINELS, sentinel).toContain(sentinel);
    }
  });

  it('when an install is followed by an uninstall, should leave no peaks entry behind', () => {
    // given: a scratch home and a scratch project
    // when:  the install writes its entries and the uninstall strips them
    // then:  the install wrote every entry the descriptions name, and the
    //        uninstall removed every one of them
    const home = scratch('peaks-hooks-home-');
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    const project = scratch('peaks-hooks-project-');
    applyHookInstall('project', project, { ide: IDE });
    const afterInstall = projectSettingsText(project);
    removeHookInstall('project', project, { ide: IDE });
    const afterUninstall = projectSettingsText(project);
    for (const sentinel of INSTALLED_SENTINELS) {
      expect(afterInstall, sentinel).toContain(sentinel);
    }
    for (const sentinel of INSTALLED_SENTINELS) {
      expect(afterUninstall, sentinel).not.toContain(sentinel);
    }
  });
});

describe('a11y — the words a human reads', () => {
  it('when the uninstall description is read, should not claim it removes one entry', () => {
    // given: the uninstall description
    // when:  it is read for a claim about how much it removes
    // then:  it never narrows the set to a single entry
    const description = uninstallDescription();
    expect(description).not.toMatch(/\bonly\b/i);
    expect(description).not.toMatch(/only the gate-enforce/i);
    // ...and it does not narrow the removal to the one entry the old text named
    expect(description).not.toMatch(/the peaks-managed gate-enforce hook entry/i);
    expect(description).toMatch(/\bhook entries\b/i);
  });

  it('when the option type is read, should describe the whole entry set', () => {
    // given: the doc comment on the retained install option
    // when:  it is read for a claim about what an install writes
    // then:  it names every entry an install writes and narrows nothing
    const doc = skipProgressDoc();
    for (const sentinel of INSTALLED_SENTINELS) {
      expect(doc, sentinel).toContain(sentinel);
    }
    expect(doc).not.toMatch(/only ever emits/i);
    expect(doc).not.toMatch(/only the gate-enforce/i);
    expect(doc).not.toContain('peaks progress start');
    // ...and it names no entry that belongs to another adapter
    for (const sentinel of FOREIGN_SENTINELS) {
      expect(doc, sentinel).not.toContain(sentinel);
    }
  });
});
