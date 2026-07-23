/**
 * Auto-compact orchestrator (Task 1.7 honest-blocked rewrite).
 *
 * Pre-Task-1.7 the orchestrator:
 *   1. Read the context % via the IDE adapter.
 *   2. Wrote a pre-compact checkpoint + convergence plan + auto-decisions
 *      log + an intent record at
 *      `.peaks/_runtime/<sessionId>/txt/auto-compact-pending.json`.
 *   3. Called `dispatchIdeCompact` and treated `dispatch.ok` as proof
 *      the runner's context was compacting.
 *
 * Design §13.2 retires that whole shape:
 *   - checkpoint / convergence plan / auto-decisions log: those are
 *     still written when a real attempt fires, but the orchestrator
 *     no longer auto-fires an attempt based on a hook-install /
 *     shell-spawn signal.
 *   - The `auto-compact-pending.json` intent record is gone — it
 *     pointed the next LLM turn at the never-existing
 *     `peaks compact auto`.
 *   - The result envelope now reports `ok: false` with the
 *     Task-1.7 deprecation code so the only "next action" the LLM
 *     ever sees is `peaks compact auto`.
 *
 * Why a thin file instead of deletion: the `code auto-compact` CLI
 * verb still calls `runAutoCompact` (design §13.1 row 3 — kept as a
 * forwarder). The function signature is preserved so a follow-up
 * slice can replace it with a call into the new coordinator without
 * touching the CLI handler. Until that replacement lands, this
 * module is the only place that knows about the old dispatch
 * pathway, and the next-action surface is the new control plane.
 */
import { getSessionIdCanonical } from '../session/session-manager.js';
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  AUTO_COMPACT_RED_LINE_RATIO,
  AUTO_COMPACT_THRESHOLD_RATIO,
  type CompactTrigger,
  type InFlightBatchProbe,
  type AutoCompactResult
} from '../context/auto-compact-types.js';

import type { CompactTarget } from '../context/auto-compact-dispatcher.js';

export interface AutoCompactInput {
  readonly projectRoot: string;
  readonly inFlightBatch?: InFlightBatchProbe | undefined;
  readonly force?: boolean | undefined;
  readonly bypassRedLine?: boolean | undefined;
  readonly sessionId?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly now?: Date | undefined;
  readonly target?: CompactTarget | undefined;
}

const NEXT_ACTION = 'peaks compact auto --project <repo> --session-id <sid> --json';

/**
 * Map a context ratio to a `CompactTrigger` action. Pure; preserved
 * for tests that pin the threshold contract.
 */
export function evaluateCompactTrigger(ratio: number): CompactTrigger {
  if (ratio < AUTO_COMPACT_PRE_COMPACT_RATIO) {
    return ratio < 0.5
      ? { kind: 'none' }
      : {
          kind: 'soft-warn',
          ratio,
          message: `Context at ${(ratio * 100).toFixed(1)}%; below the 85% pre-compact threshold.`
        };
  }
  if (ratio >= AUTO_COMPACT_RED_LINE_RATIO) {
    return {
      kind: 'red-line',
      ratio,
      message: `Context at ${(ratio * 100).toFixed(1)}% ≥ 95% red line. Compact is REQUIRED; the next step is the capability-first control plane.`
    };
  }
  return {
    kind: 'pre-compact',
    ratio,
    toolkitReady: true,
    message: `Context at ${(ratio * 100).toFixed(1)}% in pre-compact zone (0.85–0.95). The next step is the capability-first control plane (\`${NEXT_ACTION}\`).`
  };
}

/**
 * Decide whether to run the auto-compact flow. Pre-Task-1.7 this
 * returned `{ shouldCompact: true, reason: 'red-line' }` for ratio
 * ≥ 0.95, which downstream code read as "the LLM can now mark this
 * attempt complete". Task 1.7 makes the decision purely
 * informational — the *next* decision lives in the new coordinator
 * (Task 1.5). This function therefore NEVER returns
 * `shouldCompact: true`; the caller dispatches into the new
 * coordinator and surfaces its outcome.
 */
export function evaluateAutoCompactDecision(input: {
  ratio: number;
  inFlightBatch?: InFlightBatchProbe | undefined;
  force?: boolean | undefined;
  bypassRedLine?: boolean | undefined;
}): { shouldCompact: boolean; reason: 'below-threshold' | 'in-flight-batch' | 'pre-compact' | 'red-line'; trigger: CompactTrigger } {
  const trigger = evaluateCompactTrigger(input.ratio);
  if (trigger.kind === 'none' || trigger.kind === 'soft-warn') {
    return { shouldCompact: false, reason: 'below-threshold', trigger };
  }
  // 0.85 ≤ ratio < 0.95: honour D6.e in-flight deferral purely for
  // telemetry; the result is "the next probe should re-evaluate" —
  // NOT a permission to compact.
  if (input.inFlightBatch?.hasInFlightBatch === true && trigger.kind === 'pre-compact') {
    return { shouldCompact: false, reason: 'in-flight-batch', trigger };
  }
  // Pre-1.7 returned shouldCompact: true here, which the
  // dispatcher interpreted as a green light to fire a host CLI
  // spawn. The new control plane only completes a compact attempt
  // via the capability-first path; this orchestrator now reports
  // the trigger and stops.
  if (trigger.kind === 'pre-compact') {
    return { shouldCompact: false, reason: 'pre-compact', trigger };
  }
  return { shouldCompact: false, reason: 'red-line', trigger };
}

/**
 * Build the convergence plan (preserved for callers that need the
 * shape; no longer auto-written by the orchestrator).
 */
export function buildConvergencePlan(input: {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly ratio: number;
  readonly checkpointPath: string;
  readonly nextActions: readonly string[];
  readonly redLine?: boolean;
}): {
  schemaVersion: 1;
  sessionId: string;
  projectRoot: string;
  createdAt: string;
  ratio: number;
  checkpointPath: string;
  nextActions: readonly string[];
  resumeHint: string;
} {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    createdAt: new Date().toISOString(),
    ratio: input.ratio,
    checkpointPath: input.checkpointPath,
    nextActions: [...input.nextActions],
    resumeHint: input.redLine === true
      ? 'RED-LINE compact: post-compact-detect must confirm ratio < 0.85 before resuming work.'
      : 'post-compact-detect shouldAutoResume → resume pre-compact plan from checkpoint'
  };
}

/**
 * Run the auto-compact flow. Post-Task-1.7 this is a thin forwarder:
 *   - No checkpoint write (the new coordinator owns that).
 *   - No intent record at `auto-compact-pending.json` (it pointed at
 *     a never-existing command and is now retired).
 *   - No host-CLI spawn (the legacy dispatcher is a blocked stub).
 *   - The only `next action` is the capability-first control plane.
 */
export async function runAutoCompact(input: AutoCompactInput): Promise<AutoCompactResult> {
  const sessionId = input.sessionId ?? getSessionIdCanonical(input.projectRoot);
  if (sessionId === null) {
    return {
      ok: false,
      code: 'AUTO_COMPACT_NO_SESSION',
      message: 'No active session; cannot run auto-compact. Run `peaks workspace init` first.',
      nextActions: ['Run `peaks workspace init --change-id <id>` to bind a session']
    };
  }
  // Lazy import to keep this module decoupled from the reader
  // (mirrors the pre-1.7 pattern). The reader no longer coerces
  // `'unknown'` to a registered adapter id — a hostile / missing
  // env returns a conservative-zero probe and `dispatchIdeCompact`
  // returns `blocked`. The next step is the control plane either
  // way.
  const { readContextPercent } = await import('../context/auto-compact-reader.js');
  const probe = readContextPercent({
    projectRoot: input.projectRoot,
    sessionId,
    env: input.env
  });

  const decision = evaluateAutoCompactDecision({
    ratio: probe.ratio,
    inFlightBatch: input.inFlightBatch,
    force: input.force,
    bypassRedLine: input.bypassRedLine
  });

  if (!decision.shouldCompact) {
    if (decision.reason === 'in-flight-batch') {
      return {
        ok: true,
        code: 'AUTO_COMPACT_WAIT',
        message: `In-flight batch detected; deferring pre-compact (ratio=${(probe.ratio * 100).toFixed(1)}%); next probe will re-evaluate.`,
        data: {
          sessionId,
          ratio: probe.ratio,
          source: probe.source,
          decision: 'in-flight-batch'
        }
      };
    }
    if (decision.reason === 'below-threshold' && decision.trigger.kind === 'soft-warn') {
      return {
        ok: true,
        code: 'AUTO_COMPACT_SKIP',
        message: decision.trigger.message,
        data: {
          sessionId,
          ratio: probe.ratio,
          source: probe.source,
          decision: 'below-threshold'
        }
      };
    }
    return {
      ok: false,
      code: 'AUTO_COMPACT_DISPATCH_FAILED',
      message: `Task 1.7 (design §13.1) retired the legacy dispatch path. ` +
        `The next step is the capability-first control plane (\`${NEXT_ACTION}\`).`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        dispatch: {
          ok: false,
          ide: probe.ide,
          pathway: 'noop',
          message: 'legacy dispatch path retired (design §13.2)'
        },
        target: input.target ?? 'main',
        redLineGated: decision.reason === 'red-line'
      }
    };
  }

  // Unreachable — `evaluateAutoCompactDecision` never returns
  // `shouldCompact: true` post-Task-1.7 — but the type system
  // requires the early returns above to cover every case; this
  // branch is defensive.
  return {
    ok: false,
    code: 'AUTO_COMPACT_DISPATCH_FAILED',
    message: 'legacy dispatch path retired (design §13.2)',
    data: {
      sessionId,
      ratio: 0,
      source: 'conservative-fallback',
      target: input.target ?? 'main'
    }
  };
}

/** Re-export for callers that need to surface the trigger shape. */
export type { CompactTrigger, InFlightBatchProbe, AutoCompactResult };
