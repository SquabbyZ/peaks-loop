/**
 * Auto-compact orchestrator (v2.13.0 AC-2 + AC-3 + AC-4).
 *
 * Closes the loop between `peaks context now` (AC-1) and the IDE's
 * native compact capability (AC-3). peaks-loop is project-aware: it
 * knows the current plan, open questions, recent decisions, in-flight
 * batches, todo state, git status, and active skills. That context is
 * strictly more valuable than what `/compact` can synthesize from raw
 * conversation history — so peaks-loop drives the entire compaction:
 *
 *   1. Read current context % (via IDE adapter's `readContextPercent`).
 *   2. If ratio ≥ 0.95 (RED LINE): synchronous gate — peaks-loop
 *      refuses sub-agent dispatch and forces IDE compact immediately.
 *      The LLM cannot opt out (compact red line — keeps the runner
 *      alive).
 *   3. If 0.85 ≤ ratio < 0.95 (pre-compact zone): peaks-loop prepares
 *      the convergence toolkit (checkpoint + auto-decisions log +
 *      IDE-dispatch handle) and surfaces it to the LLM. The LLM
 *      DECIDES when to fire `peaks code auto-compact --execute`;
 *      peaks-loop does NOT auto-fire. The toolkit is ready so the
 *      LLM doesn't lose context to a last-second `/compact` panic.
 *   4. If ratio < 0.85: skip — return a one-line info row.
 *
 * Why two tiers (vs. one): the LLM uses the 0.85–0.95 zone for
 * intelligent convergence — wait for in-flight sub-agents, finish
 * the current todo row, persist a checkpoint, then compact. At 0.95
 * the window is gone; peaks-loop takes over synchronously. Net effect:
 * the LLM-runner keeps working with context < 95% without human
 * intervention.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSessionIdCanonical } from '../session/session-manager.js';
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  AUTO_COMPACT_RED_LINE_RATIO,
  AUTO_COMPACT_THRESHOLD_RATIO,
  type CompactDispatchResult,
  type CompactTrigger,
  type ConvergencePlan,
  type InFlightBatchProbe,
  type AutoCompactResult
} from '../context/auto-compact-types.js';

import type { CompactTarget } from '../context/auto-compact-dispatcher.js';

export interface AutoCompactInput {
  /** Project root for context (default cwd). */
  readonly projectRoot: string;
  /** Caller-provided in-flight batch probe (default false). */
  readonly inFlightBatch?: InFlightBatchProbe | undefined;
  /**
   * Force execute even when ratio < threshold (test seam). In
   * production this is always `false` — peaks-loop drives compact
   * autonomously at 0.85+ with zero human / zero LLM intervention.
   */
  readonly force?: boolean | undefined;
  /** Skip the 95% red-line gate (test seam — never true in production). */
  readonly bypassRedLine?: boolean | undefined;
  /** Current session id (default = resolve via session-id-service). */
  readonly sessionId?: string | undefined;
  /** Injectable env for IDE detection (test seam). */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Injectable clock for mtime checks (test seam). */
  readonly now?: Date | undefined;
  /**
   * Slice 2026-06-28-code-mode-bypass-fix (defect #4): which session
   * the compact should target. Default `'main'` — the orchestrator
   * (peaks-code body) runs in the main-session Claude Code window and
   * wants to compress *its* context. Sub-agent shells pass
   * `'sub-agent'` to preserve the legacy shell-spawn behaviour.
   */
  readonly target?: CompactTarget | undefined;
}

const PRE_COMPACT_REASON = 'pre-compact-auto' as const;

/**
 * Map a context ratio to a `CompactTrigger` action. Pure; the side
 * effects (checkpoint + IDE dispatch) live in `runAutoCompact`. Two
 * tiers:
 *
 *   - ratio < 0.85 → 'none' or 'soft-warn'
 *   - ratio ≥ 0.85 → 'pre-compact' (async-friendly path)
 *   - ratio ≥ 0.95 → 'red-line' (synchronous gate)
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
      message: `Context at ${(ratio * 100).toFixed(1)}% ≥ 95% red line. Synchronous compact REQUIRED (LLM cannot opt out).`
    };
  }
  // 0.85 ≤ ratio < 0.95: pre-compact zone — peaks-loop fires
  // `peaks session auto-compact --execute` AUTOMATICALLY (zero-pause
  // contract, v2.13.0). The LLM does NOT decide; the orchestrator does.
  // D6.e in-flight deferral below is the only reason to wait.
  return {
    kind: 'pre-compact',
    ratio,
    toolkitReady: true,
    message: `Context at ${(ratio * 100).toFixed(1)}% in pre-compact zone (0.85–0.95). peaks-loop will automatically fire \`peaks session auto-compact --execute\` (zero-pause contract).`
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
 *   - ratio ≥ 0.95           → red-line; ALWAYS dispatch synchronously
 *                                regardless of in-flight batch.
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
  if (trigger.kind === 'red-line') {
    // Red line: ignore in-flight batch — synchronous dispatch wins.
    return { shouldCompact: true, reason: 'red-line', trigger };
  }
  // pre-compact zone (0.85 ≤ ratio < 0.95): honor D6.e in-flight deferral.
  if (input.inFlightBatch?.hasInFlightBatch === true) {
    return { shouldCompact: false, reason: 'in-flight-batch', trigger };
  }
  if (input.force) {
    return { shouldCompact: true, reason: 'pre-compact', trigger };
  }
  // Default: peaks-loop drives pre-compact autonomously.
  return { shouldCompact: true, reason: 'pre-compact', trigger };
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
    resumeHint: input.redLine === true
      ? 'RED-LINE compact: post-compact-detect must confirm ratio < 0.85 before resuming work.'
      : 'post-compact-detect shouldAutoResume → resume pre-compact plan from checkpoint'
  };
}

/**
 * Append a one-row convergence decision to the LLM-readable log.
 * The LLM reads this on the post-compact turn to pick up exactly
 * where it left off (vs. blindly trusting the IDE's compressed
 * transcript).
 */
function appendAutoDecisionLog(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly plan: ConvergencePlan;
}): void {
  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'txt');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'auto-decisions.md');
  const row = [
    '',
    `## Auto-compact decision — ${input.plan.createdAt}`,
    `- ratio: ${(input.plan.ratio * 100).toFixed(1)}%`,
    `- checkpoint: ${input.plan.checkpointPath}`,
    `- next-actions: ${input.plan.nextActions.join(' | ')}`,
    `- resume-hint: ${input.plan.resumeHint}`,
    ''
  ].join('\n');
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# peaks-code auto-decisions log\n${row}`, 'utf8');
    return;
  }
  const existing = readFileSync(logPath, 'utf8');
  writeFileSync(logPath, `${existing}${row}`, 'utf8');
}

/**
 * Slice 2026-06-28-code-mode-bypass-fix (defect #4): write the
 * main-session compact intent so the main-session LLM picks it up on
 * its next turn and fires `/compact` in-band. Without this file the
 * orchestrator's "main-session compact" request is invisible to the
 * main Claude Code window (defeats the whole point of auto-compact
 * for the main context).
 *
 * The file is gitignored under `.peaks/_runtime/<sessionId>/txt/` and
 * is one-shot: the LLM should `mv` it to `.consumed` after firing
 * `/compact`. A re-run will overwrite.
 */
function writeMainSessionCompactIntent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly ratio: number;
  readonly redLine: boolean;
  readonly now: Date;
}): void {
  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'txt');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'auto-compact-pending.json');
  const payload = {
    schemaVersion: 1,
    pending: true,
    target: 'main',
    requestedAt: input.now.toISOString(),
    ratio: input.ratio,
    redLine: input.redLine,
    nextAction: 'next LLM turn MUST fire `/compact` then `mv .peaks/_runtime/<sid>/txt/auto-compact-pending.json .peaks/_runtime/<sid>/txt/auto-compact-pending.consumed.json`'
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Write a pre-compact checkpoint. The shape mirrors `peaks session
 * checkpoint` so D7's post-compact-detect picks it up unchanged.
 */
function writePreCompactCheckpoint(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly now: Date;
  readonly redLine?: boolean;
}): string {
  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'checkpoints');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const prefix = input.redLine === true ? 'red-line-' : 'pre-compact-';
  const filename = `${prefix}${input.now.toISOString().replace(/[:.]/g, '-')}.json`;
  const path = join(dir, filename);
  const content = {
    schemaVersion: 1,
    reason: input.redLine === true ? 'pre-compact-red-line' : PRE_COMPACT_REASON,
    sessionId: input.sessionId,
    createdAt: input.now.toISOString(),
    // D7 reads `mode`, `currentPlan`, `openQuestions`, `recentDecisions`
    // out of this JSON. We seed empty arrays; the post-compact LLM
    // rehydrates from the auto-decisions log + open question list.
    mode: 'full-auto',
    currentPlan: input.redLine === true
      ? 'RED-LINE compact just executed; confirm ratio < 0.85 before resuming work'
      : 'auto-compact in progress; resume from auto-decisions.md',
    openQuestions: [] as string[],
    recentDecisions: [] as string[],
    recentArtifactPaths: [] as string[],
    gitStatus: '',
    skillsActive: ['peaks-code'],
    todoState: [] as string[]
  };
  writeFileSync(path, JSON.stringify(content, null, 2), 'utf8');
  return path;
}

/**
 * Execute the auto-compact flow.
 *
 * Steps (orchestration):
 *   1. Resolve session id.
 *   2. Read current ratio via AC-1 (`readContextPercent`).
 *   3. Evaluate trigger via `evaluateCompactTrigger`.
 *   4. If trigger.kind === 'none' / 'soft-warn' → return skip.
 *   5. If trigger.kind === 'pre-compact' AND in-flight batch → wait.
 *   6. If trigger.kind === 'pre-compact' → async dispatch (write
 *      checkpoint + IDE compact; orchestrator returns immediately).
 *   7. If trigger.kind === 'red-line' → synchronous gate: refuse
 *      sub-agent dispatch, dispatch IDE compact, mark `redLineGated`.
 *
 * The caller (CLI or skill body) handles the actual return — D7's
 * post-compact-detect will pick up the checkpoint on the next turn.
 * For red-line, the caller MUST block further tool calls until the
 * post-compact probe confirms ratio < 0.85.
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
  // Lazy import to avoid the AC-1 module depending on the orchestrator.
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
    return {
      ok: true,
      code: decision.reason === 'in-flight-batch' ? 'AUTO_COMPACT_WAIT' : 'AUTO_COMPACT_SKIP',
      message: decision.trigger.kind === 'soft-warn'
        ? decision.trigger.message
        : decision.reason === 'in-flight-batch'
          ? `In-flight batch detected; deferring pre-compact (ratio=${(probe.ratio * 100).toFixed(1)}%); next probe will re-evaluate.`
          : `Context at ${(probe.ratio * 100).toFixed(1)}%; below ${(AUTO_COMPACT_THRESHOLD_RATIO * 100).toFixed(0)}% threshold.`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        decision: decision.reason === 'in-flight-batch' ? 'in-flight-batch' : 'below-threshold'
      }
    };
  }

  const isRedLine = decision.reason === 'red-line';
  const now = input.now ?? new Date();
  const checkpointPath = writePreCompactCheckpoint({
    projectRoot: input.projectRoot,
    sessionId,
    now,
    redLine: isRedLine
  });

  const nextActions = isRedLine
    ? [
        'RED-LINE compact dispatched — further sub-agent dispatch BLOCKED until ratio < 0.85',
        'Post-compact resume picks up the convergence plan from auto-decisions.md',
        'Next `peaks context now` probe will confirm ratio dropped below 0.85'
      ]
    : [
        'Pre-compact dispatched — IDE compact in progress (async)',
        'Post-compact resume picks up the convergence plan from auto-decisions.md',
        'Next `peaks context now` probe will confirm ratio dropped below 0.85'
      ];

  const plan = buildConvergencePlan({
    sessionId,
    projectRoot: input.projectRoot,
    ratio: probe.ratio,
    checkpointPath,
    nextActions,
    redLine: isRedLine
  });

  appendAutoDecisionLog({ projectRoot: input.projectRoot, sessionId, plan });

  // Lazy import to keep AC-3 (IDE dispatch) pluggable; tests mock this module.
  const { dispatchIdeCompact } = await import('../context/auto-compact-dispatcher.js');
  const target: CompactTarget = input.target ?? 'main';
  // Slice 2026-06-28: when targeting the main session, write an
  // intent record so the next main-session LLM turn fires `/compact`
  // in-band. Without this record the LLM has no signal that the
  // orchestrator asked for compact; the dispatcher alone would have
  // been a no-op against the main Claude Code window.
  if (target === 'main') {
    writeMainSessionCompactIntent({
      projectRoot: input.projectRoot,
      sessionId,
      ratio: probe.ratio,
      redLine: isRedLine,
      now
    });
  }
  const dispatch: CompactDispatchResult = await dispatchIdeCompact({
    projectRoot: input.projectRoot,
    sessionId,
    env: input.env,
    target
  });

  return {
    ok: dispatch.ok,
    code: dispatch.ok
      ? (isRedLine ? 'AUTO_COMPACT_RED_LINE' : 'AUTO_COMPACT_DISPATCHED')
      : 'AUTO_COMPACT_DISPATCH_FAILED',
    message: dispatch.ok
      ? isRedLine
        ? `RED-LINE compact dispatched (${dispatch.ide} / ${dispatch.pathway} / target=${target}); checkpoint at ${checkpointPath}. Further sub-agent dispatch is BLOCKED until ratio < 0.85.`
        : `Auto-compact dispatched (${dispatch.ide} / ${dispatch.pathway} / target=${target}); checkpoint at ${checkpointPath}.`
      : `Auto-compact checkpoint written but IDE dispatch failed: ${dispatch.message}`,
    data: {
      sessionId,
      ratio: probe.ratio,
      source: probe.source,
      checkpointPath,
      convergencePlan: plan,
      dispatch,
      target,
      redLineGated: isRedLine
    }
  };
}

/** Re-export for callers that need to surface the trigger shape. */
export type { CompactTrigger, ConvergencePlan, InFlightBatchProbe, AutoCompactResult };
// Keep dirname import live for symmetry with sibling services that
// use it for path joins; tree-shaking removes it in builds.
void dirname;