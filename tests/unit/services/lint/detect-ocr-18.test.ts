import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('detectOcr18', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
    invocation.command = RESOLVED.command;
    invocation.args = RESOLVED.args;
    invocation.baseEnv = {};
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

  it('when npx launches and the ocr package resolves, should return ready', () => {
    // given: both probes succeed
    queueSpawnSequence([{ status: 0, stdout: '' }, { status: 0, stdout: '' }]);

    // when: detectOcr18 probes
    const result = detectOcr18();

    // then: the state is ready and the invocation went through the resolver
    expect(result.state).toBe('ready');
    expect(result.npxAvailable).toBe(true);
    expect(result.warnings).toEqual([]);
    const call = childMock.spawnSync.mock.calls[0] as [string, string[], { env?: unknown }];
    expect(call[0]).toBe(process.execPath);
    expect(call[0]).not.toBe('npx');
    expect(call[1].slice(0, RESOLVED.args.length)).toEqual([...RESOLVED.args]);
    expect(call[1][call[1].length - 1]).toBe('--version');
    expect(call[2]).toMatchObject({ env: invocation.baseEnv });
  });

  it('when npx launches but the ocr package is not cached, should report ocr18-missing with npxAvailable true', () => {
    // given: npx is fine, the package probe fails
    queueSpawnSequence([{ status: 0, stdout: '' }, { status: 1, stdout: '' }]);

    // when: detectOcr18 probes
    const result = detectOcr18();

    // then: npx is reported as available — only the package is missing
    expect(result.state).toBe('ocr18-missing');
    expect(result.npxAvailable).toBe(true);
    expect(result.warnings[0]).toContain(OCR_18_PACKAGE);
  });
});
