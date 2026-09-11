// Two CLI option definitions that each silently disabled the feature they
// advertised. Both are definition-level invariants: the bug was not in the
// handler, it was in how the option was declared.
//
//  1. `--mode <mode>` on `code auto-compact` carried a commander DEFAULT.
//     A declared default makes `opts.mode` permanently defined, so the
//     orchestrator's `input.mode ?? resolveAutoCompactMode(projectRoot)`
//     fallback never fired and "24h mode auto-selects partial" — promised by
//     the option's own help text — was dead code. Every 24h session ran the
//     standard 0.80/0.85 thresholds while believing it ran 0.65/0.70.
//
//  2. `--graph-node` on `sub-agent dispatch` was a `.requiredOption`, so
//     commander rejected the call before the handler could provision one.
//     The requirement was never validated by anything downstream, so it
//     blocked every project without graph infrastructure and bought nothing.
//
// Run with: pnpm vitest run tests/unit/cli/command-option-invariants.test.ts

import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';

import { createProgram } from '~/src/cli/program';

function commandAt(program: Command, path: readonly string[]): Command {
  let current: Command | undefined = program;
  for (const name of path) {
    current = current.commands.find((c) => c.name() === name);
    if (current === undefined) throw new Error(`no such command: ${path.join(' ')}`);
  }
  return current;
}

function optionFor(program: Command, path: readonly string[], long: string) {
  const option = commandAt(program, path).options.find((o) => o.long === long);
  if (option === undefined) throw new Error(`no such option: ${path.join(' ')} ${long}`);
  return option;
}

describe('CLI option definitions that must not defeat their own fallbacks', () => {
  it('`--mode` carries no commander default, so absence stays absent', () => {
    const option = optionFor(createProgram(), ['code', 'auto-compact'], '--mode');
    // A default here re-defines "not supplied" as "standard", which is
    // exactly how 24h → partial was disabled.
    expect(option.defaultValue).toBeUndefined();
  });

  it('`--graph-node` is not mandatory, so dispatch can provision one', () => {
    const option = optionFor(createProgram(), ['sub-agent', 'dispatch'], '--graph-node');
    expect(option.mandatory).toBe(false);
  });
});
