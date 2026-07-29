/**
 * Slice 2026-07-28 — auto-compact mode table for 24h long-run awareness.
 *
 * The default `'standard'` mode preserves the v2.13.0 zero-pause contract
 * thresholds (preCompact=0.85, redLine=0.95). The `'partial'` mode fires
 * earlier for 24h long-run scenarios where the user has explicitly
 * opted into higher compaction cadence via `peaks session 24h-mode`.
 *
 * Slice 2026-07-29-context-evaluation-accuracy Part 22: a new
 * `autoFire` tier is added between soft-warn and preCompact. peaks-loop
 * preempts and runs `peaks compact auto --execute` itself when
 * context crosses `autoFire`; the LLM is NOT asked to "decide"
 * (the LLM-judged 0.85–0.95 zone was the source of false-positive
 * "context too low" reports at 60%+ free — the LLM was guessing).
 *
 * The mode only changes the THRESHOLDS at which the orchestrator fires.
 * The actual partial-compaction behaviour (dropping low-priority context
 * layers) is a follow-up slice; for now `partial` mode is logged +
 * decision-emitted, no separate compaction pathway.
 */

export type AutoCompactMode = 'standard' | 'partial';

export const AUTO_COMPACT_THRESHOLDS: Readonly<Record<AutoCompactMode, {
  readonly autoFire: number;
  readonly preCompact: number;
  readonly redLine: number;
}>> = {
  standard: { autoFire: 0.80, preCompact: 0.85, redLine: 0.95 },
  partial: { autoFire: 0.65, preCompact: 0.70, redLine: 0.85 }
};

export function thresholdFor(mode: AutoCompactMode, kind: 'autoFire' | 'preCompact' | 'redLine'): number {
  return AUTO_COMPACT_THRESHOLDS[mode][kind];
}

export function isValidMode(value: string): value is AutoCompactMode {
  return value === 'standard' || value === 'partial';
}

export function describeMode(mode: AutoCompactMode): string {
  return mode === 'standard'
    ? 'standard (0.85/0.95 — v2.13.0 zero-pause contract)'
    : 'partial (0.70/0.85 — 24h long-run mode)';
}

export function isPartialModeEligible(contextPercent: number): boolean {
  return contextPercent >= AUTO_COMPACT_THRESHOLDS.partial.preCompact;
}
