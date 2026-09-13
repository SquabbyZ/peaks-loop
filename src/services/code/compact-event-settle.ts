/**
 * rid `2026-09-13-compact-event-settle` — what runs when the HARNESS says a
 * compaction completed.
 *
 * THE PROBLEM THIS EXISTS TO DELETE. Before this slice peaks-loop learned that
 * a compaction had happened by INFERENCE: `src/services/code/auto-compact-orchestrator.ts`
 * probes the context ratio on every run, and a ratio that has fallen back below
 * the auto-fire threshold is taken as proof that a previously-dispatched
 * compact landed. That is a guess with three failure modes, all silent — the
 * probe may not measure at all (`conservative-fallback`), the next probe may
 * not come for minutes (during which the ratio has already climbed back up),
 * and a compaction that left the ratio high is invisible.
 *
 * `PostCompact` is the harness STATING it. This module turns that statement
 * into the same lifecycle settlement the probe path produces, plus an
 * `observed` row carrying the one fact the probe path can never produce: what
 * the harness said the compaction WAS — `manual` or `auto`.
 *
 * FOUR THINGS THIS MODULE REFUSES TO DO, EACH FOR A REASON:
 *
 *   1. It does not invent a `trigger`. `PostCompact`'s payload schema is
 *      truncated in the retrievable docs, so a payload without the field is an
 *      expected input. Absent stays absent. Defaulting it to `'auto'` would
 *      answer "has this machine ever auto-compacted?" with a fabricated yes,
 *      which is worse than the current "no answer".
 *   2. It does not settle when no run is open. A `PostCompact` on a session
 *      peaks-loop never dispatched for has nothing to attribute, and
 *      `CompactHistoryEvent.beforeRatio` is a required number that could only
 *      be filled with a ratio measured AFTER the compaction — a fabricated
 *      "before". See the RD tech-doc §D8: covering that case needs a
 *      `PreCompact` snapshot and is a separate slice, not a widened contract.
 *   3. It does not let a stale measurement become an `afterRatio`. The probe's
 *      statusline source may still hold the pre-compact value at the instant
 *      this runs; `settleOpenLifecycleRunOnCompactEvent` drops anything that is
 *      not below the dispatch ratio.
 *   4. It does not settle a run off an event that names a DIFFERENT harness
 *      session, and it does not label one `'main'` without checking. A payload
 *      whose `session_id` is another session's would otherwise close this
 *      project's open run and file the row as the main session's. The check is
 *      best-effort in one direction only: an absent `session_id`, or a project
 *      whose own harness session id cannot be resolved, is accepted rather than
 *      refused — a guard that cannot see the name it is checking against must
 *      not turn a missing field into a hook that never settles anything.
 *
 * NOTHING HERE THROWS. The caller is a hook on the harness's compaction path,
 * where a failure must cost a telemetry row and nothing else.
 */
import { resolveAutoCompactProfile } from '../mode/mode-status-service.js';
import { readContextPercent } from '../context/auto-compact-reader.js';
import { resolveOuterSessionId } from '../session/binding-status-service.js';
import { appendCompactHistoryEvent } from './auto-compact-orchestrator.js';
import { settleOpenLifecycleRunOnCompactEvent } from './auto-compact-lifecycle.js';
import type { CompactHistoryEvent } from '../compact-history/compact-history-service.js';

/** The harness's own report of what caused a compaction. */
export type CompactTrigger = 'manual' | 'auto';

/**
 * Which layer settled the run. `post-compact-hook` = the harness's event;
 * `post-compact-probe` (written by the orchestrator) = a later probe's
 * measurement. The two are deliberately distinct strings so a reader of
 * `compact-history.jsonl` can tell a NOTIFICATION from an INFERENCE — which is
 * the entire instrument this slice exists to build.
 */
export const COMPACT_EVENT_PATHWAY = 'post-compact-hook';

/**
 * One post-compact reading: the ratio, the window it was divided by, and the
 * adapter that produced it — all from a SINGLE probe call, so the three cannot
 * disagree with each other.
 */
export type PostCompactMeasurement = {
  /** `null` = nothing could be measured. Never `0`, which means "unknown". */
  readonly ratio: number | null;
  readonly ide: string;
  readonly windowTokens: number | null;
  readonly windowSource: string | null;
};

export type CompactSettleResult =
  | {
      readonly settled: true;
      readonly runId: string;
      readonly beforeRatio: number;
      /** The measured post-compact ratio, or `null` when none was trustworthy. */
      readonly afterRatio: number | null;
      /** Present only when the harness reported one. */
      readonly trigger?: CompactTrigger;
      /**
       * False when the run settled but the `observed` row could not be
       * appended. The settlement is the load-bearing half and is never undone
       * for this, but the two outcomes are not the same fact.
       */
      readonly historyWritten: boolean;
      /**
       * False when the lifecycle record could not be written. The run is then
       * still open, so a later probe will settle it from its own measurement —
       * but the `observed` row is appended anyway, because the harness's
       * statement is evidence independent of that write. The two failures are
       * reported separately rather than collapsed: a caller that sees only one
       * of them cannot say which half of the settlement landed.
       */
      readonly lifecycleWritten: boolean;
    }
  | {
      readonly settled: false;
      /**
       * `nothing-to-settle` — there was no open run. `different-session` — the
       * payload named a harness session that is not this project's, so the open
       * run was left alone. The second is a refusal of ATTRIBUTION, not an
       * absence of it, and a reader told "nothing was open" would be told
       * something false.
       */
      readonly reason: 'nothing-to-settle' | 'different-session';
    };

/**
 * Read `trigger` out of an already-parsed `PostCompact` payload.
 *
 * Anything that is not exactly `'manual'` or `'auto'` yields `undefined` — a
 * missing field, a `null`, a number, another string, a payload that is not an
 * object at all. This function never throws and never guesses (see this file's
 * header, refusal 1).
 */
export function readTriggerFromHookPayload(payload: unknown): CompactTrigger | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const raw = (payload as { trigger?: unknown }).trigger;
  return raw === 'manual' || raw === 'auto' ? raw : undefined;
}

/**
 * Read the harness session id out of an already-parsed `PostCompact` payload.
 *
 * Same contract as `readTriggerFromHookPayload`: a missing field, an empty
 * string, a number, a non-object payload — every one of those is `undefined`,
 * and "absent" is an expected input rather than an error (see this file's
 * header, refusal 4, for what the caller does with it and what it does with
 * `undefined`).
 */
export function readSessionIdFromHookPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const raw = (payload as { session_id?: unknown }).session_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * The post-compact ruler: the same probe the orchestrator uses, so this row
 * divides by the same denominator the dispatch did.
 *
 * `ratio` is `null` when nothing could be measured — a `conservative-fallback`
 * probe reports `0`, but that `0` means "unknown", and recording it here would
 * publish a real, infinitely-deep drop. The rest of the reading (adapter, the
 * window the ratio divides by) is still carried, because knowing WHICH adapter
 * could not measure is diagnostic.
 */
export function measurePostCompact(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env: NodeJS.ProcessEnv;
}): PostCompactMeasurement {
  const probe = readContextPercent({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    outerSessionId: resolveOuterSessionId(input.projectRoot, input.sessionId, input.env),
    env: input.env
  });
  const unmeasurable = probe.source === 'conservative-fallback';
  return {
    ratio: unmeasurable ? null : probe.ratio,
    ide: probe.ide,
    windowTokens: unmeasurable || typeof probe.capacityTokens !== 'number' ? null : probe.capacityTokens,
    windowSource: unmeasurable ? null : (probe.capacitySource ?? null)
  };
}

/**
 * Settle whatever compact run is open in `sessionId`, because the harness just
 * reported one.
 *
 * `measure` is the ruler, injected rather than called directly for one concrete
 * reason: the production ruler prefers `~/.claude/statusline-state.json`, a real
 * file whose contents differ on every machine that runs the test suite. A test
 * asserting this row's `afterRatio` against the developer's own statusline would
 * pass or fail by accident. It is called at most once — the IDE tag and the
 * window come from the same reading, so they cannot disagree with each other.
 *
 * Returns `{ settled: false }` when there is no open run — the honest answer,
 * not an error — and when the payload names another harness session. The two
 * say different things in `reason`, because they are different facts.
 */
export function settleCompactFromHarnessEvent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly trigger?: CompactTrigger | undefined;
  /**
   * The harness session id the payload named, when it named one (see
   * `readSessionIdFromHookPayload`). Refused when it is present AND this
   * project's own harness session id resolves AND the two differ. Absent, or
   * unresolvable on this side, is accepted: a guard that cannot see what it is
   * checking against must not become a hook that never settles anything.
   */
  readonly hookSessionId?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly measure?: (() => PostCompactMeasurement | null) | undefined;
  /** Failure injection for the lifecycle write — the seam `CompactLifecyclePublisher` already takes. */
  readonly failLifecycleWrite?: boolean | undefined;
}): CompactSettleResult {
  const env = input.env ?? process.env;
  const measure =
    input.measure ??
    (() => measurePostCompact({ projectRoot: input.projectRoot, sessionId: input.sessionId, env }));

  // Attribution first, and before the probe: an event that is not about this
  // session must not spend a measurement, and must not touch this run at all.
  // The comparison is harness-id to harness-id — the payload's `session_id` and
  // this project's own outer session id as `resolveOuterSessionId` resolves it
  // (env signal, then the binding's recorded id). It is never compared against
  // the peaks-loop session id, which is a different namespace and would differ
  // on every legitimate event.
  if (input.hookSessionId !== undefined) {
    const ownOuterSessionId = resolveOuterSessionId(input.projectRoot, input.sessionId, env);
    if (ownOuterSessionId !== undefined && ownOuterSessionId !== input.hookSessionId) {
      return { settled: false, reason: 'different-session' };
    }
  }

  let measurement: PostCompactMeasurement | null = null;
  try {
    measurement = measure();
  } catch {
    // A ruler that broke is not a reason to refuse the harness's statement.
    measurement = null;
  }

  const settled = settleOpenLifecycleRunOnCompactEvent({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    measuredRatio: measurement?.ratio ?? null,
    failLifecycleWrite: input.failLifecycleWrite
  });
  if (settled === null) {
    return { settled: false, reason: 'nothing-to-settle' };
  }

  const event: CompactHistoryEvent = {
    schemaVersion: 1,
    kind: 'observed',
    ts: new Date().toISOString(),
    // The guard above refused every payload that named another session, so
    // reaching here means the event named this one or named none. The row is
    // therefore attributable to the main session, which is the only session
    // this command settles.
    target: 'main',
    mode: resolveAutoCompactProfile(input.projectRoot),
    ide: measurement?.ide ?? 'claude-code',
    pathway: COMPACT_EVENT_PATHWAY,
    beforeRatio: settled.triggerRatio,
    ...(settled.afterRatio !== null ? { afterRatio: settled.afterRatio } : {}),
    ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
    redLine: false,
    ok: true,
    checkpointPath: '',
    dispatchMessage:
      `PostCompact fired: the harness reported a ${input.trigger ?? 'unreported-trigger'} compaction, ` +
      `settling the run dispatched at ${(settled.triggerRatio * 100).toFixed(1)}%` +
      (settled.afterRatio !== null
        ? ` (measured now at ${(settled.afterRatio * 100).toFixed(1)}%)`
        : ' (no post-compact measurement available)'),
    ...(settled.afterRatio !== null
      ? { windowTokens: measurement?.windowTokens ?? null, windowSource: measurement?.windowSource ?? null }
      : {})
  };

  try {
    appendCompactHistoryEvent({ projectRoot: input.projectRoot, sessionId: input.sessionId, event });
  } catch {
    // The lifecycle run is already settled; losing the history row is the
    // smaller loss, and a throwing hook is the larger one. Reported rather
    // than silenced: "the run settled but the row is missing" and "the row is
    // on disk" are different facts, and a caller that cannot tell them apart
    // cannot diagnose a hook that has stopped recording anything.
    return {
      settled: true,
      runId: settled.runId,
      beforeRatio: settled.triggerRatio,
      afterRatio: settled.afterRatio,
      historyWritten: false,
      lifecycleWritten: settled.lifecycleWritten,
      ...(input.trigger !== undefined ? { trigger: input.trigger } : {})
    };
  }

  return {
    settled: true,
    runId: settled.runId,
    beforeRatio: settled.triggerRatio,
    afterRatio: settled.afterRatio,
    historyWritten: true,
    lifecycleWritten: settled.lifecycleWritten,
    ...(input.trigger !== undefined ? { trigger: input.trigger } : {})
  };
}
