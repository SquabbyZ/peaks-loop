import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { ProcessSupervisor } from '../../../packages/peaks-loop-internal-runtime/src/process-supervisor';

describe('ProcessSupervisor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('spawns with detach=true and writes pid file', async () => {
    (spawn as any).mockReturnValue({ pid: 1234, on: vi.fn(), kill: vi.fn() });
    const sup = new ProcessSupervisor({ runtimeDir: '/tmp/x' });
    const handle = await sup.spawn('/bin/echo', ['hi'], { detach: true, rid: 'r1' });
    expect(handle.pid).toBe(1234);
    expect(spawn).toHaveBeenCalledWith('/bin/echo', ['hi'], expect.objectContaining({ detached: true }));
  });

  it('uses CREATE_NEW_PROCESS_GROUP on win32', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    (spawn as any).mockReturnValue({ pid: 1, on: vi.fn(), kill: vi.fn() });
    const sup = new ProcessSupervisor({ runtimeDir: '/tmp/x' });
    await sup.spawn('claude', ['-p', 'x'], { detach: true, rid: 'r1' });
    const opts = (spawn as any).mock.calls[0][2];
    expect(opts.windowsHide).toBe(true);
    expect(opts.detached).toBe(true);
    Object.defineProperty(process, 'platform', { value: orig });
  });
});