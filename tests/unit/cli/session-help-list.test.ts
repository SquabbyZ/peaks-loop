/**
 * `peaks session --help` discoverability regression (slice
 * 2026-07-01-strategic-compact-cli).
 *
 * The session checkpoint and session resume subcommands existed
 * (slice 011) but were registered via a lazy `void (async () => …)`
 * IIFE that ran AFTER commander's help builder had already
 * serialised its output. The result: `peaks session --help` did NOT
 * list `checkpoint` or `resume`, so the LLM never saw them via
 * `<TAB>`-discovery. This test pins the fix.
 */
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../cli-program-test-utils.js';

async function runHelp(args: string[]): Promise<string> {
  const harness = createHarness();
  try {
    await harness.program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
  } catch (error: unknown) {
    if (
      !(error instanceof CommanderError) ||
      (error.code !== 'commander.help' && error.code !== 'commander.helpDisplayed')
    ) {
      throw error;
    }
  }
  return [...harness.stdout, ...harness.stderr].join('\n');
}

describe('peaks session --help discoverability', () => {
  it('lists the checkpoint subcommand', async () => {
    const stdout = await runHelp(['session', '--help']);
    expect(stdout).toMatch(/checkpoint/);
  });

  it('lists the resume subcommand', async () => {
    const stdout = await runHelp(['session', '--help']);
    expect(stdout).toMatch(/resume/);
  });

  it('still lists the legacy rotate subcommand (no regression)', async () => {
    const stdout = await runHelp(['session', '--help']);
    expect(stdout).toMatch(/rotate/);
  });
});
