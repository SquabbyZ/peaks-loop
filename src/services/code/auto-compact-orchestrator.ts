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
 *   2. If ratio ≥ 0.95 (RED LINE): peaks-loop ASKS the harness to
 *      compact and reports that it is waiting. It does NOT block
 *      sub-agent dispatch (slice
 *      2026-09-13-auto-compact-trigger-ownership, T3): peaks-loop owns
 *      the *decision*, the harness owns the *capability*, and peaks-loop
 *      has no way to compact a running session itself — so a "gate"
 *      here gated nothing and deadlocked the runner at the worst
 *      moment. If the ratio keeps rising and the harness has not
 *      compacted, the honest move is to say so and hand control back.
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
 * peaks-loop stops negotiating and requests the compact outright. Net
 * effect: the LLM-runner keeps working at any ratio without human
 * intervention, and without a gate it cannot satisfy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { resolveOuterSessionId } from '../session/binding-status-service.js';
import { resolveCanonicalProjectRoot } from '../config/config-service.js';
import { describeHarnessWindowSync, harnessWindowSyncWarning } from '../context/harness-window-config.js';
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  AUTO_COMPACT_RED_LINE_RATIO,
  DEPRECATED_ENVELOPE_FIELDS,
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
  fillEventSettledMeasurement,
  newCompactRunId,
  readOpenDispatchRun,
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
  /**
   * INERT — nothing reads this. It is threaded from the CLI's
   * `--bypass-red-line` (a published flag, kept for backward compatibility;
   * see the option's own note) down to `evaluateAutoCompactDecision`, where the
   * red-line branch ignores it.
   *
   * Why nothing reads it any more: it used to skip a gate that refused to
   * dispatch below 0.85. That gate was removed (slice
   * 2026-09-13-auto-compact-trigger-ownership, T3/A1) — peaks-loop cannot
   * compact a running session, so the refusal could not shorten the wait it
   * was waiting for, and it deadlocked the runner at the worst moment. With the
   * gate gone, the red line still ASKS the harness to compact (when it always
   * did) and no longer needs a bypass. Kept as a field so the published
   * signature does not change under callers that pass it.
   */
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
 *   - ratio ≥ redLine    → 'red-line' (ask the harness; dispatch continues)
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
    // Slice 2026-09-13-auto-compact-trigger-ownership (T3): the red line no
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
 *                                2026-09-13-auto-compact-trigger-ownership:
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
      ? 'RED-LINE compact requested from the harness; work CONTINUES (nothing is blocked). Re-probe with `peaks code context-now`; if the ratio is still ≥ 0.95 and the harness has not compacted, report it and hand control back to the user.'
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
 *
 * ZERO READERS as of slice 2026-09-13-auto-compact-trigger-ownership: the
 * write survives, but nothing consumes the file, and its `nextAction` asks
 * for a `/compact` the model cannot invoke (the Skill tool exposes only
 * `/init` and `/security-review`; hooks can observe or veto, never initiate).
 * Retained deliberately for the sibling A2 slice, which owns harness-side
 * state re-injection. Not a capability peaks-loop has today.
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
      ? 'RED-LINE compact REQUESTED from the harness (not executed by peaks-loop); work continues'
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
 *   7. If trigger.kind === 'red-line' → dispatch the IDE compact, report
 *      that the harness has been asked and that dispatch continues.
 *
 * The caller (CLI or skill body) handles the actual return — D7's
 * post-compact-detect will pick up the checkpoint on the next turn. For
 * red-line, the caller keeps working; it re-probes and, if the ratio is
 * still rising with no compact from the harness, reports that instead of
 * stalling.
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
  const { readContextPercent, syncHarnessWindowForProject } = await import('../context/auto-compact-reader.js');
  const outerSessionId = resolveOuterSessionId(input.projectRoot, sessionId, input.env ?? process.env);
  const probe = readContextPercent({
    projectRoot: input.projectRoot,
    sessionId,
    outerSessionId,
    env: input.env
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership (T1 + T2): write the very
  // denominator this probe divided by into the harness's own machine-local
  // settings, so "peaks-loop's 85%" and "the harness's trigger" are the same
  // point on one scale. Idempotent — an unchanged value performs no write, so
  // a hook firing this on every Bash call cannot churn the file.
  const harnessWindow = syncHarnessWindowForProject({
    // Promoted to the git root first (`--project .` is what the PreToolUse
    // hook passes): the harness's settings live at the project root, and the
    // envelope must report an absolute path for the write it claims to have
    // made. Fail-open — `resolveCanonicalProjectRoot` returns its input when
    // nothing resolves.
    projectRoot: resolveCanonicalProjectRoot(input.projectRoot),
    env: input.env,
    tokens: probe.capacityTokens ?? null
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
    const settled =
      settleOpenLifecycleRun({
        projectRoot: input.projectRoot,
        sessionId,
        measuredRatio: probe.ratio,
        source: probe.source,
        autoFireThreshold: thresholdFor(mode, 'autoFire'),
        onLifecycleStage: input.onLifecycleStage
      }) ??
      // Repair R1 (`2026-09-13-compact-event-settle`): the HARNESS event may
      // already have closed this run WITHOUT an honest post-compact number —
      // in which case the call above finds nothing open, and without this the
      // calibration pair stays blank for exactly the compactions the event path
      // exists to witness. Fills the number the event owed.
      fillEventSettledMeasurement({
        projectRoot: input.projectRoot,
        sessionId,
        measuredRatio: probe.ratio,
        source: probe.source
      });
    // Slice 2026-09-13-auto-compact-trigger-ownership (T4): a settle means a
    // dispatched compact demonstrably landed. Append an `observed` row
    // carrying the measured ratio, so `peaks compact history` can show
    // "asked at R (intent) / landed by R' (observed)" once a real session has
    // run. Without this row the intent has nothing to be compared against.
    if (settled !== null) {
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
    return {
      ok: true,
      code: decision.reason === 'in-flight-batch' ? 'AUTO_COMPACT_WAIT' : 'AUTO_COMPACT_SKIP',
      message: `${decision.trigger.kind === 'soft-warn'
        ? decision.trigger.message
        : decision.reason === 'in-flight-batch'
          ? `In-flight batch detected; deferring pre-compact (ratio=${(probe.ratio * 100).toFixed(1)}%); next probe will re-evaluate.`
          : `Context at ${(probe.ratio * 100).toFixed(1)}%; below the ${(thresholdFor(mode, 'autoFire') * 100).toFixed(0)}% auto-fire threshold (mode=${mode}).`}${
        // No compact was needed, but the sync may still have rewritten the
        // harness's settings (the first probe of a project always does). The
        // notice is appended ONLY for an actual write — the other actions'
        // sentences would be noise on every quiet probe — PLUS the one refusal
        // that is not quiet: a refused write that leaves peaks-loop's number and
        // the harness's pinned window disagreeing. That is the moment the ratio
        // stops describing the harness's trigger, so staying silent is exactly
        // the failure 要告知 exists to prevent.
        harnessWindow !== null && harnessWindow !== undefined &&
        (harnessWindow.action === 'written' || harnessWindowSyncWarning(harnessWindow) !== null)
          ? ` ${describeHarnessWindowSync(harnessWindow)}`
          : ''}`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        decision: decision.reason === 'in-flight-batch' ? 'in-flight-batch' : 'below-threshold',
        harnessWindow
      }
    };
  }

  const isRedLine = decision.reason === 'red-line';
  const now = input.now ?? new Date();

  // rid `2026-09-14-compact-dispatch-backoff`: ONE dispatch per compact
  // attempt.
  //
  // The decision above fires whenever the ratio is at or over the auto-fire
  // threshold, and the ratio does not come back down on its own — nothing in
  // peaks-loop can compact a running session, and the harness fires only at
  // its own red line. So "shouldCompact" was true on every probe, forever: one
  // real session's `compact-history.jsonl` holds 1075 dispatch rows, 444
  // checkpoints and ZERO compactions over 15.5 h — and the file was still
  // growing while this slice ran. Re-dispatching bought nothing, because the
  // `ide-native` dispatch only installs a PreToolUse hook and installing it
  // again is a documented no-op: 1074 of those 1075 rows say `already
  // installed` in their own `dispatchMessage`. It produced rows, not
  // compactions.
  //
  // The lifecycle store already knows whether an attempt is outstanding (see
  // `readOpenDispatchRun` — `armed`/`compacting` = dispatched, `completed`/
  // `failed` = over), so the gate needs no new state and no threshold: it is
  // keyed on the STAGE of the open run, never on a ratio, which is why it
  // survives any future realignment of the 0.65/0.70/0.85/0.95 table.
  //
  // What is NOT suppressed: the probe still measures and still reports. The
  // envelope carries the LIVE ratio plus the ratio the open ask was made at,
  // so "it crossed and it is still high, unanswered" stays legible on every
  // turn — the difference between a quiet signal and a silenced one.
  //
  // `force` (the `--force` test seam, "force compact at any ratio") outranks
  // the inference: an explicit instruction must not be silently reduced to a
  // no-op, which would make the published flag a lie.
  const openRun = readOpenDispatchRun({ projectRoot: input.projectRoot, sessionId });
  if (openRun !== null && input.force !== true) {
    return {
      ok: true,
      code: 'AUTO_COMPACT_ALREADY_ARMED',
      message:
        `Context at ${(probe.ratio * 100).toFixed(1)}% — still above the ` +
        `${(thresholdFor(mode, 'autoFire') * 100).toFixed(0)}% auto-fire threshold (mode=${mode}); ` +
        `a compact was already dispatched for this crossing at ${(openRun.triggerRatio * 100).toFixed(1)}% ` +
        `(run ${openRun.runId}, resting at '${openRun.stage}') and nothing has compacted since. ` +
        `Not dispatching again: the trigger is already registered, so a second dispatch would install the ` +
        `same hook and add a checkpoint and a history row without adding a capability. ` +
        `Re-probe with \`peaks code context-now\`.`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        decision: 'already-armed',
        armedAtRatio: openRun.triggerRatio,
        armedRunId: openRun.runId,
        harnessWindow
      }
    };
  }

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
          'RED-LINE: harness compact requested — sub-agent dispatch is NOT blocked; keep working',
          'Post-compact resume picks up the convergence plan from auto-decisions.md',
          'Next `peaks code context-now` probe will confirm the ratio dropped; if it keeps climbing and the harness has not compacted, report that to the user and hand control back',
          // Slice 2026-09-13-auto-compact-trigger-ownership: this command
          // also rewrites the harness's own settings, so it says so too. The
          // user accepted that write on the condition 要告知 — a write only
          // one of the two syncing commands reports is not a notice.
          describeHarnessWindowSync(harnessWindow)
        ]
      : [
          'Pre-compact dispatched — IDE compact in progress (async)',
          'Post-compact resume picks up the convergence plan from auto-decisions.md',
          'Next `peaks code auto-compact` probe will confirm ratio dropped below 0.85',
          describeHarnessWindowSync(harnessWindow)
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
        redLineRequested: isRedLine,
        // Compatibility alias + its record. `redLineGated` shipped from
        // 2.13.0 to 4.0.46, so a consumer outside this repo reads it and must
        // not start receiving `undefined`; the record is what makes the
        // deprecation visible to that consumer. See the type.
        redLineGated: isRedLine,
        deprecatedFields: DEPRECATED_ENVELOPE_FIELDS,
        harnessWindow
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
        redLineRequested: isRedLine,
        redLineGated: isRedLine,
        deprecatedFields: DEPRECATED_ENVELOPE_FIELDS,
        harnessWindow
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
        windowSource: probe.capacitySource ?? null,
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
  /**
   * Slice 2026-09-13-auto-compact-trigger-ownership (T4): the calibration
   * instrument. `windowTokens` is the denominator peaks-loop divided by
   * (`probe.capacityTokens`), so `beforeRatio * windowTokens` is the exact
   * TOKEN POINT peaks-loop asked the harness to compact at. That number is
   * the deliverable — NOT a hand-picked threshold: this slice could not run a
   * real Claude Code session, so the real trigger point of
   * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (documented as a window, observed to
   * fire near the window's end) has no measured answer yet. Recording the
   * intent lets the first real session produce one.
   */
  readonly windowTokens?: number | null;
  /** Which layer produced `windowTokens` (see `ContextWindowSource`). */
  readonly windowSource?: string | null;
  /**
   * `dispatch` (default, and the only kind earlier releases wrote) or
   * `observed` — a row appended when a later probe MEASURED the ratio after
   * a dispatched compact, proving one landed. The pair is what yields the
   * intent-vs-observed delta.
   */
  readonly kind?: 'dispatch' | 'observed';
  /** `observed` rows only: the measured post-compact ratio. */
  readonly afterRatio?: number;
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

/**
 * Best-effort variant for the post-compact measurement row. Telemetry must
 * never change the probe's return envelope, so an append failure here is
 * swallowed — same discipline as the dispatch-path append.
 */
function appendObservedCompactEvent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly event: CompactHistoryEvent;
}): void {
  try {
    appendCompactHistoryEvent(input);
  } catch { /* best-effort; the probe result is already settled */ }
}
// Keep dirname import live for symmetry with sibling services that
// use it for path joins; tree-shaking removes it in builds.
void dirname;