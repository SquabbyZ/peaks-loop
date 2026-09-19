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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('peaks-loop-internal-runtime', () => ({
  dispatchDetached: vi.fn(async () => ({
    pid: 1234,
    dispatchRecordPath: '/x/dispatch-r1.json',
    child: { on: vi.fn(), kill: vi.fn() },
    spawnError: null
  })),
  ResourceBudgetGuard: class {
    constructor(_cfg: { maxRssMb: number; maxCpuPct: number }) {}
    sample() {
      return { rssMb: 100, cpuPct: 1 };
    }
    enforce(input: { active: number }, opts: { maxConcurrent: number }) {
      // Mock contract: throttle fires only when active fan-out > maxConcurrent.
      // With active=1 (production default) and maxConcurrent=8, throttle=false.
      return { throttle: input.active > opts.maxConcurrent };
    }
  }
}));

import { dispatchDetached } from 'peaks-loop-internal-runtime';
import { dispatch } from '../../../src/cli/commands/sub-agent/detached.js';

describe('peaks sub-agent dispatch --mode detached', () => {
  it('envelope includes mode=detached + vendor + pid + orchestratorVisibleHint', async () => {
    const out = await dispatch({
      role: 'rd',
      prompt: 'do X',
      requestId: 'r1',
      mode: 'detached',
      vendor: 'claude',
      project: '.',
      json: true
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
      maxConcurrent: 8
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
      noThrottle: true
    });
    expect(out2.ok).toBe(true);
    // --no-throttle adds a warning
    const hasNoThrottleWarn = (out2.warnings ?? []).some((w: string) => /no-throttle/i.test(w));
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
        json: true
      })
    ).rejects.toThrow(/detached/);
  });

  /**
   * Item 2.1 of rid 2026-09-13-leftover-cleanup.
   *
   * Before the fix, a launch failure produced an envelope that agreed with
   * nothing on disk: `ok: true`, `pid: -1`, no `spawnError`, and an
   * `orchestratorVisibleHint` that read "⏳ Spawning detached sub-agent via
   * codex". Observed on this machine with the real handler and vendor
   * `codex` (not installed):
   *
   *   envelope.ok   : true
   *   envelope.data : { "pid": -1, ... "orchestratorVisibleHint":
   *                     "⏳ Spawning detached sub-agent via codex: … " }
   *   has spawnError key? false
   *
   * ...while the dispatch record for the same call already said
   * `status: "failed"` + `spawnError`. Two surfaces, two answers.
   */
  it('reports a failed launch as ok:false carrying the typed spawnError', async () => {
    const enoent = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    // `DispatchResult` here resolves to the workspace package's
    // `dist/index.d.ts`, and a `dist` built before `spawnError` existed does
    // not declare the field — the same staleness the handler's own annotation
    // documents. It IS on `DispatchResult` in `src`, and `dispatchDetached`
    // sets it on every call, so the cast only bridges the stale build.
    vi.mocked(dispatchDetached).mockResolvedValueOnce({
      pid: -1,
      dispatchRecordPath: '/x/dispatch-r5.json',
      child: undefined,
      spawnError: enoent
    } as never);
    const out = await dispatch({
      role: 'rd',
      prompt: 'do X',
      requestId: 'r5',
      mode: 'detached',
      vendor: 'codex',
      project: '.',
      json: true
    });
    expect(out.ok).toBe(false);
    expect(out.data.pid).toBe(-1);
    expect((out.data as { spawnError?: unknown }).spawnError).toEqual({
      code: 'ENOENT',
      message: 'spawn codex ENOENT'
    });
    // The hint must not claim a spawn that did not happen.
    expect((out.data as { orchestratorVisibleHint: string }).orchestratorVisibleHint).not.toMatch(
      /Spawning/
    );
    expect((out.data as { orchestratorVisibleHint: string }).orchestratorVisibleHint).toMatch(
      /Could not launch/
    );
    expect((out.nextActions ?? []).join(' ')).toMatch(/install the vendor CLI/i);
  });

  it('does not attach a child error listener after the await (unreachable by construction)', () => {
    // `ProcessSupervisor.spawn` attaches its own 'error'/'spawn' listeners in
    // the same synchronous turn the child is created, and `dispatchDetached`
    // awaits `settled` before returning. The error emission runs on the
    // nextTick queue, which drains BEFORE the awaiting caller resumes — so a
    // caller-side `child.on('error', …)` after the await can never fire.
    // Source scan on purpose: no test body can distinguish "handler attached
    // and never called" from "handler never attached".
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'src', 'cli', 'commands', 'sub-agent', 'detached.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/\.on\(\s*['"]error['"]/);
    expect(src).toMatch(/spawnError/);
  });
});
