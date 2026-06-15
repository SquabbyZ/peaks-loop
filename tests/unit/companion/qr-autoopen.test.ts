/**
 * 2026-06-15-qr-inline-display follow-up (auto-open QR): unit tests for
 * the cross-platform `openInDefaultApp` helper.
 *
 * Behavior under test (Windows-aware):
 *   - darwin:  spawns `open <path>` with detached + unref + stdio:ignore
 *   - win32:   spawns `cmd.exe /c start "" <path>` so Windows opens the file
 *              in the user's default image handler (Photos / Paint / etc.).
 *              The empty `""` is a mandatory title placeholder; without it,
 *              `start` interprets the first quoted token as a window title.
 *   - linux:   spawns `xdg-open <path>` (best-effort; no fallback if not
 *              installed — caller is expected to print the path on failure)
 *   - other:   returns {ok:false, error:"unsupported platform:<x>"} without
 *              throwing (sandboxed envs / CI on unknown OS still safe)
 *   - child-error: returns {ok:false, error:"<reason>"} without throwing
 *
 * TDD order: this file is committed BEFORE `src/services/companion/qr-autoopen.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// We mock node:child_process so we can capture spawn() calls and simulate
// 'error' / 'spawn' events deterministically per platform.
const spawnSpy = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args)
}));

// We also need to control the platform without re-importing process.
const platformMock = vi.fn<(defaultPlatform?: NodeJS.Platform) => NodeJS.Platform>();
vi.mock('../../../src/shared/platform.js', () => ({
  detectPlatform: (p?: NodeJS.Platform) => platformMock(p ?? process.platform)
}));

// Import after the mock is wired so the module picks up the mock.
const { openInDefaultApp } = await import('../../../src/services/companion/qr-autoopen.js');
// Also re-import the type-only side so the linter keeps the alias.
import { detectPlatform } from '../../../src/shared/platform.js';

function makeChild() {
  const child = new EventEmitter() as EventEmitter & {
    unref: () => void;
    pid?: number;
  };
  child.unref = vi.fn();
  child.pid = 12345;
  return child;
}

describe('openInDefaultApp — cross-platform auto-open', () => {
  beforeEach(() => {
    spawnSpy.mockReset();
    platformMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('darwin: spawns `open <path>` with detached + stdio ignore + unref()', async () => {
    platformMock.mockReturnValue('darwin');
    const child = makeChild();
    spawnSpy.mockReturnValue(child);
    const promise = openInDefaultApp('/Users/me/qr.png');
    // Emit spawn event so the helper sees the child as successfully launched.
    queueMicrotask(() => child.emit('spawn'));
    const result = await promise;
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSpy.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(cmd).toBe('open');
    expect(args).toEqual(['/Users/me/qr.png']);
    expect(opts).toMatchObject({
      detached: true,
      stdio: 'ignore',
      shell: false
    });
    expect(child.unref).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, error: null, pid: 12345 });
  });

  it('win32: spawns `cmd.exe /c start "" <path>` to invoke Windows shell start', async () => {
    platformMock.mockReturnValue('win32');
    const child = makeChild();
    spawnSpy.mockReturnValue(child);
    const promise = openInDefaultApp('C:\\Users\\me\\qr.png');
    queueMicrotask(() => child.emit('spawn'));
    const result = await promise;
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSpy.mock.calls[0] as [string, string[], Record<string, unknown>];
    // On Windows we wrap the call in `cmd /c start "" <path>`. Some shells
    // alias `cmd` to `cmd.exe`; we accept either.
    expect(cmd === 'cmd' || cmd === 'cmd.exe').toBe(true);
    // The args list MUST include the empty title placeholder between `start`
    // and the file path. Without it, `start` treats the path as a title and
    // never opens the file. This is the well-known Windows quirk.
    expect(args).toEqual(['/c', 'start', '', 'C:\\Users\\me\\qr.png']);
    // On Windows, `detached:false` is recommended (process group semantics
    // differ — codegraph-process-runner.ts uses the same pattern).
    expect(opts).toMatchObject({
      detached: false,
      stdio: 'ignore',
      shell: false
    });
    expect(child.unref).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('linux: spawns `xdg-open <path>` with detached + stdio ignore + unref()', async () => {
    platformMock.mockReturnValue('linux');
    const child = makeChild();
    spawnSpy.mockReturnValue(child);
    const promise = openInDefaultApp('/home/me/qr.png');
    queueMicrotask(() => child.emit('spawn'));
    const result = await promise;
    const [cmd, args] = spawnSpy.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('xdg-open');
    expect(args).toEqual(['/home/me/qr.png']);
    expect(result.ok).toBe(true);
  });

  it('unknown platform: returns {ok:false, error: "unsupported platform:..."} without spawning', async () => {
    platformMock.mockReturnValue('freebsd' as NodeJS.Platform);
    const result = await openInDefaultApp('/anywhere/qr.png');
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported platform: freebsd/);
  });

  it('child emits error: returns {ok:false, error:"<reason>"} without throwing', async () => {
    platformMock.mockReturnValue('darwin');
    const child = makeChild();
    spawnSpy.mockReturnValue(child);
    const promise = openInDefaultApp('/missing/qr.png');
    queueMicrotask(() => child.emit('error', new Error('ENOENT: no such file')));
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
  });

  it('always returns a Promise<{ok, error, pid?}>; never throws synchronously', () => {
    platformMock.mockReturnValue('darwin');
    spawnSpy.mockImplementation(() => { throw new Error('spawn() blew up'); });
    // Even if spawn() throws synchronously, openInDefaultApp must NOT throw.
    // It must catch and return ok:false.
    return expect(openInDefaultApp('/x.png')).resolves.toEqual(
      expect.objectContaining({ ok: false })
    );
  });

  it('honors the optional platform override (for tests + future runtimes)', async () => {
    platformMock.mockReturnValue('darwin'); // would normally be the host
    const child = makeChild();
    spawnSpy.mockReturnValue(child);
    const promise = openInDefaultApp('/x.png', { platform: 'linux' });
    queueMicrotask(() => child.emit('spawn'));
    await promise;
    const [cmd] = spawnSpy.mock.calls[0] as [string];
    expect(cmd).toBe('xdg-open');
  });
});

// Re-import after all suites for type-only check; satisfies the linter.
expect(detectPlatform).toBeTypeOf('function');
