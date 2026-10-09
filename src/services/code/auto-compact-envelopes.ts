/**
 * The result envelopes `runAutoCompact` can return.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import {
  DEPRECATED_ENVELOPE_FIELDS,
  type AutoCompactResult,
  type CompactDispatchResult,
  type ConvergencePlan
} from '../context/auto-compact-types.js';
import {
  describeHarnessWindowSync,
  harnessWindowSyncWarning
} from '../context/harness-window-config.js';
import { describeMode, thresholdFor } from './auto-compact-modes.js';
import { summarizeLifecycleError } from './auto-compact-lifecycle.js';
import type { CompactTarget } from '../context/auto-compact-dispatcher.js';
import type { CompactRun } from './auto-compact-run-types.js';

/** No session is bound, so there is nothing to probe. */
export function noSessionResult(): AutoCompactResult {
  return {
    ok: false,
    code: 'AUTO_COMPACT_NO_SESSION',
    message: 'No active session; cannot run auto-compact. Run `peaks workspace init` first.',
    nextActions: ['Run `peaks workspace init --change-id <id>` to bind a session']
  };
}

/** The envelope for a probe that did not cross the auto-fire threshold. */
export function skipResult(ctx: CompactRun): AutoCompactResult {
  const { decision, probe, mode, harnessWindow, sessionId } = ctx;
  return {
    ok: true,
    code: decision.reason === 'in-flight-batch' ? 'AUTO_COMPACT_WAIT' : 'AUTO_COMPACT_SKIP',
    message: `${
      decision.trigger.kind === 'soft-warn'
        ? decision.trigger.message
        : decision.reason === 'in-flight-batch'
          ? `In-flight batch detected; deferring pre-compact (ratio=${(probe.ratio * 100).toFixed(1)}%); next probe will re-evaluate.`
          : `Context at ${(probe.ratio * 100).toFixed(1)}%; below the ${(thresholdFor(mode, 'autoFire') * 100).toFixed(0)}% auto-fire threshold (mode=${mode}).`
    }${
      // No compact was needed, but the sync may still have rewritten the harness's
      // settings (the first probe of a project always does). The notice is appended
      // ONLY for an actual write — the other actions' sentences would be noise on
      // every quiet probe — PLUS the one refusal that is not quiet: a refused write
      // that leaves peaks-loop's number and the harness's pinned window disagreeing.
      // That is the moment the ratio stops describing the harness's trigger, so
      // staying silent is exactly the failure 要告知 exists to prevent.
      harnessWindow !== null &&
      harnessWindow !== undefined &&
      (harnessWindow.action === 'written' || harnessWindowSyncWarning(harnessWindow) !== null)
        ? ` ${describeHarnessWindowSync(harnessWindow)}`
        : ''
    }`,
    data: {
      sessionId,
      ratio: probe.ratio,
      source: probe.source,
      decision: decision.reason === 'in-flight-batch' ? 'in-flight-batch' : 'below-threshold',
      harnessWindow
    }
  };
}

/**
 * The envelope for a throw during preparation. It preserves the original error
 * contract: the caller gets the `AUTO_COMPACT_DISPATCH_FAILED` shape it already
 * handles, not a thrown exception and not a widened type.
 */
export function prepareFailureResult(ctx: CompactRun, error: unknown): AutoCompactResult {
  const { input, sessionId, probe, mode, isRedLine, harnessWindow } = ctx;
  return {
    ok: false,
    code: 'AUTO_COMPACT_DISPATCH_FAILED',
    message: `Auto-compact preparation failed before IDE dispatch: ${summarizeLifecycleError(error)}`,
    data: {
      sessionId,
      ratio: probe.ratio,
      source: probe.source,
      target: input.target ?? 'main',
      mode,
      redLineRequested: isRedLine,
      // Compatibility alias + its record. `redLineGated` shipped from 2.13.0 to
      // 4.0.46, so a consumer outside this repo reads it and must not start
      // receiving `undefined`; the record is what makes the deprecation visible
      // to that consumer. See the type.
      redLineGated: isRedLine,
      deprecatedFields: DEPRECATED_ENVELOPE_FIELDS,
      harnessWindow
    }
  };
}

/** The envelope for a throw or a refusal during the IDE dispatch. */
export function dispatchFailureResult(
  ctx: CompactRun,
  attempt: {
    readonly checkpointPath: string;
    readonly plan: ConvergencePlan;
    readonly target: CompactTarget;
  },
  error: unknown
): AutoCompactResult {
  const { sessionId, probe, mode, isRedLine, harnessWindow } = ctx;
  return {
    ok: false,
    code: 'AUTO_COMPACT_DISPATCH_FAILED',
    message: `Auto-compact checkpoint written but IDE dispatch threw: ${summarizeLifecycleError(error)}`,
    data: {
      sessionId,
      ratio: probe.ratio,
      source: probe.source,
      checkpointPath: attempt.checkpointPath,
      convergencePlan: attempt.plan,
      target: attempt.target,
      mode,
      redLineRequested: isRedLine,
      redLineGated: isRedLine,
      deprecatedFields: DEPRECATED_ENVELOPE_FIELDS,
      harnessWindow
    }
  };
}

/** The envelope for a run that reached the dispatch phase. */
export function compactResult(
  ctx: CompactRun,
  attempt: {
    readonly checkpointPath: string;
    readonly plan: ConvergencePlan;
    readonly target: CompactTarget;
    readonly dispatch: CompactDispatchResult;
  }
): AutoCompactResult {
  const { checkpointPath, plan, target, dispatch } = attempt;
  const { probe, mode, isRedLine, harnessWindow, sessionId } = ctx;
  return {
    ok: dispatch.ok,
    code: dispatch.ok
      ? isRedLine
        ? 'AUTO_COMPACT_RED_LINE'
        : 'AUTO_COMPACT_DISPATCHED'
      : 'AUTO_COMPACT_DISPATCH_FAILED',
    message: dispatch.ok
      ? isRedLine
        ? `RED-LINE: harness compact REQUESTED (${dispatch.ide} / ${dispatch.pathway} / target=${target} / mode=${mode} — ${describeMode(mode)}); checkpoint at ${checkpointPath}. Sub-agent dispatch is NOT blocked — keep working and re-probe with \`peaks code context-now\`.`
        : `Auto-compact dispatched (${dispatch.ide} / ${dispatch.pathway} / target=${target} / mode=${mode} — ${describeMode(mode)}); checkpoint at ${checkpointPath}.`
      : `Auto-compact checkpoint written but IDE dispatch failed: ${dispatch.message}`,
    data: {
      sessionId,
      ratio: probe.ratio,
      source: probe.source,
      checkpointPath,
      convergencePlan: plan,
      dispatch,
      target,
      mode,
      redLineRequested: isRedLine,
      redLineGated: isRedLine,
      deprecatedFields: DEPRECATED_ENVELOPE_FIELDS,
      harnessWindow
    }
  };
}
