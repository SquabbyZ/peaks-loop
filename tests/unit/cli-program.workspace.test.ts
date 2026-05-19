import { beforeEach, describe, expect, test } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('config workspace commands reject invalid layers', async () => {
    const addResult = await runCommand(['config', 'workspace', 'add', '--id', 'invalid-layer-add', '--name', 'Invalid Layer Add', '--path', '/tmp/invalid-layer-add', '--layer', 'invalid', '--json']);
    const addOutput = parseJsonOutput(addResult.stdout);
    expect(addOutput.ok).toBe(false);
    expect(addOutput.code).toBe('INVALID_CONFIG_LAYER');
    expect(addResult.exitCode).toBe(1);

    const removeResult = await runCommand(['config', 'workspace', 'remove', '--id', 'invalid-layer-remove', '--layer', 'invalid', '--json']);
    const removeOutput = parseJsonOutput(removeResult.stdout);
    expect(removeOutput.ok).toBe(false);
    expect(removeOutput.code).toBe('INVALID_CONFIG_LAYER');
    expect(removeResult.exitCode).toBe(1);

    const switchResult = await runCommand(['config', 'workspace', 'switch', '--id', 'invalid-layer-switch', '--layer', 'invalid', '--json']);
    const switchOutput = parseJsonOutput(switchResult.stdout);
    expect(switchOutput.ok).toBe(false);
    expect(switchOutput.code).toBe('INVALID_CONFIG_LAYER');
    expect(switchResult.exitCode).toBe(1);
  });

  test('prints config workspace list', async () => {
    const result = await runCommand(['config', 'workspace', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.workspace.list');
  });

  test('adds and removes workspace', async () => {
    const addResult = await runCommand(['config', 'workspace', 'add', '--id', 'test-add-ws', '--name', 'Test Add', '--path', '/tmp', '--json']);
    expect(addResult.exitCode === undefined || addResult.exitCode === 0).toBe(true);
    const addOutput = parseJsonOutput(addResult.stdout);
    expect(addOutput.ok).toBe(true);

    const removeResult = await runCommand(['config', 'workspace', 'remove', '--id', 'test-add-ws', '--layer', 'user', '--json']);
    const removeOutput = parseJsonOutput(removeResult.stdout);
    expect(removeOutput.ok).toBe(true);
  });

  test('remove workspace fails for unknown workspace', async () => {
    const result = await runCommand(['config', 'workspace', 'remove', '--id', 'nonexistent-ws', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('WORKSPACE_NOT_FOUND');
  });

  test('switch workspace fails for unknown workspace', async () => {
    const result = await runCommand(['config', 'workspace', 'switch', '--id', 'nonexistent-ws', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('WORKSPACE_NOT_FOUND');
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

  test('config workspace add with artifact repo', async () => {
    const result = await runCommand([
      'config', 'workspace', 'add',
      '--id', 'test-cli-add',
      '--name', 'Test Add with Repo',
      '--path', '/tmp/test-cli-add',
      '--layer', 'user',
      '--provider', 'github',
      '--repo-owner', 'testowner',
      '--repo-name', 'test-repo',
      '--json'
    ]);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(true);

    // cleanup
    await runCommand(['config', 'workspace', 'remove', '--id', 'test-cli-add', '--json']);
  });

  test('config workspace add without artifact repo options', async () => {
    const result = await runCommand([
      'config', 'workspace', 'add',
      '--id', 'test-cli-plain',
      '--name', 'Test Plain Add',
      '--path', '/tmp/test-cli-plain',
      '--json'
    ]);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(true);

    // cleanup
    await runCommand(['config', 'workspace', 'remove', '--id', 'test-cli-plain', '--json']);
  });

  test('rejects partial config workspace artifact repo options', async () => {
    const result = await runCommand([
      'config', 'workspace', 'add',
      '--id', 'test-cli-partial-repo',
      '--name', 'Test Partial Repo',
      '--path', '/tmp/test-cli-partial-repo',
      '--provider', 'github',
      '--repo-owner', 'testowner',
      '--json'
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_ARTIFACT_REPO_CONFIG');
    expect(result.exitCode).toBe(1);
  });

  test('rejects unsafe config workspace artifact repo segments', async () => {
    const result = await runCommand([
      'config', 'workspace', 'add',
      '--id', 'test-cli-unsafe-repo',
      '--name', 'Test Unsafe Repo',
      '--path', '/tmp/test-cli-unsafe-repo',
      '--provider', 'github',
      '--repo-owner', '../owner',
      '--repo-name', 'test-repo',
      '--json'
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_ARTIFACT_REPO_CONFIG');
    expect(result.exitCode).toBe(1);
  });

  test('rejects unsupported config workspace artifact provider', async () => {
    const result = await runCommand([
      'config', 'workspace', 'add',
      '--id', 'test-cli-unsupported-repo',
      '--name', 'Test Unsupported Repo',
      '--path', '/tmp/test-cli-unsupported-repo',
      '--provider', 'gitea',
      '--repo-owner', 'testowner',
      '--repo-name', 'test-repo',
      '--json'
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_ARTIFACT_PROVIDER');
  });

  test('config workspace switch to known workspace', async () => {
    // First create a workspace
    await runCommand([
      'config', 'workspace', 'add',
      '--id', 'test-switch-target',
      '--name', 'Switch Target',
      '--path', '/tmp/test-switch-target',
      '--json'
    ]);

    // Now switch to it
    const result = await runCommand(['config', 'workspace', 'switch', '--id', 'test-switch-target', '--layer', 'user', '--json']);
    const output = parseJsonOutput<{ currentWorkspace: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.currentWorkspace).toBe('test-switch-target');

    // cleanup
    await runCommand(['config', 'workspace', 'remove', '--id', 'test-switch-target', '--json']);
  });
});
