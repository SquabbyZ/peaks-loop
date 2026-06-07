/**
 * G9 — forced compression gate (RL-27..RL-32).
 *
 * The CLI 兜底 layer. Validates prompt size against the threshold
 * table in `threshold.ts` and returns a decision. The PreToolUse hook
 * layer (`peaks sub-agent-dispatch-guard`) re-runs the same logic
 * without `--force` (RL-30 strict).
 *
 * Decision codes:
 *   - `OK`                          — under 50%
 *   - `CONTEXT_SOFT_WARN`           — 50-75%, suggest --use-headroom
 *   - `CONTEXT_NEAR_LIMIT`          — 75-80%, mandatory --use-headroom suggestion
 *   - `PROMPT_TOO_LARGE`            — 80-90%, hard reject (allow = false)
 *   - `PROMPT_EMERGENCY`            — ≥ 90%, hard reject + emergency
 *   - `FORCED_OVER_THRESHOLD`       — user passed --force at CLI; allow = true
 *
 * See: `.peaks/memory/sub-agent-headroom-forced-compression-gate.md`.
 */
import {
  CONTEXT_CAPACITY_DEFAULT_BYTES,
  evaluateThresholdTier,
  tierToCode,
  type ThresholdEvaluation,
  type ThresholdTier
} from './threshold.js';

export type ContextGuardCode =
  | 'OK'
  | 'CONTEXT_SOFT_WARN'
  | 'CONTEXT_NEAR_LIMIT'
  | 'PROMPT_TOO_LARGE'
  | 'PROMPT_EMERGENCY'
  | 'FORCED_OVER_THRESHOLD';

export interface ContextGuardDecision {
  readonly allow: boolean;
  readonly code: ContextGuardCode;
  readonly warnings: readonly string[];
  readonly suggest: string | null;
  readonly evaluation: ThresholdEvaluation;
  /** ISO8601 timestamp when --force override was applied. null otherwise. */
  readonly forcedAt: string | null;
}

export interface ContextGuardOptions {
  /** Pass `true` to allow override at the ≥ 80% tier. CLI-only; hook layer MUST NOT set this. */
  readonly force?: boolean;
  /** Override the default 256K context capacity (e.g. for tests). */
  readonly capacityBytes?: number;
}

const NEAR_LIMIT_SUGGEST = 'Consider --use-headroom to compress prompt.';
const SOFT_WARN_SUGGEST = 'Use --use-headroom to compress prompt proactively.';
const HARD_REJECT_SUGGEST =
  'Trim prompt to < 80% of context capacity. Pass --force at CLI to override (NOT allowed at hook layer).';
const EMERGENCY_SUGGEST =
  'Prompt exceeds 90% of context. Trim aggressively or split into multiple dispatches.';

/**
 * Evaluate a prompt size against the G9.3 threshold table.
 *
 * The `force` option is the **only** path that lets a ≥ 80% prompt
 * through. The hook layer (PreToolUse) MUST NOT accept this option;
 * it is enforced by the `peaks sub-agent-dispatch-guard` atom's
 * command-line parser, which does not declare a `--force` flag.
 */
export function evaluatePromptSize(
  promptSize: number,
  opts: ContextGuardOptions = {}
): ContextGuardDecision {
  const capacity = opts.capacityBytes ?? CONTEXT_CAPACITY_DEFAULT_BYTES;
  const evaluation = evaluateThresholdTier(promptSize, capacity);
  const tier: ThresholdTier = evaluation.tier;

  let allow: boolean;
  let code: ContextGuardCode;
  let suggest: string | null;
  let forcedAt: string | null = null;

  switch (tier) {
    case 'ok':
      allow = true;
      code = 'OK';
      suggest = null;
      break;
    case 'soft-warn':
      allow = true;
      code = 'CONTEXT_SOFT_WARN';
      suggest = SOFT_WARN_SUGGEST;
      break;
    case 'near-limit':
      allow = true;
      code = 'CONTEXT_NEAR_LIMIT';
      suggest = NEAR_LIMIT_SUGGEST;
      break;
    case 'hard-reject':
      allow = false;
      code = 'PROMPT_TOO_LARGE';
      suggest = HARD_REJECT_SUGGEST;
      break;
    case 'emergency':
      allow = false;
      code = 'PROMPT_EMERGENCY';
      suggest = EMERGENCY_SUGGEST;
      break;
  }

  // --force override (CLI only; hook layer never reaches this branch)
  if (!allow && opts.force === true) {
    allow = true;
    code = 'FORCED_OVER_THRESHOLD';
    suggest = 'Override applied at CLI. Hook layer will still reject.';
    forcedAt = new Date().toISOString();
  }

  const warnings: string[] = [...evaluation.warnings];
  if (forcedAt !== null && !warnings.includes('FORCED_OVER_THRESHOLD')) {
    warnings.push('FORCED_OVER_THRESHOLD');
  }

  return {
    allow,
    code,
    warnings,
    suggest,
    evaluation,
    forcedAt
  };
}

/**
 * Re-export of `tierToCode` for callers that want a stable mapping
 * without depending on the threshold module directly.
 */
export { tierToCode };
