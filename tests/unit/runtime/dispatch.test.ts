import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../packages/peaks-loop-internal-runtime/src/process-supervisor', () => ({
  ProcessSupervisor: class { spawn = vi.fn(async () => ({ pid: 999, kill: vi.fn(), child: { on: vi.fn() } })); },
}));
vi.mock('../../../packages/peaks-loop-internal-runtime/src/lifecycle', () => ({
  LifecycleOwner: class { register = vi.fn(); markExit = vi.fn(async () => {}); },
}));

import { dispatchDetached } from '../../../packages/peaks-loop-internal-runtime/src/dispatch';

describe('dispatchDetached', () => {
  it('builds prompt, spawns child, writes detached dir, returns dispatch record path', async () => {
    const r = await dispatchDetached({
      sid: 's1', rid: 'r1', role: 'rd',
      vendor: 'claude', userTask: 'do X',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    });
    expect(r.pid).toBe(999);
    expect(r.dispatchRecordPath).toContain('dispatch-r1');
  });

  it('throws if vendor adapter not registered', async () => {
    await expect(dispatchDetached({
      sid: 's1', rid: 'r1', role: 'rd',
      vendor: 'codex', userTask: 'do X',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    })).rejects.toThrow(/vendor adapter/);
  });
});