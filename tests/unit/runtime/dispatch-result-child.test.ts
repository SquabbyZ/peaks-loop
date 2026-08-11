// tests/unit/runtime/dispatch-result-child.test.ts
//
// F1 follow-up to rid-001: DispatchResult now exposes the spawned
// ChildProcess so callers can attach per-child 'error' handlers without
// reaching into peaks-loop-internal-runtime's ProcessSupervisor internals.
//
// Verifies:
//   1. dispatchDetached returns a DispatchResult whose `child` field is
//      the same ChildProcess reference ProcessSupervisor.spawn produced.
//   2. The child field is an EventEmitter-shaped object (has .on()).
//   3. Backward compat: pid + dispatchRecordPath still present.

import { describe, it, expect, vi } from 'vitest';

const childRef = {
  pid: 7777,
  on: vi.fn(),
  kill: vi.fn(),
};

vi.mock('../../../packages/peaks-loop-internal-runtime/src/process-supervisor', () => ({
  ProcessSupervisor: class {
    spawn = vi.fn(async () => ({ pid: 7777, kill: vi.fn(), child: childRef }));
  },
}));
vi.mock('../../../packages/peaks-loop-internal-runtime/src/lifecycle', () => ({
  LifecycleOwner: class { register = vi.fn(); markExit = vi.fn(async () => {}); },
}));

import { dispatchDetached } from '../../../packages/peaks-loop-internal-runtime/src/dispatch';

describe('DispatchResult exposes ChildProcess (F1)', () => {
  it('returns the spawned ChildProcess reference on DispatchResult.child', async () => {
    const r = await dispatchDetached({
      sid: 's1', rid: 'r1', role: 'rd',
      vendor: 'claude', userTask: 'do X',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    });
    expect(r.child).toBeDefined();
    expect(r.child).toBe(childRef);
  });

  it('child is EventEmitter-shaped (has .on for async error events)', async () => {
    const r = await dispatchDetached({
      sid: 's2', rid: 'r2', role: 'qa',
      vendor: 'codex', userTask: 'do Y',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    });
    expect(typeof r.child?.on).toBe('function');
  });

  it('preserves backward-compat fields (pid + dispatchRecordPath)', async () => {
    const r = await dispatchDetached({
      sid: 's3', rid: 'r3', role: 'ui',
      vendor: 'copilot', userTask: 'do Z',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    });
    expect(r.pid).toBe(7777);
    expect(r.dispatchRecordPath).toContain('dispatch-r3');
  });
});
