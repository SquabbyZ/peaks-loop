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
import { dispatchDetached } from '../../../../packages/peaks-loop-internal-runtime/src/dispatch';
import { ResourceBudgetGuard } from '../../../../packages/peaks-loop-internal-runtime/src/guards/resource-budget';

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
      'peaks sub-agent dispatch default mode remains in-process (backward compat)',
    );
  }

  // Task 11.5: ResourceBudgetGuard gate
  const maxConcurrent = f.maxConcurrent ?? 8;
  const guard = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
  const enforce = guard.enforce({ active: 1 }, { maxConcurrent });
  const warnings: string[] = [];
  if (enforce.throttle && !f.noThrottle) {
    throw new Error(
      'RESOURCE_BUDGET_THROTTLED: concurrent fan-out > max-concurrent; pass --no-throttle to bypass',
    );
  }
  if (f.noThrottle) {
    warnings.push('user-overrode: --no-throttle (peak runtime may exceed performance ceiling)');
  }

  const sid = process.env.PEAKS_SESSION_ID ?? 'local';
  const r = await dispatchDetached({
    sid,
    rid: f.requestId,
    role: f.role as 'rd' | 'qa' | 'ui' | 'txt' | 'general-purpose',
    vendor: (f.vendor ?? 'claude') as 'claude' | 'codex' | 'copilot',
    userTask: f.prompt,
    files: [],
    refs: [],
    runtimeDir: `.peaks/_runtime/${sid}/detached`,
    subAgentsDir: `.peaks/_sub_agents/${sid}`,
  });

  return {
    ok: true,
    command: 'sub-agent.dispatch.detached',
    data: {
      mode: 'detached',
      vendor: f.vendor,
      pid: r.pid,
      dispatchRecordPath: r.dispatchRecordPath,
      maxConcurrent,
      noThrottle: f.noThrottle ?? false,
      orchestratorVisibleHint: `⏳ Spawning detached sub-agent via ${f.vendor ?? 'claude'}: rid=${f.requestId} (ETA ~60s)`,
      expectedCompletionSeconds: 60,
    },
    warnings,
    nextActions: [
      'Sub-agent runs as detached OS process. Status at .peaks/_runtime/<sid>/detached/<rid>/status.json',
      'Use `peaks sub-agent list --mode detached` to monitor.',
      'Run `peaks sub-agent cleanup --orphan` to reap orphan processes (RL-15: user-only decision).',
    ],
  };
}