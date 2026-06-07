/**
 * G9.3 — forced compression gate threshold constants + tier evaluation.
 *
 * 256K default context capacity is a conservative proxy. The LLM's real
 * capacity is its private business (R-1 / R-8 / R-10 / R-13 boundary
 * inherited from slice #009); we use prompt size as the gate signal.
 *
 * See: `.peaks/memory/sub-agent-headroom-forced-compression-gate.md`
 * for the full G9 rule (RL-27..RL-32, AC-50..AC-65).
 */

export const CONTEXT_CAPACITY_DEFAULT_BYTES = 256 * 1024;  // 256K
export const THRESHOLD_SOFT_WARN_RATIO = 0.5;             // 50%
export const THRESHOLD_NEAR_LIMIT_RATIO = 0.75;           // 75% — user red line
export const THRESHOLD_HARD_REJECT_RATIO = 0.80;          // 80%
export const THRESHOLD_EMERGENCY_RATIO = 0.90;            // 90%

export type ThresholdTier =
  | 'ok'
  | 'soft-warn'
  | 'near-limit'
  | 'hard-reject'
  | 'emergency';

export interface ThresholdEvaluation {
  readonly tier: ThresholdTier;
  readonly ratio: number;
  readonly bytesUsed: number;
  readonly capacityBytes: number;
  readonly warnings: readonly string[];
}

/**
 * Compute the threshold tier for a given prompt size. Pure function
 * (no IO, no side effects). The `capacityBytes` parameter lets callers
 * override the default 256K proxy (e.g. for testing or for a future
 * per-IDE capacity override).
 */
export function evaluateThresholdTier(
  promptSize: number,
  capacityBytes: number = CONTEXT_CAPACITY_DEFAULT_BYTES
): ThresholdEvaluation {
  if (!Number.isFinite(promptSize) || promptSize < 0) {
    throw new Error(`evaluateThresholdTier: promptSize must be ≥ 0 (got ${promptSize})`);
  }
  if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) {
    throw new Error(`evaluateThresholdTier: capacityBytes must be > 0 (got ${capacityBytes})`);
  }

  const ratio = promptSize / capacityBytes;
  const warnings: string[] = [];
  let tier: ThresholdTier;

  if (ratio >= THRESHOLD_EMERGENCY_RATIO) {
    tier = 'emergency';
    warnings.push('PROMPT_EMERGENCY');
  } else if (ratio >= THRESHOLD_HARD_REJECT_RATIO) {
    tier = 'hard-reject';
    warnings.push('PROMPT_TOO_LARGE');
  } else if (ratio >= THRESHOLD_NEAR_LIMIT_RATIO) {
    tier = 'near-limit';
    warnings.push('CONTEXT_NEAR_LIMIT');
  } else if (ratio >= THRESHOLD_SOFT_WARN_RATIO) {
    tier = 'soft-warn';
    warnings.push('CONTEXT_SOFT_WARN');
  } else {
    tier = 'ok';
  }

  return {
    tier,
    ratio,
    bytesUsed: promptSize,
    capacityBytes,
    warnings
  };
}

/**
 * Convert a threshold tier to a machine-readable code suitable for the
 * CLI envelope's `code` field. Used by both the CLI and the hook layer.
 */
export function tierToCode(tier: ThresholdTier): string {
  switch (tier) {
    case 'ok':
      return 'OK';
    case 'soft-warn':
      return 'CONTEXT_SOFT_WARN';
    case 'near-limit':
      return 'CONTEXT_NEAR_LIMIT';
    case 'hard-reject':
      return 'PROMPT_TOO_LARGE';
    case 'emergency':
      return 'PROMPT_EMERGENCY';
  }
}
