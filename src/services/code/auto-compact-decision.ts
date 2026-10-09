/**
 * The pure auto-compact decision surface: trigger, decision and plan.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  type CompactTrigger,
  type ConvergencePlan,
  type InFlightBatchProbe
} from '../context/auto-compact-types.js';
import { type AutoCompactMode, thresholdFor } from './auto-compact-modes.js';

/**
 * Map a context ratio to a `CompactTrigger` action. Pure; the side
 * effects (checkpoint + IDE dispatch) live in `runAutoCompact`. Two
 * tiers (standard mode; partial mode shifts both thresholds):
 *
 *   - ratio < preCompact → 'none' or 'soft-warn'
 *   - ratio ≥ preCompact → 'pre-compact' (async-friendly path)
 *   - ratio ≥ redLine    → 'red-line' (ask the harness; dispatch continues)
 *
 * Default `'standard'` (0.85/0.95). `'partial'` (0.70/0.85) is used
 * when 24h long-run mode is active or `--mode partial` is passed.
 */
/** Below this ratio the probe is not even worth a soft warning. */
const SOFT_WARN_RATIO_FLOOR = 0.5;

export function evaluateCompactTrigger(
  ratio: number,
  mode: AutoCompactMode = 'standard'
): CompactTrigger {
  const autoFire = thresholdFor(mode, 'autoFire');
  const preCompact = thresholdFor(mode, 'preCompact');
  const redLine = thresholdFor(mode, 'redLine');
  if (ratio < autoFire) {
    return ratio < SOFT_WARN_RATIO_FLOOR
      ? { kind: 'none' }
      : {
          kind: 'soft-warn',
          ratio,
          message: `Context at ${(ratio * 100).toFixed(1)}%; below the ${(autoFire * 100).toFixed(0)}% auto-fire threshold (mode=${mode}).`
        };
  }
  if (ratio >= redLine) {
    // longer claims it blocks anything. It cannot: peaks-loop has no
    // executor for a running session (no `/compact` the model may invoke, no
    // hook-initiated compact, no `--compact` flag), so "refuse dispatch until
    // ratio < 0.85" was a gate with no key — a constructive deadlock at the
    // exact moment the runner most needed to keep working. What peaks-loop
    // CAN do is ask the harness (whose own trigger is armed) and say so.
    return {
      kind: 'red-line',
      ratio,
      message: `Context at ${(ratio * 100).toFixed(1)}% ≥ ${(redLine * 100).toFixed(0)}% red line (mode=${mode}). peaks-loop has asked the harness to compact and is WAITING for it — sub-agent dispatch is NOT blocked; carry on and re-probe with \`peaks code context-now\`.`
    };
  }
  if (ratio < preCompact) {
    // Part 22: auto-fire zone (0.80 ≤ ratio < 0.85). peaks-loop
    // preempts and runs `peaks code auto-compact` itself
    // without LLM involvement. The LLM is not asked to "decide";
    // the toolkit is applied synchronously. Closes the
    // LLM-misjudges-context window that previously let the
    // ratio drift to 0.95 before the auto-fire kicked in.
    return {
      kind: 'auto-fire',
      ratio,
      message: `Context at ${(ratio * 100).toFixed(1)}% in auto-fire zone (≥${(autoFire * 100).toFixed(0)}% / <${(preCompact * 100).toFixed(0)}%, mode=${mode}). peaks-loop will fire compact without LLM confirmation.`
    };
  }
  // pre-compact zone (0.85 ≤ ratio < 0.95): kept for backward
  // compat with operators who configured the higher threshold.
  // In practice peaks-loop already auto-fired at the lower
  // threshold; the pre-compact zone today is the "already fired"
  // zone.
  return {
    kind: 'pre-compact',
    ratio,
    toolkitReady: true,
    message: `Context at ${(ratio * 100).toFixed(1)}% in pre-compact zone (≥${(preCompact * 100).toFixed(0)}% / <${(redLine * 100).toFixed(0)}%, mode=${mode}). peaks-loop already fired the auto-compact pathway at the auto-fire threshold; the LLM does not need to act.`
  };
}
/**
 * Decide whether to run the auto-compact flow. Pure function for the
 * decision; side effects (checkpoint + IDE dispatch) live in
 * `runAutoCompact` below. Zero human / zero LLM intervention:
 *
 *   - ratio < 0.85           → skip (LLM keeps working; no action)
 *   - 0.85 ≤ ratio < 0.95    → pre-compact; if in-flight batch
 *                                present, defer (D6.e); else dispatch
 *                                IDE compact asynchronously.
 *   - ratio ≥ 0.95           → red-line; ask the harness to compact
 *                                regardless of in-flight batch. Nothing is
 *                                gated — dispatch is NOT blocked (slice
 *                                peaks-loop cannot compact a running session,
 *                                so a "block" gated nothing and deadlocked the
 *                                runner).
 */
export function evaluateAutoCompactDecision(input: {
  ratio: number;
  /**
   * Caller-provided in-flight batch signal. Accepts either a plain
   * boolean (convenience / repro seam) or the full `InFlightBatchProbe`
   * shape (production callers — graph-probe-backed). When the boolean
   * form is `true`, the normalized probe carries
   * `hasInFlightBatch: true`. Slice 4.0.8 hotfix.
   */
  inFlightBatch?: boolean | InFlightBatchProbe | undefined;
  /**
   * Legacy camelCase alias for `inFlightBatch`. Production repro
   * inputs use `inflightBatch: true|false`; the orchestrator
   * normalizes it to the same internal shape. Slice 4.0.8 hotfix.
   */
  inflightBatch?: boolean | InFlightBatchProbe | undefined;
  force?: boolean | undefined;
  /** Accepted and ignored — see `AutoCompactInput.bypassRedLine`. */
  bypassRedLine?: boolean | undefined;
  mode?: AutoCompactMode | undefined;
  /**
   * Source tag from `readContextPercent.source`. Optional — when absent, the
   * function behaves exactly as pre-rid (ratio-only). Slice 2026-07-31-rid-
   * mac-transcript-estimate-trigger uses this to carry forward an explicit
   * carve-out for the Mac-only `transcript-estimate` signal.
   */
  source?: string | undefined;
}): {
  shouldCompact: boolean;
  reason: 'below-threshold' | 'in-flight-batch' | 'pre-compact' | 'red-line';
  trigger: CompactTrigger;
  /** Typed verdict enum (RD §4 24h-mode contract). Slice 4.0.8 hotfix. */
  action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line' | 'defer';
} {
  const trigger = evaluateCompactTrigger(input.ratio, input.mode ?? 'standard');
  // Normalize both `inFlightBatch` and `inflightBatch` (boolean | probe)
  // into a single `InFlightBatchProbe` shape. The probe reads
  // `hasInFlightBatch`; the boolean reads truthiness.
  const rawProbe = input.inFlightBatch ?? input.inflightBatch;
  const probe: InFlightBatchProbe | undefined =
    typeof rawProbe === 'boolean' ? { hasInFlightBatch: rawProbe } : rawProbe;
  if (trigger.kind === 'none') {
    return { shouldCompact: false, reason: 'below-threshold', trigger, action: 'ok' };
  }
  if (trigger.kind === 'soft-warn') {
    return { shouldCompact: false, reason: 'below-threshold', trigger, action: 'soft-warn' };
  }
  if (trigger.kind === 'red-line') {
    // Red line: ignore in-flight batch — the harness is asked NOW rather than
    // waiting for the batch to drain. Not "synchronous dispatch": peaks-loop
    // has no synchronous compact to run, it can only request one and report
    // that it is waiting.
    return { shouldCompact: true, reason: 'red-line', trigger, action: 'red-line' };
  }
  // pre-compact zone (0.85 ≤ ratio < 0.95): honor D6.e in-flight deferral.
  if (probe?.hasInFlightBatch === true) {
    return { shouldCompact: false, reason: 'in-flight-batch', trigger, action: 'defer' };
  }
  if (input.force) {
    return { shouldCompact: true, reason: 'pre-compact', trigger, action: 'auto-compact-now' };
  }
  // is the ONLY signal available on Mac Claude Code (no env-var, no statusline
  // poll). The gate above already returns shouldCompact: true at ratio ≥ 0.85,
  // but this forward-compat carve-out makes the source-aware rule explicit so
  // any future source-aware downgrading cannot silently re-introduce the
  // Mac auto-compact silent-failure mode without an audit. No higher-priority
  // source is present (`claude-code-env` would have been P1, `statusline-poll`
  // P2, `user-overridden` P4) — Mac's only signal is `transcript-estimate`.
  if (input.source === 'transcript-estimate' && input.ratio >= AUTO_COMPACT_PRE_COMPACT_RATIO)
    return { shouldCompact: true, reason: 'pre-compact', trigger, action: 'auto-compact-now' };
  // Default: peaks-loop drives pre-compact autonomously.
  return { shouldCompact: true, reason: 'pre-compact', trigger, action: 'auto-compact-now' };
}
/**
 * Build the convergence plan that D7's post-compact-detect will read
 * back. Includes the current plan, open questions, recent decisions,
 * todo state, and recent artifact paths — strictly more than what a
 * raw `/compact` would preserve.
 */
export function buildConvergencePlan(input: {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly ratio: number;
  readonly checkpointPath: string;
  readonly nextActions: readonly string[];
  readonly redLine?: boolean;
}): ConvergencePlan {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    createdAt: new Date().toISOString(),
    ratio: input.ratio,
    checkpointPath: input.checkpointPath,
    nextActions: [...input.nextActions],
    resumeHint:
      input.redLine === true
        ? 'RED-LINE compact requested from the harness; work CONTINUES (nothing is blocked). Re-probe with `peaks code context-now`; if the ratio is still ≥ 0.95 and the harness has not compacted, report it and hand control back to the user.'
        : 'post-compact-detect shouldAutoResume → resume pre-compact plan from checkpoint'
  };
}
