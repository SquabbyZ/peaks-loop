// tests/unit/cli/commands/test-commands-runner-resolution.test.ts
//
// rid-peaks-test-local-runner — `peaks test <file>` must find the project's
// LOCAL test runner instead of spawning the bare name `vitest`.
//
// Why this file exists: on Windows the runner is `node_modules/.bin/vitest.cmd`,
// which `spawn` cannot launch without a shell (spawn → EINVAL). The bare name
// therefore died with a raw ENOENT and the documented primitive was unusable.
//
// Every fs / spawn / platform boundary is INJECTED — no test in this file
// touches the real filesystem, env, or a subprocess.
//
// Run with:
//   ./node_modules/.bin/vitest run tests/unit/cli/commands/test-commands-runner-resolution.test.ts

import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  formatRunnerNotFound,
  resolveRunner,
  runRunner,
  type ResolveRunnerDeps
} from '~/src/cli/commands/test-commands';

declareDimensions(
  'tests/unit/cli/commands/test-commands-runner-resolution.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'fs, spawn, platform and env are injected fakes — no real subprocess or filesystem is touched',
    },
  ],
);

/** Host-normalized so the expectations hold on both Windows and POSIX CI.
 * Absolute because the resolver `resolve()`s the `bin` entry against the cwd. */
const PROJECT = resolve('fake', 'project');
const NODE_EXEC = join('fake', 'bin', 'node');
const CMD_EXEC = join('fake', 'system32', 'cmd.exe');
const binOf = (name: string): string => join(PROJECT, 'node_modules', '.bin', name);
const pkgOf = (name: string): string => join(PROJECT, 'node_modules', name, 'package.json');
const entryOf = (name: string, file: string): string =>
  join(PROJECT, 'node_modules', name, file);

const VITEST_ENTRY = entryOf('vitest', 'vitest.mjs');
const VITEST_PKG = JSON.stringify({ name: 'vitest', bin: { vitest: './vitest.mjs' } });

type SpawnCall = { command: string; args: string[]; cwd: string | undefined };

type RecordingSpawn = {
  spawnFn: typeof spawn;
  calls: SpawnCall[];
};

/** A `spawn` stand-in that records the call and closes with `code`. */
function fakeSpawn(code = 0): RecordingSpawn {
  const calls: SpawnCall[] = [];
  const spawnFn = ((command: string, args: string[], options: { cwd?: string }) => {
    calls.push({ command, args, cwd: options?.cwd });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => proc.emit('close', code));
    return proc;
  }) as unknown as typeof spawn;
  return { spawnFn, calls };
}

/** Fake fs keyed by exact host-normalized path. */
function fakeFs(files: Record<string, string>, dirs: string[] = []): ResolveRunnerDeps {
  const present = new Set([...Object.keys(files), ...dirs]);
  return {
    existsSync: (path: string) => present.has(path),
    readFileSync: (path: string) => files[path] ?? '{}'
  };
}

/** Deps for a fake POSIX box with the given fs entries. */
function posixDeps(files: Record<string, string>, dirs: string[] = []): ResolveRunnerDeps {
  return {
    platform: 'linux',
    nodeExecPath: NODE_EXEC,
    env: { PATH: join('fake', 'empty-path') },
    ...fakeFs(files, dirs)
  };
}

describe('resolveRunner', () => {
  it('when a local package entry exists, should spawn node with that entry', () => {
    // given: a local vitest whose package.json declares its JS entry
    // when: the runner is resolved
    // then: node runs the local entry, and argv is appended verbatim
    const deps = posixDeps({ [pkgOf('vitest')]: VITEST_PKG }, [VITEST_ENTRY]);

    const result = resolveRunner('vitest', ['run', 'a.test.ts'], PROJECT, deps);

    expect(result.ok).toBe(true);
    expect(result.ok && result.command).toBe(NODE_EXEC);
    expect(result.ok && result.args).toEqual([VITEST_ENTRY, 'run', 'a.test.ts']);
    expect(result.ok && result.fromPath).toBe(false);
  });

  it('when a local runner resolves, should never spawn the bare framework name', () => {
    // given: a fully installed local vitest
    // when: the runner is resolved
    // then: the command is a resolved path, never the bare name that ENOENTs on Windows
    const deps = posixDeps({ [pkgOf('vitest')]: VITEST_PKG }, [VITEST_ENTRY]);

    const result = resolveRunner('vitest', ['run'], PROJECT, deps);

    expect(result.ok && result.command).not.toBe('vitest');
    expect(result.ok && result.command).not.toBe('jest');
    expect(result.ok && result.command).not.toBe('mocha');
  });

  it('when the package entry is unresolvable, should fall back to the local bin shim', () => {
    // given: a local .bin shim but no readable package.json bin field
    // when: the runner is resolved
    // then: the shim itself is spawned, still locally
    const shim = binOf('vitest');
    const deps = posixDeps({}, [shim]);

    const result = resolveRunner('vitest', ['run'], PROJECT, deps);

    expect(result.ok && result.command).toBe(shim);
    expect(result.ok && result.args).toEqual(['run']);
    expect(result.ok && result.fromPath).toBe(false);
  });

  it('when on win32 the shim is a .cmd, should launch it through cmd.exe with intact argv', () => {
    // given: a Windows local install whose only spawnable artefact is vitest.cmd
    // when: the runner is resolved with a pattern containing a space
    // then: cmd.exe /d /s /c runs the shim, and the spaced pattern stays ONE arg
    const shim = binOf('vitest.cmd');
    const deps: ResolveRunnerDeps = {
      platform: 'win32',
      nodeExecPath: NODE_EXEC,
      env: { PATH: join('fake', 'empty-path'), ComSpec: CMD_EXEC },
      ...fakeFs({}, [shim])
    };

    const result = resolveRunner('vitest', ['run', 'a b/x.test.ts'], PROJECT, deps);

    expect(result.ok && result.command).toBe(CMD_EXEC);
    expect(result.ok && result.args).toEqual(['/d', '/s', '/c', shim, 'run', 'a b/x.test.ts']);
  });

  it('when no local runner exists but one is on PATH, should fall back and flag it', () => {
    // given: an empty project whose PATH holds a vitest
    // when: the runner is resolved
    // then: the PATH hit is used AND flagged so the caller can surface it
    const pathDir = join('fake', 'path-dir');
    const onPath = join(pathDir, 'vitest');
    const deps: ResolveRunnerDeps = {
      platform: 'linux',
      nodeExecPath: NODE_EXEC,
      env: { PATH: pathDir },
      ...fakeFs({}, [onPath])
    };

    const result = resolveRunner('vitest', ['run'], PROJECT, deps);

    expect(result.ok && result.command).toBe(onPath);
    expect(result.ok && result.fromPath).toBe(true);
  });

  it('when nothing local or on PATH resolves, should name every searched path', () => {
    // given: a project with no runner anywhere
    // when: the runner is resolved
    // then: the failure enumerates what was looked for
    const deps = posixDeps({});

    const result = resolveRunner('vitest', ['run'], PROJECT, deps);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.searched).toContain(binOf('vitest'));
    expect(result.ok ? [] : result.searched).toContain(pkgOf('vitest'));
    expect(result.ok ? [] : result.searched).toContain('PATH lookup for "vitest"');
  });
});

describe('not-found message', () => {
  it('when the runner is missing, should report RUNNER_NOT_FOUND without a raw ENOENT', () => {
    // given: no runner resolved
    // when: the message is rendered
    // then: it names the paths and the fix, and never leaks the spawn errno
    const searched = [binOf('vitest'), pkgOf('vitest'), 'PATH lookup for "vitest"'];

    const message = formatRunnerNotFound('vitest', searched);

    expect(message).toContain('RUNNER_NOT_FOUND');
    for (const path of searched) expect(message).toContain(path);
    expect(message).toContain('--framework');
    expect(message).not.toContain('ENOENT');
  });
});

describe('runRunner', () => {
  it('when the runner resolves locally, should spawn it and emit no notice', async () => {
    // given: a local vitest and a recording spawn
    // when: the runner is executed
    // then: it spawns the local entry with the argv untouched, and says nothing extra
    const { spawnFn, calls } = fakeSpawn();
    const deps = { ...posixDeps({ [pkgOf('vitest')]: VITEST_PKG }, [VITEST_ENTRY]), spawnFn };

    const result = await runRunner('vitest', ['run', 'a.test.ts'], PROJECT, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(NODE_EXEC);
    expect(calls[0]?.args).toEqual([VITEST_ENTRY, 'run', 'a.test.ts']);
    expect(result.notice).toBe(null);
    expect(result.code).toBe(0);
  });

  it('when the runner came from PATH, should return a notice naming the fallback', async () => {
    // given: a runner reachable only through PATH
    // when: the runner is executed
    // then: the fallback is visible rather than silent
    const pathDir = join('fake', 'path-dir');
    const onPath = join(pathDir, 'vitest');
    const { spawnFn } = fakeSpawn();
    const deps: ResolveRunnerDeps & { spawnFn: typeof spawn } = {
      platform: 'linux',
      nodeExecPath: NODE_EXEC,
      env: { PATH: pathDir },
      spawnFn,
      ...fakeFs({}, [onPath])
    };

    const result = await runRunner('vitest', ['run'], PROJECT, deps);

    expect(result.notice).toContain('falling back');
    expect(result.notice).toContain(onPath);
  });

  it('when no runner can be found, should reject with the actionable message', async () => {
    // given: a project with no runner anywhere
    // when: the runner is executed
    // then: the caller gets RUNNER_NOT_FOUND, not a bare ENOENT
    const { spawnFn } = fakeSpawn();
    const deps = { ...posixDeps({}), spawnFn };

    await expect(runRunner('vitest', ['run'], PROJECT, deps)).rejects.toThrow(/RUNNER_NOT_FOUND/);
    await expect(runRunner('vitest', ['run'], PROJECT, deps)).rejects.not.toThrow(/ENOENT/);
  });
});
