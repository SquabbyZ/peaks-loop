import { beforeEach, describe, expect, test } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
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
