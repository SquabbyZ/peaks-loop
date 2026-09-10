import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

const { spawnSync } = await import('node:child_process');
const spawnSyncMock = vi.mocked(spawnSync);
const { detectEslint } = await import('../../../../src/services/lint/detect-eslint.js');

/**
 * `resolveNpxInvocation` (src/services/lint/npx-resolver.ts) deliberately
 * returns bare `npx` on POSIX and only resolves `node <npx-cli.js>` on
 * win32 (where the `.cmd` shim needs the explicit script).
 */
function expectPlatformNpxCommand(call: [string, string[], Record<string, unknown>]): void {
  if (process.platform === 'win32') {
    expect(call[0]).not.toBe('npx');
    expect(call[1][0]).toContain('npx-cli.js');
  } else {
    expect(call[0]).toBe('npx');
  }
}

/**
 * `resolveNpmInvocation` is the `npm` sibling of the npx resolver: bare `npm`
 * on POSIX, and on win32 `node <npm-cli.js>` — the `.cmd` shim is never
 * spawned, so no call may carry `shell`.
 */
function expectPlatformNpmCommand(call: [string, string[], Record<string, unknown>]): void {
  if (process.platform === 'win32') {
    expect(call[0]).toBe(process.execPath);
    expect(call[1][0]).toContain('npm-cli.js');
  } else {
    expect(call[0]).toBe('npm');
  }
}

describe('detectEslint', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('when probing npx, should invoke the npx resolver with --version', () => {
    // given: npx and every pinned package probe successfully
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '10.9.4' } as ReturnType<typeof spawnSync>);

    // when: ESLint availability is detected
    const result = detectEslint();

    // then: the npx resolver forwards the args, and detection is ready
    const firstCall = spawnSyncMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expectPlatformNpxCommand(firstCall);
    expect(firstCall[1]).toContain('--version');
    expect(firstCall[2]).toMatchObject({ encoding: 'utf8' });
    expect(result.state).toBe('ready');
    expect(result.npxAvailable).toBe(true);
  });

  it('when the resolver npx probe fails, should report npx-failed without package probes', () => {
    // given: the resolver cannot resolve the npx entry
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '' } as ReturnType<typeof spawnSync>);

    // when: ESLint availability is detected
    const result = detectEslint();

    // then: detection stops after the resolver-based probe
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const firstCall = spawnSyncMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expectPlatformNpxCommand(firstCall);
    expect(firstCall[1]).toContain('--version');
    expect(result.state).toBe('npx-failed');
    expect(result.npxAvailable).toBe(false);
  });

  it('when probing the npm registry, should invoke `npm view` with no shell and no .cmd shim', () => {
    // given: npx probe succeeds; each package probe returns status 0
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '10.9.4' } as ReturnType<typeof spawnSync>)
      .mockReturnValue({ status: 0, stdout: '8.57.1' } as ReturnType<typeof spawnSync>);

    // when: ESLint availability is detected
    const result = detectEslint();

    // then: every `npm view` call goes through the resolver, and none carries a
    // shell — the shim + shell flag was the defect (spaced args split, DEP0190).
    const packageCalls = spawnSyncMock.mock.calls.slice(1) as Array<[string, string[], Record<string, unknown>]>;
    expect(packageCalls.length).toBeGreaterThan(0);
    for (const call of packageCalls) {
      expectPlatformNpmCommand(call);
      expect(call[1]).toContain('view');
      expect(call[1]).toContain('version');
      expect(call[2]).toMatchObject({ encoding: 'utf8' });
      expect(call[2].shell).toBeUndefined();
    }
    expect(result.state).toBe('ready');
    expect(result.warnings).toEqual([]);
  });

  it('when npm cannot be launched, should name the resolution failure instead of blaming the registry', () => {
    // given: npx resolves, but the npm probe fails to spawn at all
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '10.9.4' } as ReturnType<typeof spawnSync>)
      .mockReturnValue({
        status: null,
        error: new Error('spawn EINVAL'),
        stdout: ''
      } as unknown as ReturnType<typeof spawnSync>);

    // when: ESLint availability is detected
    const result = detectEslint();

    // then: the warning names NPM_PROBE_UNRESOLVED rather than the registry
    expect(result.state).toBe('ready');
    expect(result.warnings.length).toBe(3);
    for (const warning of result.warnings) {
      expect(warning).toContain('NPM_PROBE_UNRESOLVED');
      expect(warning).not.toContain('registry cannot resolve');
    }
  });
});
