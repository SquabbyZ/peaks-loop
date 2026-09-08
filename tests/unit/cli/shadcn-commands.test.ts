// Slice B2 (2026-09-09-ecc-dynamic-and-cleanup) — `peaks shadcn init`.
// The skill references at skills/bee/peaks-rd/SKILL.md and
// references/frontend-project-generation.md require this command to exist.
// It is a dynamic wrapper: the upstream CLI is obtained via
// `npx --package shadcn@<pin>` so no hard dependency is added.

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { makeCapturedIo } from '../_setup/io.js';
import {
  SHADCN_PACKAGE,
  buildShadcnInitArgs,
  registerShadcnCommands
} from '~/src/cli/commands/shadcn-commands';

describe('buildShadcnInitArgs', () => {
  it('pins the upstream package and forwards preset via npx --package', () => {
    const args = buildShadcnInitArgs({ preset: 'abc123' });
    expect(args).toEqual(['--package', SHADCN_PACKAGE, '--', 'shadcn', 'init', '--preset', 'abc123']);
  });

  it('appends template and --yes only when supplied', () => {
    expect(buildShadcnInitArgs({ preset: 'p' })).not.toContain('--template');
    expect(buildShadcnInitArgs({ preset: 'p' })).not.toContain('--yes');

    const args = buildShadcnInitArgs({ preset: 'p', template: 'vite', yes: true });
    expect(args).toEqual([
      '--package', SHADCN_PACKAGE, '--', 'shadcn', 'init', '--preset', 'p', '--template', 'vite', '--yes'
    ]);
  });

  it('never floats on latest', () => {
    expect(SHADCN_PACKAGE).toMatch(/^shadcn@\d+\.\d+\.\d+$/);
  });
});

describe('registerShadcnCommands', () => {
  it('registers `peaks shadcn init` with the documented options', () => {
    const program = new Command();
    registerShadcnCommands(program, makeCapturedIo().io);

    const shadcn = program.commands.find((c) => c.name() === 'shadcn');
    expect(shadcn).toBeDefined();
    const init = shadcn?.commands.find((c) => c.name() === 'init');
    expect(init).toBeDefined();
    const longs = init?.options.map((o) => o.long) ?? [];
    expect(longs).toEqual(expect.arrayContaining(['--preset', '--template', '--project', '--yes', '--json']));
  });

  it('requires --preset (the skill says to resolve an unknown preset first)', async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
    registerShadcnCommands(program, makeCapturedIo().io);

    await expect(
      program.parseAsync(['shadcn', 'init'], { from: 'user' })
    ).rejects.toThrow(/required option/);
  });
});
