import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { ProcessSupervisor } from '../../../packages/peaks-loop-internal-runtime/src/process-supervisor.js';

describe('ProcessSupervisor (F2 in-shell contract)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('spawns with detached:false even when caller passes detach=true and writes pid file', async () => {
    (spawn as any).mockReturnValue({ pid: 1234, on: vi.fn(), kill: vi.fn() });
    const sup = new ProcessSupervisor({ runtimeDir: '/tmp/x' });
    const handle = await sup.spawn('/bin/echo', ['hi'], { detach: true, rid: 'r1' });
    expect(handle.pid).toBe(1234);
    // F2: caller-facing detach:true must be downgraded to detached:false
    // (in-shell background subprocess). The previous OS-detached
    // behavior (CREATE_NEW_PROCESS_GROUP / DETACHED_PROCESS) is gone.
    expect(spawn).toHaveBeenCalledWith('/bin/echo', ['hi'], expect.objectContaining({ detached: false }));
  });

  it('uses windowsHide:true on win32 but does NOT force detached:true', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    (spawn as any).mockReturnValue({ pid: 1, on: vi.fn(), kill: vi.fn() });
    const sup = new ProcessSupervisor({ runtimeDir: '/tmp/x' });
    await sup.spawn('claude', ['-p', 'x'], { detach: true, rid: 'r1' });
    const opts = (spawn as any).mock.calls[0][2];
    expect(opts.windowsHide).toBe(true);
    // F2: pre-F2 forced `detached:true` on Windows (CREATE_NEW_PROCESS_GROUP + DETACHED_PROCESS);
    // post-F2 the child stays in the parent's process group (no detached flag) and the
    // popup console is suppressed via windowsHide alone.
    expect(opts.detached).toBe(false);
    Object.defineProperty(process, 'platform', { value: orig });
  });

  /**
   * Item 2.2 of rid 2026-09-13-leftover-cleanup.
   *
   * `child.pid` is `undefined` until the OS confirms the launch, so
   * `String(child.pid ?? '')` wrote an EMPTY `<rid>/pid` on a failed spawn.
   * `Number('')` is `0`, so a cleanup that did `kill(Number(read(pid)))` would
   * signal pid 0 (the whole process group), and an existence check for "is a
   * sub-agent running here" answered yes for a launch that never happened.
   * Observed before the fix (real ENOENT spawn, temp runtimeDir):
   *   `pid file exists? true / raw "" / Number(raw) 0`.
   */
  it('writes NO pid file when the launch fails, and writes one when it succeeds', async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'ps-pid-'));
    try {
      // given: a spawn that never produced an OS pid (missing binary)
      (spawn as any).mockReturnValue({ pid: undefined, on: vi.fn(), kill: vi.fn() });
      const sup = new ProcessSupervisor({ runtimeDir });
      // when: the supervisor spawns
      const failed = await sup.spawn('no-such-binary', [], { detach: false, rid: 'r-fail' });
      // then: the sentinel pid is still reported, but nothing was written
      expect(failed.pid).toBe(-1);
      expect(existsSync(join(runtimeDir, 'r-fail', 'pid'))).toBe(false);
      // ...and the record dir itself still exists, so "absent pid" cannot be
      // confused with "absent run"
      expect(existsSync(join(runtimeDir, 'r-fail'))).toBe(true);

      // contrast, same shape: a confirmed launch DOES write the real pid, so
      // the case above cannot pass because the write was dropped entirely
      (spawn as any).mockReturnValue({ pid: 4242, on: vi.fn(), kill: vi.fn() });
      const ok = await sup.spawn('node', ['-v'], { detach: false, rid: 'r-ok' });
      expect(ok.pid).toBe(4242);
      expect(readFileSync(join(runtimeDir, 'r-ok', 'pid'), 'utf8')).toBe('4242');
    } finally {
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });
});