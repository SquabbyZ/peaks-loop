import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

/**
 * The resolver is mocked so the two launch conditions can be told apart
 * deterministically on every platform: a *resolved* invocation (the Windows
 * `npx.cmd` shim bypassed via `node <npx-cli.js>`, so `command !== 'npx'`) vs
 * the bare PATH shim fallback (`command === 'npx'`).
 */
const { invocation } = vi.hoisted(() => ({
  invocation: { command: 'npx', args: [] as readonly string[], baseEnv: {} as NodeJS.ProcessEnv }
}));

vi.mock('../../../../src/services/lint/npx-resolver.js', () => ({
  resolveNpxInvocation: (npxArgs: readonly string[]) => ({
    command: invocation.command,
    args: [...invocation.args, ...npxArgs],
    baseEnv: invocation.baseEnv
  }),
  resolveNpmInvocation: (npmArgs: readonly string[]) => ({
    command: invocation.command,
    args: [...invocation.args, ...npmArgs],
    baseEnv: invocation.baseEnv
  })
}));

const { spawnSync } = await import('node:child_process');
const { detectOcr18, NPX_PROBE_UNRESOLVED_CODE } = await import('../../../../src/services/lint/detect-ocr-18.js');
const { OCR_18_PACKAGE } = await import('../../../../src/services/lint/ocr-multilang-adapter.js');

const childMock = { spawnSync } as unknown as { spawnSync: ReturnType<typeof vi.fn> };

const RESOLVED = { command: process.execPath, args: ['/fake/npm/bin/npx-cli.js'] as readonly string[] };
const FALLBACK = { command: 'npx', args: [] as readonly string[] };

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
};

function queueSpawnSequence(results: SpawnResult[]): void {
  const queue = [...results];
  childMock.spawnSync.mockImplementation(() => {
    if (queue.length === 0) return { status: 0, stdout: '', stderr: '' } as SpawnResult;
    return queue.shift() as SpawnResult;
  });
}

function enoent(message: string): SpawnResult {
  return { status: null, stdout: '', error: Object.assign(new Error(message), { code: 'ENOENT' } as NodeJS.ErrnoException) };
}

/**
 * 2026-09-11: presence is no longer decided by spawning npx — that spawn is
 * exactly what installed the package and put an `npm i …` window on the user's
 * desktop. It is decided by looking in the two places npm exec itself looks
 * before it installs, so these tests plant (or do not plant) a real tree in a
 * throwaway workspace instead of queueing a spawn result.
 */
const ws = withTmpWorkspacePerTest('peaks-ocr18-detect-');

/** The scoped directory and the exact version the pinned spec names. */
const OCR_DIR = '@alibaba-group/open-code-review';
const OCR_VERSION = OCR_18_PACKAGE.slice(OCR_18_PACKAGE.lastIndexOf('@') + 1);

const ENV_KEYS = ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'] as const;
const savedEnv = new Map<string, string | undefined>();

/**
 * Both cache-root spellings the probe can derive — `<home>/.npm/_npx` and, on
 * win32, `<LOCALAPPDATA|APPDATA>/npm-cache/_npx` — planted under the tmp
 * workspace so the test does not depend on which platform runs it (the same
 * CI lesson the Playwright loader's suite recorded).
 */
const cacheRoots = (): string[] => [
  join(ws().path, 'npm-cache', '_npx'),
  join(ws().path, '.npm', '_npx')
];

/** Write `<modulesRoot>/@alibaba-group/open-code-review/package.json`. */
function plantPackage(modulesRoot: string, version: string = OCR_VERSION): void {
  const dir = join(modulesRoot, ...OCR_DIR.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: OCR_DIR, version }));
}

/** Plant it under every exec-cache root, as a real `npx --package` acquisition does. */
function plantInEveryCacheRoot(version?: string): void {
  for (const root of cacheRoots()) {
    plantPackage(join(root, 'deadbeef', 'node_modules'), version);
  }
}

/** The argv of every spawn the probe made, in order. */
function spawnedArgvs(): string[][] {
  return childMock.spawnSync.mock.calls.map((call) => call[1] as string[]);
}

describe('detectOcr18', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
    invocation.command = RESOLVED.command;
    invocation.args = RESOLVED.args;
    invocation.baseEnv = {};
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
    // A relocated home/AppData is the only way the probe's cache roots land in
    // the workspace rather than on the machine really running the suite.
    for (const key of ENV_KEYS) process.env[key] = ws().path;
    for (const root of cacheRoots()) mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const previous = savedEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    savedEnv.clear();
  });

  it('when the resolved npx cannot be launched, should report detection-failed — never "npx is not on PATH"', () => {
    // given: npx WAS resolved to a real CLI entry, and the spawn still failed
    queueSpawnSequence([enoent('spawn EINVAL')]);

    // when: detectOcr18 probes
    const result = detectOcr18();

    // then: a launch failure is named as such and is NOT reported as a missing npx
    expect(result.state).toBe('detection-failed');
    expect(result.npxAvailable).toBe(false);
    expect(result.warnings[0]).toContain(NPX_PROBE_UNRESOLVED_CODE);
    expect(result.warnings[0]).toContain('spawn EINVAL');
    expect(result.warnings.join(' ')).not.toContain('npx is not on PATH');
  });

  it('when npx is genuinely absent (bare PATH shim), should still report ocr18-missing + "npx is not on PATH"', () => {
    // given: the resolver could not locate a CLI entry, so the PATH shim was tried and failed
    invocation.command = FALLBACK.command;
    invocation.args = FALLBACK.args;
    queueSpawnSequence([enoent('spawn npx ENOENT')]);

    // when: detectOcr18 probes
    const result = detectOcr18();

    // then: absence keeps its own state, distinct from "could not launch it"
    expect(result.state).toBe('ocr18-missing');
    expect(result.npxAvailable).toBe(false);
    expect(result.warnings).toEqual(['npx is not on PATH']);
  });

  it('when npx runs but exits non-zero, should not claim npx is missing from PATH', () => {
    // given: npx launched and reported a non-zero exit for --version
    queueSpawnSequence([{ status: 3, stdout: '' }]);

    // when: detectOcr18 probes
    const result = detectOcr18();

    // then: the probe failure is reported verbatim
    expect(result.state).toBe('ocr18-missing');
    expect(result.warnings).toEqual(['npx --version exited 3']);
  });

  it('when the pinned package is a project dependency, should report ready from one npx spawn', () => {
    // given: the arrangement this repo itself has — the package in the project tree
    plantPackage(join(ws().path, 'node_modules'));
    queueSpawnSequence([{ status: 0, stdout: '' }]);

    // when: detectOcr18 probes (no cwd argument: the CLI's own call shape)
    const result = detectOcr18();

    // then: it is ready, and the ONLY thing spawned was `npx --version`
    expect(result.state).toBe('ready');
    expect(result.npxAvailable).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(childMock.spawnSync).toHaveBeenCalledTimes(1);
    const call = childMock.spawnSync.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(call[0]).toBe(process.execPath);
    expect(call[0]).not.toBe('npx');
    expect(call[1].slice(0, RESOLVED.args.length)).toEqual([...RESOLVED.args]);
    expect(call[1][call[1].length - 1]).toBe('--version');
    // then: no console window (repo convention) — the observable a unit test can
    // assert in place of the desktop one it cannot see
    expect(call[2]).toMatchObject({ env: invocation.baseEnv, windowsHide: true });
  });

  it('when the pinned package is only in the npm exec cache, should report ready', () => {
    // given: the arrangement a fresh `npx --package <pkg> -- ocr …` leaves behind
    plantInEveryCacheRoot();
    queueSpawnSequence([{ status: 0, stdout: '' }]);

    // when: detectOcr18 probes
    const result = detectOcr18({ cwd: ws().path });

    // then: the cache counts as installed — npx would not fetch anything
    expect(result.state).toBe('ready');
  });

  it('when the package is absent everywhere, should report ocr18-missing WITHOUT invoking npm install', () => {
    // given: an empty project tree and an empty exec cache
    queueSpawnSequence([{ status: 0, stdout: '' }]);

    // when: detectOcr18 probes
    const result = detectOcr18({ cwd: ws().path });

    // then: npx is available and only the package is missing
    expect(result.state).toBe('ocr18-missing');
    expect(result.npxAvailable).toBe(true);
    expect(result.warnings[0]).toContain(OCR_18_PACKAGE);
    // then: THE REGRESSION — nothing that could install or fetch was run. Exactly
    //       one spawn, and it is the harmless `npx --version`.
    expect(childMock.spawnSync).toHaveBeenCalledTimes(1);
    for (const argv of spawnedArgvs()) {
      expect(argv).not.toContain('--package');
      expect(argv).not.toContain('ocr');
      expect(argv[argv.length - 1]).toBe('--version');
    }
  });

  it('when the cache holds another version of the package, should not report ready', () => {
    // given: the multi-version cache a real machine accumulates — 1.11.9 beside the pin
    plantInEveryCacheRoot('9.9.9-alpha');
    queueSpawnSequence([{ status: 0, stdout: '' }]);

    // when: detectOcr18 probes
    const result = detectOcr18({ cwd: ws().path });

    // then: a different version is one npx would install over — install, not ready
    expect(result.state).toBe('ocr18-missing');
  });
});
