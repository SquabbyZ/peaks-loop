/**
 * Auto-compact orchestrator (v2.13.0 AC-2 + AC-3 + AC-4).
 *
 * Closes the loop between `peaks code auto-compact` (AC-1) and the IDE's
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
 *      DECIDES when to fire `peaks code auto-compact`;
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { resolveOuterSessionId } from '../session/binding-status-service.js';
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  AUTO_COMPACT_RED_LINE_RATIO,
  type CompactDispatchResult,
  type CompactTrigger,
  type ConvergencePlan,
  type InFlightBatchProbe,
  type AutoCompactResult
} from '../context/auto-compact-types.js';

import type { CompactTarget } from '../context/auto-compact-dispatcher.js';
import {
  type AutoCompactMode,
  describeMode,
  thresholdFor
} from './auto-compact-modes.js';
import { resolveAutoCompactProfile } from '../mode/mode-status-service.js';
import type {
  CompactLifecycleRecord,
  CompactLifecycleStage
} from '../compact-statusline/compact-lifecycle-store.js';
import {
  CompactLifecyclePublisher,
  newCompactRunId,
  resolveDispatchedStage,
  settleOpenLifecycleRun,
  summarizeLifecycleError
} from './auto-compact-lifecycle.js';

export interface AutoCompactInput {
  /** Project root for context (default cwd). */
  readonly projectRoot: string;
  /**
   * Caller-provided in-flight batch probe (default false). Slice
   * 4.0.8 (D4d): production callers should pass a `probeInflightBatch`
   * function (see below). The legacy `inFlightBatch` boolean
   * remains as a TEST-ONLY seam — the CLI gates it behind
   * `process.env.PEAKS_TEST_SEAM === '1'` so a production run
   * never consults the boolean as truth.
   */
  readonly inFlightBatch?: InFlightBatchProbe | undefined;
  /**
   * Slice 4.0.8 (D4d): graph-only in-flight probe. When supplied,
   * the orchestrator calls this function and uses the boolean
   * result as the production `inFlightBatch` signal. The legacy
   * boolean parameter is suppressed in production callers — the
   * CLI's `--in-flight-batch` flag is gated behind
   * `PEAKS_TEST_SEAM === '1'`. The pure decision function
   * `evaluateAutoCompactDecision` retains the boolean signature
   * for the test seam + the red-line override.
   */
  readonly probeInflightBatch?: (() => boolean) | undefined;
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
  /**
   * Slice 2026-07-28 (rid-027): auto-compact mode. Default
   * `'standard'` (v2.13.0 zero-pause contract, 0.85/0.95). `'partial'`
   * fires earlier (0.70/0.85) for 24h long-run scenarios. CLI flag
   * `--mode <mode>` overrides the 24h-mode auto-detection.
   */
  readonly mode?: AutoCompactMode | undefined;
  /**
   * Slice 2026-08-01-compact-lifecycle (Task 5): observer fired on
   * every lifecycle stage this process actually proved. Telemetry
   * only — it can neither change the threshold decision nor the
   * dispatch outcome, and a throwing observer is swallowed.
   */
  readonly onLifecycleStage?: ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
  /**
   * Test-only injection seams for lifecycle failure paths. NEVER set in
   * production — these exist so the unit suite can drive the `failed`
   * transition and the store-outage branch without mocking the SUT.
   * Each flag toggles a single, well-scoped throw at a documented point:
   *   - `failPreparing`: throw inside the checkpoint/plan/recovery phase
   *     (so the record rests at `failedAt: 'preparing'`)
   *   - `failCompacting`: throw inside the IDE-dispatch phase
   *     (so the record rests at `failedAt: 'compacting'`)
   *   - `failLifecycleWrite`: make every lifecycle-store write throw
   *     (so the compact envelope is proven independent of telemetry)
   */
  readonly testHooks?: AutoCompactTestHooks | undefined;
}

/**
 * Test-only injection seams. The `boolean` shape (vs. an injected error)
 * is deliberate: tests assert the *transition*, not the thrown value —
 * the value would just be a brittle fingerprint. The real error path
 * is still exercised by `summarizeLifecycleError`'s tests.
 */
export interface AutoCompactTestHooks {
  readonly failPreparing?: boolean | undefined;
  readonly failCompacting?: boolean | undefined;
  readonly failLifecycleWrite?: boolean | undefined;
}

const PRE_COMPACT_REASON = 'pre-compact-auto' as const;

/**
 * Map a context ratio to a `CompactTrigger` action. Pure; the side
 * effects (checkpoint + IDE dispatch) live in `runAutoCompact`. Two
 * tiers (standard mode; partial mode shifts both thresholds):
 *
 *   - ratio < preCompact → 'none' or 'soft-warn'
 *   - ratio ≥ preCompact → 'pre-compact' (async-friendly path)
 *   - ratio ≥ redLine    → 'red-line' (synchronous gate)
 *
 * Slice 2026-07-28 (rid-027): `mode` selects the threshold table.
 * Default `'standard'` (0.85/0.95). `'partial'` (0.70/0.85) is used
 * when 24h long-run mode is active or `--mode partial` is passed.
 */
export function evaluateCompactTrigger(ratio: number, mode: AutoCompactMode = 'standard'): CompactTrigger {
  const autoFire = thresholdFor(mode, 'autoFire');
  const preCompact = thresholdFor(mode, 'preCompact');
  const redLine = thresholdFor(mode, 'redLine');
  if (ratio < autoFire) {
    return ratio < 0.5
      ? { kind: 'none' }
      : {
          kind: 'soft-warn',
          ratio,
          message: `Context at ${(ratio * 100).toFixed(1)}%; below the ${(autoFire * 100).toFixed(0)}% auto-fire threshold (mode=${mode}).`
        };
  }
  if (ratio >= redLine) {
    return {
      kind: 'red-line',
      ratio,
      message: `Context at ${(ratio * 100).toFixed(1)}% ≥ ${(redLine * 100).toFixed(0)}% red line (mode=${mode}). Synchronous compact REQUIRED (LLM cannot opt out).`
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
 *   - ratio ≥ 0.95           → red-line; ALWAYS dispatch synchronously
 *                                regardless of in-flight batch.
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
    typeof rawProbe === 'boolean'
      ? { hasInFlightBatch: rawProbe }
      : rawProbe;
  if (trigger.kind === 'none') {
    return { shouldCompact: false, reason: 'below-threshold', trigger, action: 'ok' };
  }
  if (trigger.kind === 'soft-warn') {
    return { shouldCompact: false, reason: 'below-threshold', trigger, action: 'soft-warn' };
  }
  if (trigger.kind === 'red-line') {
    // Red line: ignore in-flight batch — synchronous dispatch wins.
    return { shouldCompact: true, reason: 'red-line', trigger, action: 'red-line' };
  }
  // pre-compact zone (0.85 ≤ ratio < 0.95): honor D6.e in-flight deferral.
  if (probe?.hasInFlightBatch === true) {
    return { shouldCompact: false, reason: 'in-flight-batch', trigger, action: 'defer' };
  }
  if (input.force) {
    return { shouldCompact: true, reason: 'pre-compact', trigger, action: 'auto-compact-now' };
  }
  // Slice 2026-07-31-rid-mac-transcript-estimate-trigger: transcript-estimate
  // is the ONLY signal available on Mac Claude Code (no env-var, no statusline
  // poll). The gate above already returns shouldCompact: true at ratio ≥ 0.85,
  // but this forward-compat carve-out makes the source-aware rule explicit so
  // any future source-aware downgrading cannot silently re-introduce the
  // Mac auto-compact silent-failure mode without an audit. No higher-priority
  // source is present (`claude-code-env` would have been P1, `statusline-poll`
  // P2, `user-overridden` P4) — Mac's only signal is `transcript-estimate`.
  if (input.source === 'transcript-estimate' && input.ratio >= AUTO_COMPACT_PRE_COMPACT_RATIO) return { shouldCompact: true, reason: 'pre-compact', trigger, action: 'auto-compact-now' };
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
 * Slice 2026-07-28 (rid-027), re-keyed by slice
 * 2026-09-09-mode-consolidation: resolve the auto-compact mode from
 * the PRESENCE MODE, not the 24h state machine. Returns `'partial'`
 * when the mode is `24h`, otherwise `'standard'`. The CLI flag
 * `--mode` takes precedence (caller passes `input.mode` directly), so
 * this helper is only consulted when the flag is absent.
 */
function resolveAutoCompactMode(projectRoot: string): AutoCompactMode {
  return resolveAutoCompactProfile(projectRoot);
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
  // Slice 2026-07-28 (rid-027): resolve mode. CLI flag `--mode` wins;
  // slice 2026-09-09-mode-consolidation keys the default off the
  // presence MODE ('24h' → 'partial'); 'standard' preserves the
  // v2.13.0 zero-pause contract.
  const mode: AutoCompactMode = input.mode ?? resolveAutoCompactMode(input.projectRoot);
  // Lazy import to avoid the AC-1 module depending on the orchestrator.
  const { readContextPercent } = await import('../context/auto-compact-reader.js');
  const outerSessionId = resolveOuterSessionId(input.projectRoot, sessionId, input.env ?? process.env);
  const probe = readContextPercent({
    projectRoot: input.projectRoot,
    sessionId,
    outerSessionId,
    env: input.env
  });

  const decision = evaluateAutoCompactDecision({
    ratio: probe.ratio,
    // Slice 4.0.8 (D4d): production `inFlightBatch` MUST come from
    // the graph probe (see `workflow-inflight-probe.ts`). The
    // legacy boolean is preserved as a TEST-ONLY seam: when
    // `probeInflightBatch` is supplied, we call it and pass the
    // result as a `InFlightBatchProbe` so the pure decision function
    // sees a graph-backed value. When only the boolean is
    // supplied, we treat it as the test seam (the CLI gates it
    // behind `PEAKS_TEST_SEAM === '1'`).
    inFlightBatch: input.probeInflightBatch !== undefined
      ? { hasInFlightBatch: input.probeInflightBatch() }
      : input.inFlightBatch,
    force: input.force,
    bypassRedLine: input.bypassRedLine,
    mode,
    // Slice 2026-07-31-rid-mac-transcript-estimate-trigger: pipe the source
    // tag through so `evaluateAutoCompactDecision` can apply the
    // source-aware carve-out for Mac's `transcript-estimate` signal.
    source: probe.source
  });

  if (!decision.shouldCompact) {
    // Slice 2026-08-01-compact-lifecycle (Task 5): this probe IS the
    // adapter's `postCompactDetectCommand`. A ratio that has fallen
    // back below the auto-fire threshold is the real, measured proof
    // that a previously-dispatched compact landed — so settle any run
    // still open at `compacting`. Nothing is written when there is no
    // open run, when the ratio is still high, or when the probe could
    // not measure at all.
    settleOpenLifecycleRun({
      projectRoot: input.projectRoot,
      sessionId,
      measuredRatio: probe.ratio,
      source: probe.source,
      autoFireThreshold: thresholdFor(mode, 'autoFire'),
      onLifecycleStage: input.onLifecycleStage
    });
    return {
      ok: true,
      code: decision.reason === 'in-flight-batch' ? 'AUTO_COMPACT_WAIT' : 'AUTO_COMPACT_SKIP',
      message: decision.trigger.kind === 'soft-warn'
        ? decision.trigger.message
        : decision.reason === 'in-flight-batch'
          ? `In-flight batch detected; deferring pre-compact (ratio=${(probe.ratio * 100).toFixed(1)}%); next probe will re-evaluate.`
          : `Context at ${(probe.ratio * 100).toFixed(1)}%; below the ${(thresholdFor(mode, 'autoFire') * 100).toFixed(0)}% auto-fire threshold (mode=${mode}).`,
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

  // Slice 2026-08-01-compact-lifecycle (Task 5): the decision has now
  // committed to compacting, so the run is `queued`. One runId per
  // attempt; every later transition carries it forward.
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

  let checkpointPath: string;
  let plan: ConvergencePlan;
  let nextActions: readonly string[];
  try {
    // `preparing` covers checkpoint + convergence-plan + recovery writes.
    lifecycle.advance('preparing');
    if (input.testHooks?.failPreparing) throw new Error('disk full while writing checkpoint');

    checkpointPath = writePreCompactCheckpoint({
      projectRoot: input.projectRoot,
      sessionId,
      now,
      redLine: isRedLine
    });

    nextActions = isRedLine
      ? [
          'RED-LINE compact dispatched — further sub-agent dispatch BLOCKED until ratio < 0.85',
          'Post-compact resume picks up the convergence plan from auto-decisions.md',
          'Next `peaks code auto-compact` probe will confirm ratio dropped below 0.85'
        ]
      : [
          'Pre-compact dispatched — IDE compact in progress (async)',
          'Post-compact resume picks up the convergence plan from auto-decisions.md',
          'Next `peaks code auto-compact` probe will confirm ratio dropped below 0.85'
        ];

    plan = buildConvergencePlan({
      sessionId,
      projectRoot: input.projectRoot,
      ratio: probe.ratio,
      checkpointPath,
      nextActions,
      redLine: isRedLine
    });

    appendAutoDecisionLog({ projectRoot: input.projectRoot, sessionId, plan });
  } catch (error) {
    lifecycle.fail(error);
    // Preserve the original error contract: the caller gets the same
    // `AUTO_COMPACT_DISPATCH_FAILED` envelope shape it already handles,
    // not a thrown exception and not a widened type.
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
        redLineGated: isRedLine
      }
    };
  }

  // Lazy import to keep AC-3 (IDE dispatch) pluggable; tests mock this module.
  const { dispatchIdeCompact } = await import('../context/auto-compact-dispatcher.js');
  const target: CompactTarget = input.target ?? 'main';

  let dispatch: CompactDispatchResult;
  try {
    if (input.testHooks?.failCompacting) throw new Error('IDE dispatch exploded');

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
    dispatch = await dispatchIdeCompact({
      projectRoot: input.projectRoot,
      sessionId,
      env: input.env,
      target
    });
  } catch (error) {
    // `compacting` is the phase this failure died in — a phase label,
    // not a claim that a compaction was in flight.
    lifecycle.fail(error, 'compacting');
    return {
      ok: false,
      code: 'AUTO_COMPACT_DISPATCH_FAILED',
      message: `Auto-compact checkpoint written but IDE dispatch threw: ${summarizeLifecycleError(error)}`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        checkpointPath,
        convergencePlan: plan,
        target,
        mode,
        redLineGated: isRedLine
      }
    };
  }

  // Slice 2026-09-12-compact-band-policy (defect B): the stage is
  // chosen from what the dispatch ACTUALLY did, never from the hope
  // that it compacted. `ide-native` on claude-code only installs a
  // PreToolUse hook that fires at ratio ≥ 0.95 — below that nothing is
  // in flight and the honest stage is `armed` (see
  // `resolveDispatchedStage`). Writing `compacting` there published a
  // heartbeat that would never arrive, which is exactly what pinned
  // the statusline at `stalled` for 92 minutes in the field.
  if (dispatch.ok) {
    lifecycle.advance(resolveDispatchedStage({ pathway: dispatch.pathway, ratio: probe.ratio }));
  } else {
    // A dispatcher that returns `ok: false` did not compact anything —
    // record that as a failure at `compacting` rather than leaving the
    // run looking like it is still in progress.
    lifecycle.fail(new Error(dispatch.message), 'compacting');
  }

  // Slice 2026-07-30-compact-visibility: append a compact-history
  // event so the new 'peaks compact history' CLI and the
  // 'peaks statusline compact' indicator have a record. The
  // append is best-effort: a write failure must NOT block the
  // compact return envelope.
  try {
    appendCompactHistoryEvent({
      projectRoot: input.projectRoot,
      sessionId,
      event: {
        schemaVersion: 1,
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
      },
    });
  } catch { /* best-effort; do not fail the compact return */ }

  return {
    ok: dispatch.ok,
    code: dispatch.ok
      ? (isRedLine ? 'AUTO_COMPACT_RED_LINE' : 'AUTO_COMPACT_DISPATCHED')
      : 'AUTO_COMPACT_DISPATCH_FAILED',
    message: dispatch.ok
      ? isRedLine
        ? `RED-LINE compact dispatched (${dispatch.ide} / ${dispatch.pathway} / target=${target} / mode=${mode} — ${describeMode(mode)}); checkpoint at ${checkpointPath}. Further sub-agent dispatch is BLOCKED until ratio < 0.85.`
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
      redLineGated: isRedLine
    }
  };
}

/** Re-export for callers that need to surface the trigger shape. */
export type { CompactTrigger, ConvergencePlan, InFlightBatchProbe, AutoCompactResult };

/**
 * Slice 2026-07-30-compact-visibility: JSONL history of every
 * auto-compact dispatch. Appended at the end of `executeAutoCompact`
 * so the new 'peaks compact history' CLI + the
 * 'peaks statusline compact' indicator have a record. One file
 * per session (gitignored under `.peaks/_runtime/<sessionId>/`).
 */
export interface CompactHistoryEvent {
  readonly schemaVersion: 1;
  readonly ts: string;
  readonly target: 'main' | 'sub-agent' | 'worker';
  readonly mode: 'standard' | 'partial' | 'aggressive';
  readonly ide: string;
  readonly pathway: string;
  readonly beforeRatio: number;
  readonly redLine: boolean;
  readonly ok: boolean;
  readonly checkpointPath: string;
  readonly dispatchMessage: string;
}

export function appendCompactHistoryEvent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly event: CompactHistoryEvent;
}): void {
  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'compact-history.jsonl');
  appendFileSync(path, JSON.stringify(input.event) + '\n', 'utf8');
}
// Keep dirname import live for symmetry with sibling services that
// use it for path joins; tree-shaking removes it in builds.
void dirname;