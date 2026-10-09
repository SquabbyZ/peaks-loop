// Split out of `request-commands.ts`: the two
// best-effort hooks attached to a completed `peaks request transition` — the
// rd→qa pre-compact checkpoint + codegraph refresh, and the prd→handed-off
// handoff auto-regen envelope.
import { ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import type {
  RequestArtifactRole,
  RequestArtifactState,
  transitionRequestArtifact
} from '../../services/artifacts/request-artifact-service.js';
import {
  codegraphRefreshNotice,
  refreshCodegraphAfterSlice,
  type CodegraphAutorefreshResult
} from '../../services/codegraph/codegraph-autorefresh.js';
import { triggerBestPracticeScan } from '../../services/prd/best-practice-auto-trigger.js';
import type { RequestTransitionOptions } from './request-command-options.js';

export type TransitionResult = NonNullable<Awaited<ReturnType<typeof transitionRequestArtifact>>>;

export type TransitionHooks = {
  preCompact: ResultEnvelope<unknown> | null;
  codegraphRefresh: CodegraphAutorefreshResult | null;
  codegraphWarning: string | null;
};

type PrdHandoffContext = {
  role: RequestArtifactRole;
  newState: RequestArtifactState;
  requestId: string;
  options: RequestTransitionOptions;
  result: TransitionResult;
};

const NO_HOOKS: TransitionHooks = {
  preCompact: null,
  codegraphRefresh: null,
  codegraphWarning: null
};

/**
 * The RD → QA slice-complete boundary. Set only for rd:qa-handoff; null
 * otherwise. Best-effort and fail-silent — never blocks the transition.
 *
 * When transitioning across the RD → QA boundary (rd:qa-handoff), check the
 * active session's context-fill ratio. If it is in the 0.85–0.95 pre-compact
 * zone, write a checkpoint BEFORE the transition completes and attach
 * `preCompactCheckpoint: true` to the response envelope. The LLM remains the
 * decision-maker; this hook only surfaces the signal. At ratio ≥ 0.95 the
 * auto-compact orchestrator ASKS the harness to compact and reports that it is
 * waiting; it does not refuse anything, because peaks-loop has no executor for
 * a running session and a refusal it cannot enforce only deadlocked the runner.
 *
 * A2 (2026-09-17): never BLOCKING is kept; never VISIBLE is not. A non-refresh
 * while a codegraph store is in use becomes a warning line beside the
 * transition's own notes. See `codegraphRefreshNotice` for why
 * `no-codegraph-dir` stays silent.
 */
export async function collectQaHandoffHooks(
  role: RequestArtifactRole,
  newState: RequestArtifactState,
  sessionId: string,
  project: string
): Promise<TransitionHooks> {
  if (role !== 'rd' || newState !== 'qa-handoff') return NO_HOOKS;
  let preCompact: ResultEnvelope<unknown> | null = null;
  let codegraphRefresh: CodegraphAutorefreshResult | null = null;
  try {
    const { maybePreCompactCheckpoint } =
      await import('../../services/compact/request-transition-hook.js');
    const hook = maybePreCompactCheckpoint({
      projectRoot: project,
      sessionId,
      transitionKey: `${role}:${newState}`
    });
    preCompact = hook.triggered ? ok('request.transition.preCompact', hook) : null;
  } catch {
    // The hook is best-effort; never block the transition.
    preCompact = null;
  }
  try {
    codegraphRefresh = await refreshCodegraphAfterSlice(project);
  } catch {
    // The refresh is best-effort; never block the transition.
    codegraphRefresh = {
      refreshed: false,
      reason: 'unavailable',
      note: 'auto codegraph refresh failed after transition'
    };
  }
  return {
    preCompact,
    codegraphRefresh,
    codegraphWarning: codegraphRefreshNotice(codegraphRefresh)
  };
}

/**
 * Only fires when the handoff is missing; existing handoffs are not
 * overwritten. Post-step after peaks-prd's businessGoal artifact transitions to
 * `handed-off` (the canonical "complete" state in the prd state machine). The
 * trigger is fire-and-forget: failure NEVER blocks the transition.
 */
export async function buildPrdHandoffResult(
  ctx: PrdHandoffContext
): Promise<ResultEnvelope<unknown> | null> {
  const { role, newState, requestId, options, result } = ctx;
  if (role !== 'prd' || newState !== 'handed-off' || options.sessionId === undefined) {
    return null;
  }
  const { autoRegenPrdHandoff } = await import('../../services/prd/handoff-auto-regen.js');
  const regen = await autoRegenPrdHandoff({
    projectRoot: options.project,
    sessionId: result.sessionId,
    requestId,
    role: 'prd'
  });
  const bpsTrigger = await triggerBestPracticeScan({
    projectRoot: options.project,
    sessionId: result.sessionId,
    requestId
  });
  const handoffAutoRegen =
    regen.status === 'created'
      ? { status: 'created', path: regen.path, sha256: regen.sha256 }
      : regen.status === 'skipped-exists'
        ? { status: 'skipped-exists', path: regen.path }
        : { status: 'failed', reason: regen.reason };
  const notes: string[] = [];
  if (regen.status === 'failed') {
    notes.push(`prd handoff auto-regen failed: ${regen.reason}`);
  }
  if (bpsTrigger.status === 'failed') {
    notes.push(`best-practice-scan auto-trigger failed: ${bpsTrigger.reason ?? 'unknown'}`);
  }
  return ok(
    'request.transition',
    { ...result, handoffAutoRegen, bestPracticeScanTrigger: bpsTrigger },
    notes
  );
}

/**
 * The pre-compact signal rendered into the final envelope's `nextActions`.
 * `null` when the hook did not trigger (zone is not pre-compact OR the
 * transition is not a slice boundary).
 */
export function preCompactNote(preCompact: ResultEnvelope<unknown> | null): string | null {
  if (preCompact === null) return null;
  const ratio =
    typeof preCompact.data === 'object' && preCompact.data !== null && 'ratio' in preCompact.data
      ? String((preCompact.data as { ratio: number }).ratio)
      : 'unknown';
  return `Pre-compact checkpoint written at ratio=${ratio} (zone=pre-compact)`;
}
