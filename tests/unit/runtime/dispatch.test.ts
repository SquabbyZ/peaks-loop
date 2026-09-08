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
    // Phase B registers Claude + Codex + Copilot, so the throw path only
    // fires for a genuinely unregistered vendor id. Cast through the
    // narrow union so this stays a runtime guard test, not a type error.
    await expect(dispatchDetached({
      sid: 's1', rid: 'r1', role: 'rd',
      vendor: 'unregistered-vendor' as never, userTask: 'do X',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    })).rejects.toThrow(/vendor adapter not registered/);
  });

  it('resolves every built-in vendor adapter (claude, codex, copilot)', async () => {
    for (const vendor of ['claude', 'codex', 'copilot'] as const) {
      const r = await dispatchDetached({
        sid: 's1', rid: `r-${vendor}`, role: 'rd',
        vendor, userTask: 'do X',
        files: [], refs: [],
        runtimeDir: '/tmp/runtime',
        subAgentsDir: '/tmp/subagents',
      });
      expect(r.pid).toBe(999);
    }
  });
});