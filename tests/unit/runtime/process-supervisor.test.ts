import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { ProcessSupervisor } from '../../../packages/peaks-loop-internal-runtime/src/process-supervisor';

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
});