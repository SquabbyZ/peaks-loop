// src/services/karpathy-cost/karpathy-cost-check-service.ts
//
// Slice 2026-07-30-karpathy-cost-self-review (slice 2/4). The
// karpathy-reviewer's JSON envelope is extended with `evaluationCost`
// + `costRatio` (see agents/karpathy-reviewer.md §4). This service
// is the orchestrator-side consumer of those fields.
//
// The check is intentionally small and pure-with-respect-to-its-inputs:
//   - It reads the slice's `rd/karpathy-review.md` (a JSON envelope
//     written by karpathy-reviewer sub-agent)
//   - It reads the 24h-mode state via a passed-in callable (NOT
//     a direct fs read, to keep this unit-testable in isolation)
//   - It decides whether to auto-downgrade a `'block'` gateAction
//     to `'warn'` based on costRatio
//   - It returns a structured result the CLI can render with
//     printResult()
//
// Backward compatibility: when evaluationCost is absent the check
// returns `'skipped-no-cost-data'` and gateAction is left untouched
// (the existing hard gate stays in effect — missing cost data must
// not silently downgrade a 'block').

import { readFileSync } from 'node:fs';
import { ok, fail, type ResultEnvelope } from 'peaks-loop-shared/result';

/** Threshold above which a `'block'` is downgraded to `'warn'`. */
export const KARPATHY_COST_DOWNGRADE_THRESHOLD = 10;
/** Threshold above which a sediment line is appended for human review. */
export const KARPATHY_COST_REPORT_THRESHOLD = 50;

export interface EvaluationCost {
  readonly wallMs: number;
  readonly subAgentsDispatched: number;
  readonly tokensEstimated: number;
  readonly sliceCodeSize: number;
}

export type GateAction = 'pass' | 'warn' | 'block';

export interface KarpathyReviewEnvelope {
  readonly passed?: boolean;
  readonly violations?: ReadonlyArray<unknown>;
  readonly gateAction?: GateAction;
  readonly evaluationCost?: EvaluationCost;
  readonly costRatio?: number;
}

export type KarpathyCostCheckDecision =
  | {
      readonly kind: 'no-cost-data';
      readonly gateAction: GateAction | null;
      readonly reason: 'envelope-missing-evaluationCost' | 'file-missing' | 'file-unreadable' | 'envelope-not-json';
    }
  | {
      readonly kind: '24h-mode-active';
      readonly gateAction: GateAction | null;
      readonly reason: 'peaks session 24h-mode state = 24H_ACTIVE; cost-check is the OVERRIDE, not the constrained side';
    }
  | {
      readonly kind: 'downgraded';
      readonly originalGateAction: 'block';
      readonly newGateAction: 'warn';
      readonly costRatio: number;
      readonly evaluationCost: EvaluationCost;
    }
  | {
      readonly kind: 'reported';
      readonly gateAction: GateAction;
      readonly costRatio: number;
      readonly evaluationCost: EvaluationCost;
    }
  | {
      readonly kind: 'unchanged';
      readonly gateAction: GateAction;
      readonly costRatio: number;
      readonly evaluationCost: EvaluationCost;
    };

export interface KarpathyCostCheckInput {
  /** The karpathy-review.md file content (verbatim). */
  readonly reviewFileContent: string;
  /** Callable that returns true if 24h-mode is active. */
  readonly is24hModeActive: () => boolean;
}

export interface KarpathyCostCheckOutput {
  readonly decision: KarpathyCostCheckDecision;
  /** Plain-text reason line for the CLI to print under the envelope. */
  readonly reasonLine: string;
}

/**
 * Pure: decide whether to downgrade a karpathy-reviewer gateAction.
 * No fs / no env reads — the input is pre-loaded by the CLI.
 */
export function decideKarpathyCostCheck(input: KarpathyCostCheckInput): KarpathyCostCheckOutput {
  if (input.is24hModeActive()) {
    return {
      decision: {
        kind: '24h-mode-active',
        gateAction: null,
        reason: 'peaks session 24h-mode state = 24H_ACTIVE; cost-check is the OVERRIDE, not the constrained side',
      },
      reasonLine: 'karpathy-cost-check: skipped (24h-mode active)',
    };
  }

  let envelope: KarpathyReviewEnvelope;
  try {
    envelope = JSON.parse(input.reviewFileContent) as KarpathyReviewEnvelope;
  } catch {
    return {
      decision: { kind: 'no-cost-data', gateAction: null, reason: 'envelope-not-json' },
      reasonLine: 'karpathy-cost-check: skipped (envelope not JSON)',
    };
  }

  if (!envelope.evaluationCost || typeof envelope.costRatio !== 'number') {
    return {
      decision: {
        kind: 'no-cost-data',
        gateAction: envelope.gateAction ?? null,
        reason: 'envelope-missing-evaluationCost',
      },
      reasonLine: 'karpathy-cost-check: skipped (envelope missing evaluationCost/costRatio)',
    };
  }

  const costRatio = envelope.costRatio;
  const evaluationCost = envelope.evaluationCost;

  if (envelope.gateAction === 'block' && costRatio > KARPATHY_COST_DOWNGRADE_THRESHOLD) {
    return {
      decision: {
        kind: 'downgraded',
        originalGateAction: 'block',
        newGateAction: 'warn',
        costRatio,
        evaluationCost,
      },
      reasonLine: `karpathy-cost-check: downgraded block → warn (costRatio=${costRatio.toFixed(2)} > ${KARPATHY_COST_DOWNGRADE_THRESHOLD})`,
    };
  }

  if (costRatio > KARPATHY_COST_REPORT_THRESHOLD) {
    return {
      decision: { kind: 'reported', gateAction: envelope.gateAction ?? 'pass', costRatio, evaluationCost },
      reasonLine: `karpathy-cost-check: costRatio=${costRatio.toFixed(2)} > ${KARPATHY_COST_REPORT_THRESHOLD} (sediment appended)`,
    };
  }

  return {
    decision: { kind: 'unchanged', gateAction: envelope.gateAction ?? 'pass', costRatio, evaluationCost },
    reasonLine: `karpathy-cost-check: unchanged (costRatio=${costRatio.toFixed(2)})`,
  };
}

/** Convenience: load the review file from disk and run the decision. */
export function runKarpathyCostCheck(opts: {
  readonly reviewFilePath: string;
  readonly is24hModeActive: () => boolean;
}): KarpathyCostCheckOutput {
  let content: string;
  try {
    content = readFileSync(opts.reviewFilePath, 'utf8');
  } catch {
    return {
      decision: { kind: 'no-cost-data', gateAction: null, reason: 'file-missing' },
      reasonLine: `karpathy-cost-check: skipped (file missing: ${opts.reviewFilePath})`,
    };
  }
  return decideKarpathyCostCheck({
    reviewFileContent: content,
    is24hModeActive: opts.is24hModeActive,
  });
}

/** Envelope-shape return for the CLI. */
export function buildCostCheckEnvelope(out: KarpathyCostCheckOutput): ResultEnvelope<KarpathyCostCheckDecision> {
  return ok('karpathy-cost-check', out.decision);
}
