/**
 * v2.11.0 Group F (Tier 9) — D6: main-session context window monitor.
 *
 * Per `.peaks/memory/2026-06-26-v2-11-main-session-context-monitor.md`:
 *
 *   D6.a — IDE detection (`peaks ide detect --json`); env-var fallback.
 *   D6.b — Main-session thresholds (50% warn / 75% user red line / 90% emergency)
 *   D6.c — IDE-dependent trigger (claude-code → /compact; else LLM self-compress)
 *   D6.d — Always log; never silently skip
 *   D6.e — Do NOT auto-compact mid-tool-call-batch (in-flight deferral)
 *   D6.f — Complements Step N periodic checkpoint (soft signal vs hard signal)
 *
 * Distinct from G7-G9 (sub-agent dispatch prompt governance). Same
 * numbers, different scope. Extends `src/services/context/threshold.ts`
 * rather than duplicating (D6.h).
 *
 * Karpathy §2: this module is the only place that decides
 * "main-session context threshold" — the LLM-side caller probes via
 * `evaluateMainSessionThreshold()` and `pickMainSessionTrigger()`.
 * No inline `promptSize / 256K > 0.75` checks scattered across
 * SKILL.md or other services.
 */

import {
  CONTEXT_CAPACITY_DEFAULT_BYTES,
  THRESHOLD_SOFT_WARN_RATIO,
  THRESHOLD_NEAR_LIMIT_RATIO,
  THRESHOLD_EMERGENCY_RATIO,
  evaluateThresholdTier
} from './threshold.js';

export type MainSessionTier = 'ok' | 'soft-warn' | 'near-limit' | 'emergency';

export const MAIN_SESSION_THRESHOLD_RATIOS: { readonly [K in MainSessionTier]: number } = {
  ok: 0,
  'soft-warn': THRESHOLD_SOFT_WARN_RATIO,
  'near-limit': THRESHOLD_NEAR_LIMIT_RATIO,
  emergency: THRESHOLD_EMERGENCY_RATIO
};

export type IdeKind = 'claude-code' | 'trae' | 'opencode' | 'unknown';

export const IDE_KINDS: readonly IdeKind[] = [
  'claude-code',
  'trae',
  'opencode',
  'unknown'
] as const;

export type MainSessionTrigger =
  | { readonly kind: 'none' }
  | { readonly kind: 'soft-warn'; readonly promptSize: number; readonly ratio: number }
  | {
      readonly kind: 'compact';
      readonly ide: IdeKind;
      readonly path: 'ide-native' | 'llm-self-compress';
      readonly promptSize: number;
      readonly ratio: number;
      readonly code: 'CONTEXT_NEAR_LIMIT' | 'PROMPT_EMERGENCY';
    }
  | { readonly kind: 'defer'; readonly reason: 'in-flight-batch' | 'unsupported-ide' };

export interface MainSessionEvaluation {
  readonly tier: MainSessionTier;
  readonly ratio: number;
  readonly bytesUsed: number;
  readonly capacityBytes: number;
  readonly warnings: readonly string[];
}

export function isIdeKind(value: string): value is IdeKind {
  return (IDE_KINDS as readonly string[]).includes(value);
}

export function detectIdeFromEnv(env: NodeJS.ProcessEnv = process.env): IdeKind {
  if (typeof env['CLAUDE_CODE_ENTRYPOINT'] === 'string' && env['CLAUDE_CODE_ENTRYPOINT'].length > 0) {
    return 'claude-code';
  }
  if (typeof env['CLAUDE_SESSION_ID'] === 'string' && env['CLAUDE_SESSION_ID'].length > 0) {
    return 'claude-code';
  }
  if (typeof env['TRAE_CLI'] === 'string' && env['TRAE_CLI'].length > 0) {
    return 'trae';
  }
  if (typeof env['OPENCODE'] === 'string' && env['OPENCODE'].length > 0) {
    return 'opencode';
  }
  return 'unknown';
}

/**
 * Threshold check. Pure function (no IO). `capacityBytes` is injectable
 * for tests and future per-IDE capacity overrides. Defaults to the
 * G9 256K proxy (matches G9 for cognitive continuity).
 *
 * @deprecated Slice 2026-07-02-auto-compact-zero-pause: the
 * 50/75/90 tier thresholds pre-date the v2.13.0 auto-compact
 * design. The authoritative tier table for triggering compaction
 * now lives in `evaluateCompactTrigger` (auto-compact-orchestrator.ts)
 * with the 0.85 pre-compact / 0.95 red-line thresholds. New
 * callers should call `evaluateCompactTrigger(ratio)` directly.
 * This function is retained because legacy `peaks context check
 * --prompt-size` still emits its 4-tier envelope for callers that
 * need the soft signal (e.g. statusline display). Migration is
 * scheduled for v2.15.0; the @deprecated tag flips callers'
 * eslint warnings so the migration is mechanical.
 */
export function evaluateMainSessionThreshold(
  promptSize: number,
  capacityBytes: number = CONTEXT_CAPACITY_DEFAULT_BYTES
): MainSessionEvaluation {
  const inner = evaluateThresholdTier(promptSize, capacityBytes);
  // Map G9's 5 tiers down to the 4 main-session tiers (we collapse
  // 'hard-reject' into 'near-limit' for the main-session: when
  // dispatch is at 80% we still want a soft surface, not a hard block).
  const tier: MainSessionTier = ((): MainSessionTier => {
    switch (inner.tier) {
      case 'ok':
        return 'ok';
      case 'soft-warn':
        return 'soft-warn';
      case 'near-limit':
      case 'hard-reject':
        return 'near-limit';
      case 'emergency':
        return 'emergency';
    }
  })();
  return {
    tier,
    ratio: inner.ratio,
    bytesUsed: inner.bytesUsed,
    capacityBytes: inner.capacityBytes,
    warnings: inner.warnings
  };
}

export interface InFlightBatchProbe {
  readonly hasInFlightBatch: boolean;
  readonly sharedChannelEntries: number;
}

export function pickMainSessionTrigger(opts: {
  promptSize: number;
  ide?: IdeKind | undefined;
  capacityBytes?: number | undefined;
  inFlightBatch?: InFlightBatchProbe | undefined;
  /** Injectable env for IDE detection (test seam). */
  env?: NodeJS.ProcessEnv | undefined;
}): MainSessionTrigger {
  const ide = opts.ide ?? detectIdeFromEnv(opts.env);
  const evaluation = evaluateMainSessionThreshold(opts.promptSize, opts.capacityBytes);

  if (evaluation.tier === 'ok') {
    return { kind: 'none' };
  }

  if (evaluation.tier === 'soft-warn') {
    return {
      kind: 'soft-warn',
      promptSize: evaluation.bytesUsed,
      ratio: evaluation.ratio
    };
  }

  if (opts.inFlightBatch?.hasInFlightBatch === true) {
    return { kind: 'defer', reason: 'in-flight-batch' };
  }

  if (ide === 'unknown') {
    return { kind: 'defer', reason: 'unsupported-ide' };
  }

  const code: 'CONTEXT_NEAR_LIMIT' | 'PROMPT_EMERGENCY' =
    evaluation.tier === 'emergency' ? 'PROMPT_EMERGENCY' : 'CONTEXT_NEAR_LIMIT';
  const path: 'ide-native' | 'llm-self-compress' = ide === 'claude-code' ? 'ide-native' : 'llm-self-compress';

  return {
    kind: 'compact',
    ide,
    path,
    promptSize: evaluation.bytesUsed,
    ratio: evaluation.ratio,
    code
  };
}

/**
 * One-line audit log entry. Pure formatter; the LLM / CLI appends to
 * `.peaks/_runtime/<sessionId>/txt/auto-decisions.md`. Matches D6.d.
 */
export function formatMainSessionTriggerLogLine(
  trigger: MainSessionTrigger,
  contextId: string
): string {
  switch (trigger.kind) {
    case 'none':
      return `context ${contextId}: ok (no trigger)`;
    case 'soft-warn':
      return `context ${contextId}: warning 50% threshold (ratio=${trigger.ratio.toFixed(2)})`;
    case 'defer':
      return `context ${contextId}: deferred (${trigger.reason})`;
    case 'compact':
      return `context ${contextId}: threshold=${(trigger.ratio * 100).toFixed(0)}% trigger=${trigger.path} ide=${trigger.ide} code=${trigger.code}`;
  }
}
