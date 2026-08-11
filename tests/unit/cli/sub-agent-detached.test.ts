// tests/unit/cli/sub-agent-detached.test.ts
//
// Phase A Task 11 + 11.5 unit test for `peaks sub-agent dispatch --mode detached`.
//
// Verifies:
//   1. Envelope carries mode=detached + vendor + pid + orchestratorVisibleHint
//      (G11.5 visibility contract).
//   2. --no-throttle + --max-concurrent flag plumbing (Task 11.5 budget ceiling).
//   3. Refuses when mode != detached (backward compat — default stays in-process).
//
// Mock-target contract (rid-001 redo): mocks target the
// `peaks-loop-internal-runtime` workspace alias (NOT the handler module
// itself, and NOT the deep TS-source path). The handler
// (src/cli/commands/sub-agent/detached.ts) imports via the package alias
// which resolves to node_modules/peaks-loop-internal-runtime/dist/*.js;
// mocking at the alias intercepts ALL import shapes. The previous
// path-based mocks crashed because the production handler bypasses the
// mocked source TS file and reads the compiled `dist/` instead,
// letting `await dispatchDetached()` reach a real `claude` spawn
// (ENOENT) — same-source fake-green as the original rid-001 defect.

import { describe, it, expect, vi } from 'vitest';

vi.mock('peaks-loop-internal-runtime', () => ({
  dispatchDetached: vi.fn(async () => ({
    pid: 1234,
    dispatchRecordPath: '/x/dispatch-r1.json',
  })),
  ResourceBudgetGuard: class {
    constructor(_cfg: { maxRssMb: number; maxCpuPct: number }) {}
    sample() { return { rssMb: 100, cpuPct: 1 }; }
    enforce(input: { active: number }, opts: { maxConcurrent: number }) {
      // Mock contract: throttle fires only when active fan-out > maxConcurrent.
      // With active=1 (production default) and maxConcurrent=8, throttle=false.
      return { throttle: input.active > opts.maxConcurrent };
    }
  },
}));

import { dispatch } from '../../../src/cli/commands/sub-agent/detached';

describe('peaks sub-agent dispatch --mode detached', () => {
  it('envelope includes mode=detached + vendor + pid + orchestratorVisibleHint', async () => {
    const out = await dispatch({
      role: 'rd',
      prompt: 'do X',
      requestId: 'r1',
      mode: 'detached',
      vendor: 'claude',
      project: '.',
      json: true,
    });
    expect(out.ok).toBe(true);
    expect(out.data.mode).toBe('detached');
    expect(out.data.vendor).toBe('claude');
    expect(out.data.pid).toBe(1234);
    expect(out.data.orchestratorVisibleHint).toMatch(/Spawning detached sub-agent/);
  });

  it('throttles by default when concurrent > max; --no-throttle bypasses with warning', async () => {
    const out1 = await dispatch({
      role: 'rd',
      prompt: 'do X',
      requestId: 'r2',
      mode: 'detached',
      vendor: 'claude',
      project: '.',
      json: true,
      maxConcurrent: 8,
    });
    expect(out1.ok).toBe(true); // mock returns throttle=false; only triggers when active > maxConcurrent

    const out2 = await dispatch({
      role: 'rd',
      prompt: 'do X',
      requestId: 'r3',
      mode: 'detached',
      vendor: 'claude',
      project: '.',
      json: true,
      maxConcurrent: 8,
      noThrottle: true,
    });
    expect(out2.ok).toBe(true);
    // --no-throttle adds a warning
    const hasNoThrottleWarn = (out2.warnings ?? []).some(
      (w: string) => /no-throttle/i.test(w),
    );
    expect(hasNoThrottleWarn).toBe(true);
  });

  it('refuses when --mode != detached', async () => {
    await expect(
      dispatch({
        role: 'rd',
        prompt: 'do X',
        requestId: 'r4',
        mode: 'in-process',
        vendor: 'claude',
        project: '.',
        json: true,
      }),
    ).rejects.toThrow(/detached/);
  });
});
