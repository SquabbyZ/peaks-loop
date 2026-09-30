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
 *        --json`). ratio ≥ 0.95 → WARNING (red-line, ask-and-wait);
 *        ≥ 0.85 → WARNING (pre-compact band). Never a blocker — see the
 *        comment on the Q4 branch in `buildOrchestratorCanDoResult`, and
 *        `evaluateCompactTrigger`, which is the face this one must agree with.
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
 *
 * Slice c2w1 (strict-remediation-abc) hoisted two cohesive halves out of this
 * file into siblings, both re-exported here so nothing else moved:
 * `./orchestrator-can-do-probes.js` (the Q2/Q4 subprocess probes) and
 * `./orchestrator-can-do-advisories.js` (the Q1/Q2/Q3/Q4 message builders,
 * incl. the 0.95 / 0.85 thresholds).
 */

import { randomUUID } from 'node:crypto';

import {
  probeContextRatio,
  probeSubAgentAvailable,
  type ContextProbe
} from './orchestrator-can-do-probes.js';
import {
  boundaryAdvisories,
  ORCHESTRATOR_PRECOMPACT_RATIO,
  ORCHESTRATOR_REDLINE_RATIO
} from './orchestrator-can-do-advisories.js';

// The probes, the thresholds and `ContextProbe` keep THIS module path as their
// public surface: the CLI shim reaches the two probes through
// `await import('../../services/code/orchestrator-can-do.js')`, so the
// re-export below is load-bearing, not cosmetic.
export { probeContextRatio, probeSubAgentAvailable };
export { ORCHESTRATOR_PRECOMPACT_RATIO, ORCHESTRATOR_REDLINE_RATIO };
export type { ContextProbe };

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
  '.rs'
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
  'scripts/'
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
  'user choice'
] as const;

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

/** Suggestion surfaced when canDoInSession=true and no source code is touched. */
const NON_SOURCE_CODE_SLICE_SUGGESTION =
  'non-source-code slice; orchestrator may handle in-session (e.g. via Write/Edit tools or directly)';

/**
 * The concrete delegation verb for a source-code slice, with a fresh
 * `--request-id` and `--batch-id` on every call (as before).
 */
function subAgentDispatchSuggestion(projectRoot: string): string {
  const batchId = randomUUID();
  const rid = 'rid-' + Date.now().toString(36);
  return `peaks sub-agent dispatch rd --prompt "<slice-spec>" --request-id ${rid} --project ${projectRoot} --batch-id ${batchId}`;
}

/**
 * Build the structured OrchestratorCanDoResult. Pure over the 4 Q
 * signals + sliceSpec. Decision rule is: canDoInSession === !blockers.
 */
export function buildOrchestratorCanDoResult(
  input: OrchestratorCanDoInput,
  signals: {
    q1SourceCodeTouched: boolean;
    q1HardBlockedPath: boolean;
    q2SubAgentAvailable: boolean;
    q3RequiresUserDecision: boolean;
    q4ContextRatio: number;
  }
): OrchestratorCanDoResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Q1 (hard) / Q2 / Q4 / Q3 — the messages, in the order they were always
  // pushed. The reasoning that keeps the context ratio a WARNING and never a
  // blocker rides along in `boundaryAdvisories` (orchestrator-can-do-advisories).
  const boundary = boundaryAdvisories(signals);
  blockers.push(...boundary.blockers);
  warnings.push(...boundary.warnings);
  suggestions.push(...boundary.suggestions);

  // Q1 (soft) — source-code touched is a sub-agent-dispatch hint. When
  // not already hard-blocked (above), surface the dispatch verb. When
  // already hard-blocked the blocker line carries the same instruction.
  if (signals.q1SourceCodeTouched && signals.q2SubAgentAvailable) {
    suggestions.push(subAgentDispatchSuggestion(input.projectRoot));
  }

  // When canDoInSession=true and there's no source code touched,
  // surface a generic "do it" suggestion.
  const canDoInSession = blockers.length === 0;
  if (canDoInSession && !signals.q1SourceCodeTouched) {
    suggestions.push(NON_SOURCE_CODE_SLICE_SUGGESTION);
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
    q4ContextRatio: signals.q4ContextRatio
  };
}

/**
 * Evaluate a slice-spec end-to-end. Probes Q2/Q4 via subprocess
 * (overridable via test seams in `input`). Q1/Q3 are pure.
 */
export async function evaluateOrchestratorCanDo(
  input: OrchestratorCanDoInput
): Promise<OrchestratorCanDoResult> {
  if (!input.sliceSpec || input.sliceSpec.trim().length === 0) {
    throw new OrchestratorCanDoError('--slice-spec is required', 'MISSING_SLICE_SPEC');
  }

  const q1SourceCodeTouched = detectSourceCodeTouched(input.sliceSpec);
  const q1HardBlockedPath = detectHardBlockedPath(input.sliceSpec);
  const q3RequiresUserDecision = detectRequiresUserDecision(input.sliceSpec);

  const probeSubAgent =
    input.probeSubAgentAvailable ?? (() => probeSubAgentAvailable(input.projectRoot));
  const probeContext = input.probeContextRatio ?? (() => probeContextRatio(input.projectRoot));

  const [subAgentAvailable, ctxProbe] = await Promise.all([probeSubAgent(), probeContext()]);

  return buildOrchestratorCanDoResult(input, {
    q1SourceCodeTouched,
    q1HardBlockedPath,
    q2SubAgentAvailable: subAgentAvailable,
    q3RequiresUserDecision,
    q4ContextRatio: ctxProbe.ratio
  });
}
