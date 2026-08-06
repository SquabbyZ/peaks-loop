import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

const { spawnSync } = await import('node:child_process');
const spawnSyncMock = vi.mocked(spawnSync);
const { detectEslint } = await import('../../../../src/services/lint/detect-eslint.js');

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
    expect(firstCall[0]).not.toBe('npx');
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
    expect(firstCall[0]).not.toBe('npx');
    expect(firstCall[1]).toContain('--version');
    expect(result.state).toBe('npx-failed');
    expect(result.npxAvailable).toBe(false);
  });

  it('when probing the npm registry, should invoke `npm view` through a Windows shell wrapper', () => {
    // given: npx probe succeeds; each package probe returns status 0
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '10.9.4' } as ReturnType<typeof spawnSync>)
      .mockReturnValue({ status: 0, stdout: '8.57.1' } as ReturnType<typeof spawnSync>);

    // when: ESLint availability is detected
    const result = detectEslint();

    // then: every `npm view` call sets shell:true so the Windows .cmd shim resolves
    const packageCalls = spawnSyncMock.mock.calls.slice(1) as Array<[string, string[], Record<string, unknown>]>;
    expect(packageCalls.length).toBeGreaterThan(0);
    for (const call of packageCalls) {
      expect(call[0]).toBe('npm');
      expect(call[1][0]).toBe('view');
      expect(call[2]).toMatchObject({ shell: true, encoding: 'utf8' });
    }
    expect(result.state).toBe('ready');
    expect(result.warnings).toEqual([]);
  });
});
