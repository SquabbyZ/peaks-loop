/**
 * Drives the whole compaction of a session's context.
 *
 * peaks-loop knows the current plan, open questions, recent decisions, in-flight
 * batches, todo state, git status, and active skills. That context is strictly more
 * valuable than what `/compact` can synthesise from raw conversation history — so
 * peaks-loop drives the entire compaction:
 *
 *   1. Read the current context % (via the IDE adapter's `readContextPercent`).
 *   2. If the ratio ≥ the mode's red line: peaks-loop ASKS the harness to compact and
 *      reports that it is waiting. It does NOT block sub-agent dispatch — the harness
 *      owns the *capability*, peaks-loop only owns the *decision*, and peaks-loop has
 *      no way to compact a running session itself, so a "gate" here gated nothing and
 *      deadlocked the runner at the worst moment. If the ratio keeps rising and the
 *      harness has not compacted, the honest move is to say so and hand control back.
 *   3. If the ratio ≥ the mode's auto-fire threshold: peaks-loop prepares the
 *      convergence toolkit (checkpoint + auto-decisions log + IDE-dispatch handle) and
 *      fires it without LLM confirmation.
 *   4. Below that: skip — return a one-line info row.
 *
 * The tiers exist so the ratio is never left to drift: peaks-loop preempts at the
 * auto-fire threshold, and the LLM is not asked to guess when to compact.
 *
 * This file owns the run: one probe, one decision, one attempt. The decision table
 * lives in `auto-compact-decision.js`, the artifacts in `auto-compact-artifacts.js`,
 * and the envelopes in `auto-compact-envelopes.js`.
 */
import { getSessionIdCanonical } from '../session/session-manager.js';
import { resolveOuterSessionId } from '../session/binding-status-service.js';
import { resolveCanonicalProjectRoot } from '../config/config-service.js';
import { type AutoCompactMode, thresholdFor } from './auto-compact-modes.js';
import { resolveAutoCompactProfile } from '../mode/mode-status-service.js';
import {
  fillEventSettledMeasurement,
  resolveDispatchedStage,
  settleOpenLifecycleRun
} from './auto-compact-lifecycle.js';
import { evaluateAutoCompactDecision } from './auto-compact-decision.js';
import { appendCompactHistoryEvent, type CompactHistoryEvent } from './auto-compact-history.js';
import { readOpenRunGate } from './auto-compact-dispatch-gate.js';
import { dispatchAttempt, prepareCompactAttempt } from './auto-compact-attempt.js';
import { compactResult, noSessionResult, skipResult } from './auto-compact-envelopes.js';
import type {
  AutoCompactResult,
  CompactDispatchResult,
  CompactTrigger,
  ConvergencePlan,
  ContextPercentProbe,
  InFlightBatchProbe
} from '../context/auto-compact-types.js';
import type { HarnessWindowSyncResult } from '../context/harness-window-config.js';
import type { CompactTarget } from '../context/auto-compact-dispatcher.js';
import type { AutoCompactInput, CompactRun } from './auto-compact-run-types.js';

// Declared here or in an `auto-compact-*` sibling; the exported surface is the same.
export type { AutoCompactInput, AutoCompactTestHooks } from './auto-compact-run-types.js';
export {
  evaluateCompactTrigger,
  evaluateAutoCompactDecision,
  buildConvergencePlan
} from './auto-compact-decision.js';
export type { CompactHistoryEvent } from './auto-compact-history.js';
export { appendCompactHistoryEvent } from './auto-compact-history.js';
export type { CompactTrigger, ConvergencePlan, InFlightBatchProbe, AutoCompactResult };

/**
 * The below-threshold path still has work to do: a ratio that has fallen back under
 * the auto-fire threshold is the real, measured proof that a previously-dispatched
 * compact landed, so any run still open at `compacting` is settled here. Nothing is
 * written when there is no open run, when the ratio is still high, or when the probe
 * could not measure at all.
 */
function settleBelowThreshold(ctx: CompactRun): void {
  const { input, sessionId, probe, mode } = ctx;
  const settleRead = settleOpenLifecycleRun({
    projectRoot: input.projectRoot,
    sessionId,
    measuredRatio: probe.ratio,
    source: probe.source,
    autoFireThreshold: thresholdFor(mode, 'autoFire'),
    onLifecycleStage: input.onLifecycleStage,
    failLifecycleWrite: input.testHooks?.failLifecycleWrite
  });
  // A settle whose lifecycle write FAILED has not settled the run — the record still
  // rests at `armed` / `compacting`, so the next probe finds the same run open and
  // retries. Appending the "observed compaction point" row anyway would write one row
  // per probe for a compaction the store never recorded: an unbounded append driven by
  // a write that did not happen. Nothing is lost by deferring — `probe.ratio` is
  // re-measured on every probe, so the retry carries a fresh number.
  const settled =
    settleRead !== null && !settleRead.lifecycleWritten
      ? null
      : (settleRead ??
        // The event path may have closed this run WITHOUT an honest post-compact
        // number — the call above then finds nothing open, and without this the
        // calibration pair stays blank for exactly the compactions the event path
        // exists to witness. Fills the number the event owed.
        fillEventSettledMeasurement({
          projectRoot: input.projectRoot,
          sessionId,
          measuredRatio: probe.ratio,
          source: probe.source
        }));
  // A dispatched compact demonstrably landed: append an `observed` row carrying the
  // measured ratio, so `peaks compact history` can show "asked at R (intent) / landed
  // by R' (observed)" once a real session has run. Without this row the intent has
  // nothing to be compared against.
  if (settled === null) return;
  appendObservedCompactEvent({
    projectRoot: input.projectRoot,
    sessionId,
    event: {
      schemaVersion: 1,
      kind: 'observed',
      ts: new Date().toISOString(),
      target: input.target ?? 'main',
      mode,
      ide: probe.ide,
      pathway: 'post-compact-probe',
      beforeRatio: settled.triggerRatio,
      afterRatio: probe.ratio,
      redLine: false,
      ok: true,
      checkpointPath: '',
      dispatchMessage: `post-compact probe measured ratio ${(probe.ratio * 100).toFixed(1)}% (source=${probe.source}) after the compact dispatched at ${(settled.triggerRatio * 100).toFixed(1)}%`,
      windowTokens: probe.capacityTokens ?? null,
      windowSource: probe.capacitySource ?? null
    }
  });
}

/**
 * Execute the auto-compact flow. The caller handles the return — the post-compact
 * detector picks the checkpoint up on the next turn. For the red line the caller keeps
 * working: it re-probes and, if the ratio is still rising with no compact from the
 * harness, reports that instead of stalling.
 */
export async function runAutoCompact(input: AutoCompactInput): Promise<AutoCompactResult> {
  const sessionId = input.sessionId ?? getSessionIdCanonical(input.projectRoot);
  if (sessionId === null) return noSessionResult();
  const mode: AutoCompactMode = input.mode ?? resolveAutoCompactProfile(input.projectRoot);
  const ctx = await openRun(input, sessionId, mode);
  if (!ctx.decision.shouldCompact) {
    settleBelowThreshold(ctx);
    return skipResult(ctx);
  }

  const armed = readOpenRunGate(ctx);
  if (armed !== null) return armed;

  const attempt = prepareCompactAttempt(ctx);
  if (!attempt.ok) return attempt.envelope;
  const { lifecycle, checkpointPath, plan } = attempt;
  const dispatched = await dispatchAttempt({ ctx, lifecycle, checkpointPath, plan });
  if (!dispatched.ok) return dispatched.envelope;

  // The stage is chosen from what the dispatch ACTUALLY did, never from the hope that it
  // compacted. `ide-native` on claude-code only installs a PreToolUse hook that fires at
  // the red line — below that nothing is in flight and the honest stage is `armed`.
  // Writing `compacting` there published a heartbeat that would never arrive, which is
  // exactly what pinned the statusline at `stalled` for 92 minutes in the field. A
  // dispatcher that returns `ok: false` compacted nothing either, so it is recorded as a
  // failure at `compacting` rather than left looking in progress.
  if (dispatched.dispatch.ok) {
    lifecycle.advance(
      resolveDispatchedStage({ pathway: dispatched.dispatch.pathway, ratio: ctx.probe.ratio })
    );
  } else {
    lifecycle.fail(new Error(dispatched.dispatch.message), 'compacting');
  }
  appendDispatchHistory(ctx, checkpointPath, dispatched.dispatch, dispatched.target);
  return compactResult(ctx, {
    checkpointPath,
    plan,
    target: dispatched.target,
    dispatch: dispatched.dispatch
  });
}

/** One probe, one window sync, one decision — the state every phase below reads. */
async function openRun(
  input: AutoCompactInput,
  sessionId: string,
  mode: AutoCompactMode
): Promise<CompactRun> {
  const { readContextPercent, syncHarnessWindowForProject } =
    await import('../context/auto-compact-reader.js');
  const probe: ContextPercentProbe = readContextPercent({
    projectRoot: input.projectRoot,
    sessionId,
    outerSessionId: resolveOuterSessionId(input.projectRoot, sessionId, input.env ?? process.env),
    env: input.env
  });
  // The probe's denominator is materialized into the harness's own machine-local
  // settings, so "peaks-loop's 85%" and "the harness's trigger" are the same point on one
  // scale. Idempotent — an unchanged value performs no write. The project root is
  // promoted to the git root first (`--project .` is what the PreToolUse hook passes):
  // the harness's settings live at the project root, and the envelope must report an
  // absolute path for the write it claims to have made. Fail-open.
  const harnessWindow: HarnessWindowSyncResult | null = syncHarnessWindowForProject({
    projectRoot: resolveCanonicalProjectRoot(input.projectRoot),
    env: input.env,
    tokens: probe.capacityTokens ?? null
  });
  const decision = evaluateAutoCompactDecision({
    ratio: probe.ratio,
    // Production `inFlightBatch` MUST come from the graph probe. The legacy boolean is
    // preserved as a TEST-ONLY seam: when `probeInflightBatch` is supplied we call it and
    // pass an `InFlightBatchProbe`, so the pure decision sees a graph-backed value. The
    // CLI gates the boolean behind `PEAKS_TEST_SEAM === '1'`.
    inFlightBatch:
      input.probeInflightBatch !== undefined
        ? { hasInFlightBatch: input.probeInflightBatch() }
        : input.inFlightBatch,
    force: input.force,
    bypassRedLine: input.bypassRedLine,
    mode,
    // Tagged through so the decision can apply the source-aware carve-out for Mac's
    // `transcript-estimate` signal.
    source: probe.source
  });
  return {
    input,
    sessionId,
    mode,
    probe,
    harnessWindow,
    decision,
    isRedLine: decision.reason === 'red-line',
    now: input.now ?? new Date()
  };
}

/**
 * Append the dispatch row the history CLI and the statusline indicator read. Best
 * effort: a write failure must NOT block the compact return.
 */
function appendDispatchHistory(
  ctx: CompactRun,
  checkpointPath: string,
  dispatch: CompactDispatchResult,
  target: CompactTarget
): void {
  const { input, sessionId, probe, mode, isRedLine, now } = ctx;
  try {
    appendCompactHistoryEvent({
      projectRoot: input.projectRoot,
      sessionId,
      event: {
        schemaVersion: 1,
        kind: 'dispatch',
        ts: now.toISOString(),
        target,
        mode,
        ide: dispatch.ide,
        pathway: dispatch.pathway,
        beforeRatio: probe.ratio,
        redLine: isRedLine,
        ok: dispatch.ok,
        checkpointPath,
        dispatchMessage: dispatch.message,
        // T4 calibration: the exact denominator this dispatch divided by, so
        // `beforeRatio * windowTokens` is the token point we asked for.
        windowTokens: probe.capacityTokens ?? null,
        windowSource: probe.capacitySource ?? null
      }
    });
  } catch {
    /* best-effort; do not fail the compact return */
  }
}

/** Best-effort variant for the post-compact measurement row. Telemetry must never change the probe's return envelope. */
function appendObservedCompactEvent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly event: CompactHistoryEvent;
}): void {
  try {
    appendCompactHistoryEvent(input);
  } catch {
    /* best-effort; the probe result is already settled */
  }
}
