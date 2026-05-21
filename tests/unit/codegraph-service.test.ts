import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner
} from '../../src/services/codegraph/codegraph-service.js';

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-codegraph-'));
  writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
  return projectRoot;
}

function expectCodegraphArgs(invocation: ReturnType<typeof createCodegraphInvocation>, expectedArgs: string[]): void {
  const binaryPath = invocation.args[0];

  if (binaryPath === undefined) {
    throw new Error('Expected local codegraph binary path in invocation args');
  }

  expect(invocation.executable).toBe(process.execPath);
  expect(binaryPath).toMatch(/@colbymchenry[\\/]codegraph[\\/].*dist[\\/]bin[\\/]codegraph\.js$/);
  expect(invocation.args.slice(1)).toEqual(expectedArgs);
}

describe('codegraph service', () => {
  test('assembles status invocation inside the project boundary', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({ subcommand: 'status', project: projectRoot });

    expect(invocation).toMatchObject({
      executable: process.execPath,
      cwd: realpathSync.native(projectRoot),
      packageName: '@colbymchenry/codegraph',
      packageVersion: '0.7.10',
      subcommand: 'status'
    });
    expectCodegraphArgs(invocation, ['status']);
  });

  test('assembles query invocation with search, json, and limit flags', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'query',
      project: projectRoot,
      search: 'auth middleware',
      json: true,
      limit: 8
    });

    expectCodegraphArgs(invocation, ['query', 'auth middleware', '--json', '--limit', '8']);
    expect(invocation.cwd).toBe(realpathSync.native(projectRoot));
  });

  test('assembles init invocation with yes flag', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'init',
      project: projectRoot,
      yes: true
    });

    expectCodegraphArgs(invocation, ['init', '--yes']);
  });

  test('assembles index invocation with force and quiet flags', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'index',
      project: projectRoot,
      force: true,
      quiet: true
    });

    expectCodegraphArgs(invocation, ['index', '--force', '--quiet']);
  });

  test('assembles context invocation with task as positional argument', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'context',
      project: projectRoot,
      task: 'plan checkout refactor'
    });

    expectCodegraphArgs(invocation, ['context', 'plan checkout refactor']);
  });

  test('rejects blank context task', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'context',
        project: projectRoot,
        task: '   '
      })
    ).toThrow('task must be non-empty');
  });

  test('assembles affected invocation and keeps files inside the project', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'affected',
      project: projectRoot,
      files: ['src/index.ts'],
      json: true
    });

    expectCodegraphArgs(invocation, ['affected', 'src/index.ts', '--json']);
  });

  test('rejects unsupported subcommands such as install', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'install' as never,
        project: projectRoot
      })
    ).toThrow('Unsupported codegraph subcommand: install');
  });

  test('rejects status options that are only valid for other subcommands', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'status',
        project: projectRoot,
        json: true
      })
    ).toThrow('Unsupported option json for codegraph status');
  });

  test('rejects init options that are only valid for other subcommands', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'init',
        project: projectRoot,
        maxDepth: 2
      })
    ).toThrow('Unsupported option maxDepth for codegraph init');
  });

  test('rejects context options that are only valid for other subcommands', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'context',
        project: projectRoot,
        task: 'summarize checkout flow',
        json: true
      })
    ).toThrow('Unsupported option json for codegraph context');
  });

  test('rejects affected options that are only valid for other subcommands', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'affected',
        project: projectRoot,
        files: ['src/index.ts'],
        limit: 2
      })
    ).toThrow('Unsupported option limit for codegraph affected');
  });

  test('rejects query without a non-empty search term', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'query',
        project: projectRoot
      })
    ).toThrow('search must be non-empty');
  });

  test('requires an existing directory as project root', () => {
    const projectRoot = join(tmpdir(), 'peaks-codegraph-missing-project');

    expect(() => createCodegraphInvocation({ subcommand: 'status', project: projectRoot })).toThrow('Project path must exist and be a directory');
  });

  test('rejects affected files that escape the project root', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'affected',
        project: projectRoot,
        files: ['../outside.ts']
      })
    ).toThrow('Affected files must stay inside the project');
  });

  test('rejects affected files that escape through a symlinked directory', () => {
    const projectRoot = createProject();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-codegraph-outside-'));
    writeFileSync(join(outsideRoot, 'outside.ts'), 'export const outside = true;\n', 'utf8');
    symlinkSync(outsideRoot, join(projectRoot, 'linked-outside'), 'junction');

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'affected',
        project: projectRoot,
        files: ['linked-outside/outside.ts']
      })
    ).toThrow('Affected files must stay inside the project');
  });

  test('rejects dash-prefixed positional arguments before upstream parsing', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'query',
        project: projectRoot,
        search: '--help'
      })
    ).toThrow('search must not start with -');

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'context',
        project: projectRoot,
        task: '-config'
      })
    ).toThrow('task must not start with -');

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'affected',
        project: projectRoot,
        files: ['--help']
      })
    ).toThrow('Affected files must not start with -');
  });

  test('rejects invalid numeric flags before invoking upstream codegraph', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'files',
        project: projectRoot,
        maxDepth: 0
      })
    ).toThrow('maxDepth must be a positive integer');
  });

  test('executes through an injectable runner for CLI tests', async () => {
    const projectRoot = createProject();
    const invocation = createCodegraphInvocation({ subcommand: 'index', project: projectRoot, quiet: true });
    const runner: CodegraphProcessRunner = vi.fn(async (input) => ({
      exitCode: 0,
      stdout: `ran ${input.args.join(' ')}`,
      stderr: ''
    }));

    const result = await executeCodegraphInvocation(invocation, runner);

    expect(runner).toHaveBeenCalledWith(invocation);
    expect(result.stdout).toMatch(/ran .*@colbymchenry[\\/]codegraph[\\/].*dist[\\/]bin[\\/]codegraph\.js index --quiet$/);
    expect(result.exitCode).toBe(0);
  });

  test('runs local codegraph dependency through the current Node executable', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({ subcommand: 'status', project: projectRoot });

    expectCodegraphArgs(invocation, ['status']);
  });
});
