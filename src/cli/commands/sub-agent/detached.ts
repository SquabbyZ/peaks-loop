/**
 * Phase A Task 11 + 11.5: peaks sub-agent dispatch --mode detached CLI handler.
 * Vendor-neutral detached sub-agent dispatch. Spawns real OS process via
 * peaks-loop-internal-runtime/dispatch.dispatchDetached. --no-throttle and
 * --max-concurrent flags bypass / scope ResourceBudgetGuard (Task 11.5).
 *
 * Default mode is in-process (backward compat — existing 106+ tests untouched).
 * This handler only fires when the user explicitly passes --mode detached.
 * Spec: docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md §3.1 §5.3
 */
import { dispatchDetached, ResourceBudgetGuard } from 'peaks-loop-internal-runtime';

export interface DispatchFlags {
  role: string;
  prompt: string;
  requestId: string;
  mode?: 'in-process' | 'detached';
  vendor?: 'claude' | 'codex' | 'copilot';
  project: string;
  json: boolean;
  /** Task 11.5: bypass ResourceBudgetGuard (user accepts risk) */
  noThrottle?: boolean;
  /** Task 11.5: override max concurrent (default 8) */
  maxConcurrent?: number;
}

export async function dispatch(f: DispatchFlags) {
  if (f.mode !== 'detached') {
    throw new Error(
      'src/cli/commands/sub-agent/detached.ts only handles --mode detached; ' +
        'peaks sub-agent dispatch default mode remains in-process (backward compat)'
    );
  }

  // Task 11.5: ResourceBudgetGuard gate
  const maxConcurrent = f.maxConcurrent ?? 8;
  const guard = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
  const enforce = guard.enforce({ active: 1 }, { maxConcurrent });
  const warnings: string[] = [];
  if (enforce.throttle && !f.noThrottle) {
    throw new Error(
      'RESOURCE_BUDGET_THROTTLED: concurrent fan-out > max-concurrent; pass --no-throttle to bypass'
    );
  }
  if (f.noThrottle) {
    warnings.push('user-overrode: --no-throttle (peak runtime may exceed performance ceiling)');
  }

  // The vendor CLI's ChildProcess is owned by
  // peaks-loop-internal-runtime/dispatch.dispatchDetached, and this handler
  // deliberately attaches NO 'error' listener to it.
  //
  // The handler that used to live here — an 'error' listener attached to
  // `r.child` after the await — could never fire. `ProcessSupervisor.spawn`
  // attaches its own 'error' + 'spawn' listeners in the SAME synchronous turn
  // the child is created, and `dispatchDetached` awaits the resulting `settled` promise
  // before returning. A missing binary is emitted on the nextTick queue,
  // which drains BEFORE the awaiting caller resumes — so by the time this
  // function holds `r`, the event has already been consumed and turned into
  // the typed `spawnError` value below. Attaching a listener here is not
  // merely late; it is unreachable by construction.
  const sid = process.env.PEAKS_SESSION_ID ?? 'local';
  // `spawnError` is optional in this annotation, not because the value is
  // uncertain but because the type this resolves against is: the workspace
  // package's `types` entry points at `dist/index.d.ts`, and a `dist` built
  // before the field was added does not declare it. Reading it defensively
  // (`?? null`, below) is correct in both worlds; requiring it here would make
  // the handler fail to compile against a stale build.
  let r: { pid: number; dispatchRecordPath: string; spawnError?: NodeJS.ErrnoException | null };
  r = await dispatchDetached({
    sid,
    rid: f.requestId,
    role: f.role as 'rd' | 'qa' | 'ui' | 'txt' | 'general-purpose',
    vendor: (f.vendor ?? 'claude') as 'claude' | 'codex' | 'copilot',
    userTask: f.prompt,
    files: [],
    refs: [],
    runtimeDir: `.peaks/_runtime/${sid}/detached`,
    subAgentsDir: `.peaks/_sub_agents/${sid}`
  });
  // The launch outcome is the envelope's `ok`, not a footnote. A vendor CLI
  // that is not installed is an expected environment, and the dispatch record
  // already says `status: 'failed'`; the envelope used to say `ok: true` with
  // `pid: -1` and a "⏳ Spawning …" hint, so the two surfaces disagreed and the
  // orchestrator read a launch that never happened as a running one.
  //
  // `?? null` covers a DispatchResult-shaped value produced by a test double
  // that omits the field; a real `dispatchDetached` always sets it.
  const spawnError = r.spawnError ?? null;

  return {
    ok: spawnError === null,
    command: 'sub-agent.dispatch.detached',
    data: {
      mode: 'detached',
      vendor: f.vendor,
      pid: r.pid,
      dispatchRecordPath: r.dispatchRecordPath,
      maxConcurrent,
      noThrottle: f.noThrottle ?? false,
      ...(spawnError === null
        ? {
            orchestratorVisibleHint: `⏳ Spawning detached sub-agent via ${f.vendor ?? 'claude'}: rid=${f.requestId} (ETA ~60s)`
          }
        : {
            spawnError: { code: spawnError.code, message: spawnError.message },
            orchestratorVisibleHint: `❌ Could not launch detached sub-agent via ${f.vendor ?? 'claude'}: rid=${f.requestId} (${spawnError.code})`
          }),
      expectedCompletionSeconds: 60
    },
    warnings,
    nextActions:
      spawnError === null
        ? [
            'Sub-agent runs as detached OS process. Status at .peaks/_runtime/<sid>/detached/<rid>/status.json',
            'Use `peaks sub-agent list --mode detached` to monitor.',
            'Run `peaks sub-agent cleanup --orphan` to reap orphan processes (RL-15: user-only decision).'
          ]
        : [
            `The ${f.vendor ?? 'claude'} CLI is not runnable from this shell (${spawnError.code}); nothing was launched and no sub-agent is running.`,
            'Either install the vendor CLI on PATH, or re-dispatch without --mode detached to use the in-process path.'
          ]
  };
}
