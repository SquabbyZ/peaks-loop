/**
 * Slice 2026-08-05-orchestrator-can-do-probe — service layer for
 * `peaks code orchestrator-can-do`.
 *
 * Encodes the 2026-08-05 lesson (`.peaks/memory/2026-08-05-peaks-code-
 * orchestrator-capability-misjudgment.md`): the peaks-code orchestrator
 * MUST NOT Edit/Write `src/` files directly, but MUST delegate via
 * `peaks sub-agent dispatch`. The decision "can this slice run in the
 * current session" must be a structured probe — not a vibes call.
 *
 * The probe answers 4 boundary questions:
 *   Q1 — Is the change to source code? (keywords: src/, *.ts, *.tsx,
 *        *.js, package.json, tsconfig, workflows/). If yes → NOT a
 *        blocker; orchestrator delegates to sub-agent.
 *   Q2 — Can a sub-agent be dispatched? (probe `peaks sub-agent
 *        dispatch --role rd --help`). If no → blocker.
 *   Q3 — Does the slice require user decisions? (keywords: design,
 *        decide, ?, 选择, 决定). If yes → soft warning, NOT a blocker
 *        (the LLM should AskUserQuestion, which is cheap).
 *   Q4 — Is context usage sustainable? (probe `peaks code context-now
 *        --json`). ratio ≥ 0.95 → blocker (red-line); ≥ 0.85 →
 *        blocker (auto-compact-now).
 *
 * Decision rule:
 *   canDoInSession === (blockers.length === 0)
 *
 * Concrete suggestion when canDoInSession=true and slice touches
 * source code:
 *   `peaks sub-agent dispatch rd --prompt "<slice-spec>" --request-id
 *   <rid> --project . --batch-id <uuid>`
 *
 * Pure-function module. The CLI shim (code-orchestrator-can-do.ts)
 * adapts the envelope into the program's `ResultEnvelope<T>` shape.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

/** Slice 2026-08-05-orchestrator-can-do-probe: red-line threshold. */
export const ORCHESTRATOR_REDLINE_RATIO = 0.95;
/** Slice 2026-08-05-orchestrator-can-do-probe: pre-compact threshold. */
export const ORCHESTRATOR_PRECOMPACT_RATIO = 0.85;

/** Source-code keywords that signal "do NOT Edit/Write directly". */
export const SOURCE_CODE_KEYWORDS: readonly string[] = [
  'src/',
  'source/',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  'package.json',
  'tsconfig',
  'workflows/',
  '.py',
  '.go',
  '.rs',
] as const;

/**
 * Slice 2026-08-06-codegate-vendor-neutral — hard-blocked path families.
 * When ANY of these substrings appears in the slice-spec, the orchestrator
 * MUST NOT Edit/Write directly; the probe returns `canDoInSession: false`
 * with `blockers: ["requires-sub-agent-dispatch"]` to force
 * `peaks sub-agent dispatch rd`. The hook (`pre-tool-code-gate.sh`)
 * enforces the same deny at the PreToolUse layer.
 *
 * The allow-list (.peaks/**, .peaks/_runtime/**, skill files, docs/**)
 * is checked by the hook, NOT by this probe — the probe is content-side
 * (slice-spec text) and the hook is file-side (resolved path on Edit/Write).
 */
export const HARD_BLOCKED_PATH_FAMILIES: readonly string[] = [
  'src/',
  'tests/unit/',
  'tests/integration/',
  'config/',
  'bin/',
  'scripts/',
] as const;

/** Decision-marker keywords that signal "needs user AskUserQuestion". */
export const DECISION_KEYWORDS: readonly string[] = [
  'design',
  'decide',
  'choose',
  '?',
  '选择',
  '决定',
  'design decision',
  'user choice',
] as const;

export interface ContextProbe {
  /** 0.0–1.0; ≥0.85 = pre-compact; ≥0.95 = red-line. */
  readonly ratio: number;
  /** Source tag from `peaks code context-now`. */
  readonly source: string;
}

export interface OrchestratorCanDoInput {
  readonly sliceSpec: string;
  readonly projectRoot: string;
  /**
   * Test seam — caller injects probe results. Production CLI builds
   * these via `probeSubAgentAvailable` + `probeContextRatio`. When the
   * test seam is set, the CLI's actual probes are skipped.
   */
  readonly probeSubAgentAvailable?: () => Promise<boolean>;
  readonly probeContextRatio?: () => Promise<ContextProbe>;
}

export interface OrchestratorCanDoResult {
  /** canDoInSession === (blockers.length === 0). */
  readonly canDoInSession: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly suggestions: readonly string[];
  readonly contextRatio: number;
  readonly subAgentAvailable: boolean;
  /** Diagnostic — which of the 4 boundary questions fired. */
  readonly q1SourceCodeTouched: boolean;
  /** Slice 2026-08-06-codegate-vendor-neutral: did the slice-spec mention a hard-blocked path family (src/, tests/unit/, ...)? When true the probe refuses direct execution. */
  readonly q1HardBlockedPath: boolean;
  readonly q2SubAgentAvailable: boolean;
  readonly q3RequiresUserDecision: boolean;
  readonly q4ContextRatio: number;
}

export class OrchestratorCanDoError extends Error {
  constructor(
    message: string,
    public readonly code: 'MISSING_SLICE_SPEC' | 'PROBE_FAILED'
  ) {
    super(message);
    this.name = 'OrchestratorCanDoError';
  }
}

/**
 * Q1: does the slice touch source code? Pure keyword scan over
 * the slice-spec string. Case-insensitive substring match.
 */
export function detectSourceCodeTouched(sliceSpec: string): boolean {
  const lower = sliceSpec.toLowerCase();
  return SOURCE_CODE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Slice 2026-08-06-codegate-vendor-neutral — does the slice-spec mention
 * any hard-blocked path family? Pure substring match. When true, the
 * probe returns `canDoInSession: false` with `requires-sub-agent-dispatch`.
 * This is the LLM-side complement to the `pre-tool-code-gate.sh` hook
 * (which checks the actual Edit/Write/MultiEdit target path).
 */
export function detectHardBlockedPath(sliceSpec: string): boolean {
  const lower = sliceSpec.toLowerCase();
  return HARD_BLOCKED_PATH_FAMILIES.some((fam) => lower.includes(fam.toLowerCase()));
}

/**
 * Q3: does the slice require user decisions? Pure keyword scan
 * over the slice-spec string.
 */
export function detectRequiresUserDecision(sliceSpec: string): boolean {
  const lower = sliceSpec.toLowerCase();
  return DECISION_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Q2: probe `peaks sub-agent dispatch --role rd --help`. Returns
 * true when the subprocess exits 0. Resolves to false on spawn
 * failure or non-zero exit.
 */
export async function probeSubAgentAvailable(
  projectRoot: string,
  peaksBin: string = 'peaks'
): Promise<boolean> {
  try {
    await execFileAsync(peaksBin, ['sub-agent', 'dispatch', '--role', 'rd', '--help'], {
      cwd: projectRoot,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Q4: probe `peaks code context-now --json`. Parses the data.ratio
 * field. Falls back to {ratio: 0, source: 'unavailable'} when the
 * subprocess fails or returns malformed JSON.
 */
export async function probeContextRatio(
  projectRoot: string,
  peaksBin: string = 'peaks'
): Promise<ContextProbe> {
  try {
    const { stdout } = await execFileAsync(peaksBin, ['code', 'context-now', '--project', projectRoot, '--json'], {
      cwd: projectRoot,
      timeout: 10000,
    });
    const parsed = JSON.parse(stdout) as { data?: { ratio?: number; source?: string } };
    const ratio = typeof parsed.data?.ratio === 'number' ? parsed.data.ratio : 0;
    const source = typeof parsed.data?.source === 'string' ? parsed.data.source : 'unavailable';
    return { ratio, source };
  } catch {
    return { ratio: 0, source: 'unavailable' };
  }
}

/**
 * Build the structured OrchestratorCanDoResult. Pure over the 4 Q
 * signals + sliceSpec. Decision rule is: canDoInSession === !blockers.
 */
export function buildOrchestratorCanDoResult(input: OrchestratorCanDoInput, signals: {
  q1SourceCodeTouched: boolean;
  q1HardBlockedPath: boolean;
  q2SubAgentAvailable: boolean;
  q3RequiresUserDecision: boolean;
  q4ContextRatio: number;
}): OrchestratorCanDoResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Slice 2026-08-06-codegate-vendor-neutral — Q1 HARD BLOCKER. When
  // the slice-spec mentions any hard-blocked path family
  // (src/, tests/unit/, tests/integration/, config/, bin/, scripts/),
  // the orchestrator MUST refuse direct execution and force sub-agent
  // dispatch. This is the LLM-side complement to the
  // `pre-tool-code-gate.sh` PreToolUse hook.
  if (signals.q1HardBlockedPath) {
    blockers.push(
      'requires-sub-agent-dispatch: slice-spec mentions a hard-blocked path family ' +
        '(src/, tests/unit/, tests/integration/, config/, bin/, scripts/); ' +
        'orchestrator MUST NOT Edit/Write these directly. Use peaks sub-agent dispatch rd.'
    );
  }

  // Q2 — sub-agent availability is a hard precondition.
  if (!signals.q2SubAgentAvailable) {
    blockers.push('sub-agent dispatch unavailable (peaks sub-agent dispatch --help failed)');
    suggestions.push('verify peaks CLI is on PATH; check `peaks --version`');
  }

  // Q4 — context ratio gate. ≥0.95 → red-line; ≥0.85 → pre-compact.
  if (signals.q4ContextRatio >= ORCHESTRATOR_REDLINE_RATIO) {
    blockers.push(
      `context red-line (ratio=${signals.q4ContextRatio.toFixed(2)} ≥ ${ORCHESTRATOR_REDLINE_RATIO}); auto-compact now or push to next session`
    );
    suggestions.push('peaks compact auto --execute');
  } else if (signals.q4ContextRatio >= ORCHESTRATOR_PRECOMPACT_RATIO) {
    blockers.push(
      `context near limit (ratio=${signals.q4ContextRatio.toFixed(2)} ≥ ${ORCHESTRATOR_PRECOMPACT_RATIO}); auto-compact or push to next session`
    );
    suggestions.push('peaks compact auto --execute');
  }

  // Q3 — user-decision keywords → soft warning, NOT a blocker. The
  // LLM should AskUserQuestion, which is cheap.
  if (signals.q3RequiresUserDecision) {
    warnings.push('slice-spec contains decision keywords; AskUserQuestion before proceeding');
  }

  // Q1 (soft) — source-code touched is a sub-agent-dispatch hint. When
  // not already hard-blocked (above), surface the dispatch verb. When
  // already hard-blocked the blocker line carries the same instruction.
  if (signals.q1SourceCodeTouched && signals.q2SubAgentAvailable) {
    const batchId = randomUUID();
    const rid = 'rid-' + Date.now().toString(36);
    suggestions.push(
      `peaks sub-agent dispatch rd --prompt "<slice-spec>" --request-id ${rid} --project ${input.projectRoot} --batch-id ${batchId}`
    );
  }

  // When canDoInSession=true and there's no source code touched,
  // surface a generic "do it" suggestion.
  const canDoInSession = blockers.length === 0;
  if (canDoInSession && !signals.q1SourceCodeTouched) {
    suggestions.push(`non-source-code slice; orchestrator may handle in-session (e.g. via Write/Edit tools or directly)`);
  }

  return {
    canDoInSession,
    blockers,
    warnings,
    suggestions,
    contextRatio: signals.q4ContextRatio,
    subAgentAvailable: signals.q2SubAgentAvailable,
    q1SourceCodeTouched: signals.q1SourceCodeTouched,
    q1HardBlockedPath: signals.q1HardBlockedPath,
    q2SubAgentAvailable: signals.q2SubAgentAvailable,
    q3RequiresUserDecision: signals.q3RequiresUserDecision,
    q4ContextRatio: signals.q4ContextRatio,
  };
}

/**
 * Evaluate a slice-spec end-to-end. Probes Q2/Q4 via subprocess
 * (overridable via test seams in `input`). Q1/Q3 are pure.
 */
export async function evaluateOrchestratorCanDo(input: OrchestratorCanDoInput): Promise<OrchestratorCanDoResult> {
  if (!input.sliceSpec || input.sliceSpec.trim().length === 0) {
    throw new OrchestratorCanDoError('--slice-spec is required', 'MISSING_SLICE_SPEC');
  }

  const q1SourceCodeTouched = detectSourceCodeTouched(input.sliceSpec);
  const q1HardBlockedPath = detectHardBlockedPath(input.sliceSpec);
  const q3RequiresUserDecision = detectRequiresUserDecision(input.sliceSpec);

  const probeSubAgent =
    input.probeSubAgentAvailable ?? (() => probeSubAgentAvailable(input.projectRoot));
  const probeContext =
    input.probeContextRatio ?? (() => probeContextRatio(input.projectRoot));

  const [subAgentAvailable, ctxProbe] = await Promise.all([
    probeSubAgent(),
    probeContext(),
  ]);

  return buildOrchestratorCanDoResult(input, {
    q1SourceCodeTouched,
    q1HardBlockedPath,
    q2SubAgentAvailable: subAgentAvailable,
    q3RequiresUserDecision,
    q4ContextRatio: ctxProbe.ratio,
  });
}