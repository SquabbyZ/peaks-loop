/**
 * The two side-effecting phases of a run: prepare the artifacts, then dispatch.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import {
  type AutoCompactResult,
  type CompactDispatchResult,
  type ConvergencePlan
} from '../context/auto-compact-types.js';
import type { CompactTarget } from '../context/auto-compact-dispatcher.js';
import { CompactLifecyclePublisher, newCompactRunId } from './auto-compact-lifecycle.js';
import {
  appendAutoDecisionLog,
  compactNextActions,
  writeMainSessionCompactIntent,
  writePreCompactCheckpoint
} from './auto-compact-artifacts.js';
import { buildConvergencePlan } from './auto-compact-decision.js';
import { dispatchFailureResult, prepareFailureResult } from './auto-compact-envelopes.js';
import type { CompactRun } from './auto-compact-run-types.js';

export type PrepareOutcome =
  | {
      readonly ok: true;
      readonly lifecycle: CompactLifecyclePublisher;
      readonly checkpointPath: string;
      readonly plan: ConvergencePlan;
    }
  | { readonly ok: false; readonly envelope: AutoCompactResult };

/**
 * One runId per attempt, committed to compacting: the publisher is created at
 * `queued` and every later transition carries the same id forward. `preparing`
 * covers the checkpoint, the convergence plan and the decision-log write; a throw
 * in any of them rests the record at `failedAt: 'preparing'`.
 */
export function prepareCompactAttempt(ctx: CompactRun): PrepareOutcome {
  const { input, sessionId, probe, harnessWindow, isRedLine, now } = ctx;
  const lifecycle = new CompactLifecyclePublisher({
    projectRoot: input.projectRoot,
    sessionId,
    runId: newCompactRunId(now),
    triggerRatio: probe.ratio,
    redLine: isRedLine,
    onLifecycleStage: input.onLifecycleStage,
    failLifecycleWrite: input.testHooks?.failLifecycleWrite
  });
  lifecycle.advance('queued');
  try {
    lifecycle.advance('preparing');
    if (input.testHooks?.failPreparing) throw new Error('disk full while writing checkpoint');

    const checkpointPath = writePreCompactCheckpoint({
      projectRoot: input.projectRoot,
      sessionId,
      now,
      redLine: isRedLine
    });

    const plan = buildConvergencePlan({
      sessionId,
      projectRoot: input.projectRoot,
      ratio: probe.ratio,
      checkpointPath,
      nextActions: compactNextActions(isRedLine, harnessWindow),
      redLine: isRedLine
    });

    appendAutoDecisionLog({ projectRoot: input.projectRoot, sessionId, plan });
    return { ok: true, lifecycle, checkpointPath, plan };
  } catch (error) {
    lifecycle.fail(error);
    return { ok: false, envelope: prepareFailureResult(ctx, error) };
  }
}

export type DispatchOutcome =
  | {
      readonly ok: true;
      readonly target: CompactTarget;
      readonly dispatch: CompactDispatchResult;
    }
  | { readonly ok: false; readonly envelope: AutoCompactResult };

/**
 * The IDE-dispatch phase. The intent record is written only for `main`: without it
 * the main-session LLM has no signal that the orchestrator asked for compact, and
 * the dispatcher alone would have been a no-op against the main Claude Code window.
 */
export async function dispatchAttempt(args: {
  readonly ctx: CompactRun;
  readonly lifecycle: CompactLifecyclePublisher;
  readonly checkpointPath: string;
  readonly plan: ConvergencePlan;
}): Promise<DispatchOutcome> {
  const { ctx, lifecycle, checkpointPath, plan } = args;
  const { input, sessionId, probe, isRedLine, now } = ctx;
  const { dispatchIdeCompact } = await import('../context/auto-compact-dispatcher.js');
  const target: CompactTarget = input.target ?? 'main';

  try {
    if (input.testHooks?.failCompacting) throw new Error('IDE dispatch exploded');

    if (target === 'main') {
      writeMainSessionCompactIntent({
        projectRoot: input.projectRoot,
        sessionId,
        ratio: probe.ratio,
        redLine: isRedLine,
        now
      });
    }
    const dispatch = await dispatchIdeCompact({
      projectRoot: input.projectRoot,
      sessionId,
      env: input.env,
      target
    });
    return { ok: true, target, dispatch };
  } catch (error) {
    // `compacting` is the phase this failure died in — a phase label,
    // not a claim that a compaction was in flight.
    lifecycle.fail(error, 'compacting');
    return {
      ok: false,
      envelope: dispatchFailureResult(ctx, { checkpointPath, plan, target }, error)
    };
  }
}
