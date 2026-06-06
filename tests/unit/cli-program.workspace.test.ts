import { beforeEach, describe, expect, test } from 'vitest';
import { CommanderError } from 'commander';
import { createHarness, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('workspace reconcile --help accurately describes the three default actions', async () => {
    // Regression guard for slice 002-2026-06-06-reconcile-help-text.
    // The OLD help text said "By default the command is a dry-run", which
    // misled users into thinking nothing happens without --apply. In reality
    // the default invocation (1) migrates legacy runtime files, (2) re-points
    // session.json, and (3) only REPORTS deletion candidates — only the
    // deletion step is gated by --apply. The help text must spell out all
    // three actions so a user reading --help is not surprised by a side
    // effect on the first invocation.
    const harness = createHarness();
    try {
      await harness.program.parseAsync(
        ['node', 'peaks', 'workspace', 'reconcile', '--help'],
        { from: 'node' }
      );
    } catch (error: unknown) {
      if (
        !(error instanceof CommanderError) ||
        (error.code !== 'commander.help' && error.code !== 'commander.helpDisplayed')
      ) {
        throw error;
      }
    }

    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;
    expect(output).toContain('Migrates legacy');
    expect(output).toContain('Re-points .peaks/_runtime/session.json');
    expect(output).toContain('REPORTS');
    // Sanity: --apply must still be tied to REMOVAL, not migration, so a user
    // does not believe they need --apply to get the migration to run.
    expect(output).toContain('--apply');
    expect(output).toMatch(/REMOVE/);
  });

  test('prints artifacts sync dry-run', async () => {
    const result = await runCommand(['artifacts', 'sync', '--workspace', 'ws1', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('artifacts.sync');
  });

  test('rejects non-dry-run artifacts sync', async () => {
    const result = await runCommand(['artifacts', 'sync', '--workspace', 'ws1', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints artifacts workspace status', async () => {
    const result = await runCommand(['artifacts', 'workspace', '--workspace', 'ws1', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('artifacts.workspace');
  });

  test('prints artifacts workspace status without explicit workspace', async () => {
    const result = await runCommand(['artifacts', 'workspace', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('artifacts.workspace');
  });

  test('rejects invalid guided artifact setup step', async () => {
    const result = await runCommand(['artifacts', 'setup', '--step', 'invalid', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_ARTIFACT_SETUP_STEP');
    expect(result.exitCode).toBe(1);
  });
});
