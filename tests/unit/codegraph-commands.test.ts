import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const codegraphMocks = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn(),
  createCodegraphInvocation: vi.fn((options: { subcommand: string; project: string }) => ({
    executable: process.execPath,
    args: ['/mock/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js', options.subcommand],
    cwd: options.project,
    packageName: '@colbymchenry/codegraph',
    packageVersion: '0.7.10',
    subcommand: options.subcommand
  }))
}));

vi.mock('../../src/services/codegraph/codegraph-service.js', () => codegraphMocks);

const { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } = await import('./cli-program-test-utils.js');

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-codegraph-cli-'));
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
  return projectRoot;
}

describe('codegraph CLI commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    codegraphMocks.createCodegraphInvocation.mockClear();
    codegraphMocks.executeCodegraphInvocation.mockReset();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout: 'codegraph ok', stderr: '' });
  });

  test('runs status through the Peaks codegraph launcher', async () => {
    const projectRoot = createProject();

    const result = await runCommand(['codegraph', 'status', '--project', projectRoot]);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({ subcommand: 'status', project: projectRoot });
    expect(codegraphMocks.executeCodegraphInvocation).toHaveBeenCalled();
    expect(result.stdout).toContain('codegraph ok');
    expect(result.exitCode).toBeUndefined();
  });

  test('forwards init flags to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'init', '--project', projectRoot, '--yes']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'init',
      project: projectRoot,
      yes: true
    });
  });

  test('forwards index flags to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'index', '--project', projectRoot, '--force', '--quiet']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'index',
      project: projectRoot,
      force: true,
      quiet: true
    });
  });

  test('forwards query flags to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'query', '--project', projectRoot, 'auth middleware', '--json', '--limit', '5']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'query',
      project: projectRoot,
      search: 'auth middleware',
      json: true,
      limit: 5
    });
  });

  test('forwards files flags to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'files', '--project', projectRoot, '--json', '--max-depth', '3']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'files',
      project: projectRoot,
      json: true,
      maxDepth: 3
    });
  });

  test('forwards context task to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'context', '--project', projectRoot, 'refactor auth flow']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'context',
      project: projectRoot,
      task: 'refactor auth flow'
    });
  });

  test('forwards affected files to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'affected', '--project', projectRoot, 'src/index.ts', '--json']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'affected',
      project: projectRoot,
      files: ['src/index.ts'],
      json: true
    });
  });

  test('prints validation failures as Peaks envelopes', async () => {
    const projectRoot = createProject();
    codegraphMocks.createCodegraphInvocation.mockImplementationOnce(() => {
      throw new Error('Affected files must stay inside the project');
    });

    const result = await runCommand(['codegraph', 'affected', '--project', projectRoot, '../outside.ts']);

    expect(result.stderr.join('\n')).toContain('CODEGRAPH_COMMAND_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('rejects unsupported install subcommand before service execution', async () => {
    await expect(runCommand(['codegraph', 'install'])).rejects.toMatchObject({ code: 'commander.unknownCommand' } satisfies Partial<CommanderError>);

    expect(codegraphMocks.executeCodegraphInvocation).not.toHaveBeenCalled();
  });

  test('prints upstream stderr to stderr', async () => {
    const projectRoot = createProject();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: 'upstream warning' });

    const result = await runCommand(['codegraph', 'status', '--project', projectRoot]);

    expect(result.stderr).toContain('upstream warning');
    expect(result.exitCode).toBeUndefined();
  });

  test('sets process exit code when upstream codegraph fails', async () => {
    const projectRoot = createProject();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'upstream failed' });

    const result = await runCommand(['codegraph', 'index', '--project', projectRoot]);

    expect(result.stderr).toContain('upstream failed');
    expect(result.exitCode).toBe(2);
  });

  test('redacts sensitive non-json upstream failure output', async () => {
    const projectRoot = createProject();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'token=super-secret-token-value' });

    const result = await runCommand(['codegraph', 'index', '--project', projectRoot]);

    expect(result.stderr.join('\n')).toContain('[redacted]');
    expect(result.stderr.join('\n')).not.toContain('super-secret-token-value');
    expect(result.exitCode).toBe(2);
  });

  test('prints JSON envelope when upstream codegraph fails with --peaks-json', async () => {
    const projectRoot = createProject();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'upstream failed' });

    const result = await runCommand(['codegraph', 'index', '--project', projectRoot, '--peaks-json']);
    const output = parseJsonOutput(result.stdout);

    expect(result.stderr).toEqual([]);
    expect(result.exitCode).toBe(2);
    expect(output.ok).toBe(false);
    expect(output.command).toBe('codegraph.index');
    expect(output.code).toBe('CODEGRAPH_COMMAND_FAILED');
    expect(result.stdout.join('\n')).toContain('upstream failed');
  });

  test('rejects invalid numeric flags at the CLI boundary', async () => {
    const projectRoot = createProject();

    await expect(runCommand(['codegraph', 'query', '--project', projectRoot, 'auth middleware', '--limit', '1.5'])).rejects.toMatchObject({
      code: 'commander.invalidArgument'
    } satisfies Partial<CommanderError>);

    expect(codegraphMocks.createCodegraphInvocation).not.toHaveBeenCalled();
  });

  test('supports JSON envelopes for validation errors when --peaks-json is passed', async () => {
    const projectRoot = createProject();
    codegraphMocks.createCodegraphInvocation.mockImplementationOnce(() => {
      throw new Error('Project path must exist and be a directory');
    });

    const result = await runCommand(['codegraph', 'status', '--project', projectRoot, '--peaks-json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.command).toBe('codegraph.status');
    expect(output.code).toBe('CODEGRAPH_COMMAND_FAILED');
  });

  test('redacts sensitive upstream errors in JSON envelopes', async () => {
    const projectRoot = createProject();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'token=super-secret-token-value' });

    const result = await runCommand(['codegraph', 'index', '--project', projectRoot, '--peaks-json']);
    const output = parseJsonOutput(result.stdout);

    expect('message' in output && typeof output.message === 'string' ? output.message : '').toContain('[redacted]');
    expect(result.stdout.join('\n')).not.toContain('super-secret-token-value');
  });
});
