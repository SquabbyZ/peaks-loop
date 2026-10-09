// tests/unit/cli/commands/mcp-registration-commands.test.ts
//
// The `peaks mcp install` / `peaks mcp uninstall` surface (PRD rid-037 AC-6).
//
//   AC-6  `uninstall` is an EXPLICIT command, not a package-manager hook. The
//         claim is about the CLI shape: the verb exists, it is reachable, and it
//         carries the same targeting options as its install twin.
//
// THIS FILE TESTS THE DECLARATION, NOT THE RUN. The behaviour behind the verbs
// is the registration engine's, and it is asserted in
// `tests/unit/services/distribution/mcp-install.test.ts` against injected
// adapters and an injected runner. Reaching through the declaration here would
// spawn a real harness's entry point, which is exactly what no test in this repo
// should do. What CAN be decided from the declaration — that the verbs exist,
// were not renamed, and derive their help from the registry — is decided here.
//
// The `serve` verb is asserted unchanged alongside them: a sibling added to the
// same command family is the shape that quietly changes another one's surface.
//
// Dimensions covered: render, behavior, integration, a11y.

import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';

import { createProgram } from '~/src/cli/program';
import { listAdapterIds } from '~/src/services/ide/ide-registry';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/cli/commands/mcp-registration-commands.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

function commandAt(program: Command, path: readonly string[]): Command {
  let current: Command | undefined = program;
  for (const name of path) {
    current = current.commands.find((candidate) => candidate.name() === name);
    if (current === undefined) throw new Error(`no such command: ${path.join(' ')}`);
  }
  return current;
}

function descriptionOf(program: Command, path: readonly string[]): string {
  return commandAt(program, path).description();
}

/** The declared help text of one long option — read from the option, not the wrapped help. */
function optionHelp(program: Command, path: readonly string[], long: string): string {
  const option = commandAt(program, path).options.find((candidate) => candidate.long === long);
  if (option === undefined) throw new Error(`no such option: ${path.join(' ')} ${long}`);
  return option.description;
}

const REGISTRATION_VERBS = ['install', 'uninstall'] as const;

describe('Scenario: render - the mcp family carries serve plus the registration pair', () => {
  it('when the mcp command is read, should list serve, install and uninstall', () => {
    // given: the program the CLI actually registers
    // when:  the mcp subcommands are enumerated
    // then:  the two new verbs sit beside `serve`, which is unchanged
    const names = commandAt(createProgram(), ['mcp'])
      .commands.map((child) => child.name())
      .sort();
    expect(names).toEqual(['install', 'serve', 'uninstall']);
  });

  it('when each registration verb is read, should be a command of its own', () => {
    // given: the two verbs
    // when:  each is resolved by path
    // then:  neither is an alias or a flag on another command
    for (const verb of REGISTRATION_VERBS) {
      const command = commandAt(createProgram(), ['mcp', verb]);
      expect(command.name()).toBe(verb);
    }
  });
});

describe('Scenario: behavior - the two verbs target the same way', () => {
  it('when either verb is invoked, should accept the same ide and json options', () => {
    // given: the pair
    // when:  their declared options are compared
    // then:  they match, so a caller does not have to learn two targeting surfaces
    const [install, uninstall] = REGISTRATION_VERBS.map((verb) =>
      commandAt(createProgram(), ['mcp', verb])
        .options.map((option) => option.long)
        .sort()
    );
    expect(install).toEqual(['--ide', '--json']);
    expect(uninstall).toEqual(install);
  });

  it('when serve is declared, should still take the project option it always took', () => {
    // given: the pre-existing verb
    // when:  its options are read
    // then:  they are unchanged, because this slice adds and does not migrate
    expect(
      commandAt(createProgram(), ['mcp', 'serve'])
        .options.map((option) => option.long)
        .sort()
    ).toEqual(['--project']);
  });
});

describe('Scenario: integration - the option help is derived from the adapter registry', () => {
  it('when the ide option help is read, should name every registered adapter', () => {
    // given: the registry, which is the only list of the values `--ide` accepts
    // when:  the option's own help text is read
    // then:  it names them all, so adding an adapter cannot leave a stale list —
    //        the failure mode `resolveIdeOptionHelp` exists to prevent
    const registered = listAdapterIds();
    expect(registered.length).toBeGreaterThan(0);
    for (const verb of REGISTRATION_VERBS) {
      const help = optionHelp(createProgram(), ['mcp', verb], '--ide');
      for (const id of registered) {
        expect(help, `${verb} help names ${id}`).toContain(id);
      }
    }
  });
});

describe('Scenario: a11y - the help states what a silent skip means and why there is a sweep', () => {
  it('when the install help is read, should say an undeclared harness is skipped', () => {
    // given: the install verb
    // when:  its own description is read
    // then:  the skip is stated, because "nothing happened" without a stated
    //        reason is indistinguishable from a broken install
    expect(descriptionOf(createProgram(), ['mcp', 'install'])).toMatch(/skipped, not failed/);
  });

  it('when the uninstall help is read, should say it sweeps every scope and why it is explicit', () => {
    // given: the uninstall verb
    // when:  its own description is read
    // then:  both facts a user needs are present: it sweeps, and it exists rather
    //        than hiding behind a package-manager hook
    const help = descriptionOf(createProgram(), ['mcp', 'uninstall']);
    expect(help).toMatch(/sweeping every scope/);
    expect(help).toMatch(/no package-manager hook is relied on/);
  });
});
