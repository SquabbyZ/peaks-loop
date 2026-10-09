// The one table-to-vocabulary mapping `peaks code context-now` decides with: the
// shared `CompactTrigger` kind translated to this command's `action`, and the labels
// it prints, both read out of the mode in force.
import { type AutoCompactMode, thresholdFor } from '../../services/code/auto-compact-modes.js';
import { AUTO_COMPACT_SOFT_WARN_RATIO } from '../../services/context/auto-compact-types.js';
import { evaluateCompactTrigger } from '../../services/code/auto-compact-orchestrator.js';

/** The one dispatch verb the action and red-line tiers name. */
const COMPACT_CMD = 'peaks code auto-compact';

/**
 * Slice H4 (rid=h4-context-now-mode-blind) — the ONE mapping from the shared
 * `CompactTrigger` to this command's `action` vocabulary, so the two cannot
 * drift: the trigger is `evaluateCompactTrigger`, the same function `peaks
 * code auto-compact` decides with.
 *
 * `auto-fire` maps to `soft-warn` in BOTH modes: that tier is `peaks skill
 * presence`'s — the every-turn probe, which reads this same table and mode
 * resolver — so `context-now` has no auto-fire tier of its own (SKILL.md
 * "two probes, two thresholds"). Reporting it as `auto-compact-now` would
 * change every non-24h session's output, which slice H4 forbids.
 */
export function contextNowActionFor(
  ratio: number,
  mode: AutoCompactMode
): {
  action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line';
  next: string | null;
} {
  const kind = evaluateCompactTrigger(ratio, mode).kind;
  if (kind === 'red-line') return { action: 'red-line', next: COMPACT_CMD };
  if (kind === 'pre-compact') return { action: 'auto-compact-now', next: COMPACT_CMD };
  return { action: kind === 'none' ? 'ok' : 'soft-warn', next: null };
}

/** Slice H4: the labels `context-now` prints, read out of the table for the mode
 *  in force — the old hard-coded "≥0.85 / ≥0.95 / 50–85%" told a 24h operator
 *  the wrong lines. `*Ratio` is the `0.85` form `gateModeNotice` uses. */
export function contextNowBandLabels(mode: AutoCompactMode): {
  softWarn: string;
  preCompact: string;
  redLine: string;
  preCompactRatio: string;
  redLineRatio: string;
} {
  const pct = (r: number): string => `${(r * 100).toFixed(0)}`;
  const pre = thresholdFor(mode, 'preCompact');
  const red = thresholdFor(mode, 'redLine');
  return {
    softWarn: pct(AUTO_COMPACT_SOFT_WARN_RATIO),
    preCompact: pct(pre),
    redLine: pct(red),
    preCompactRatio: pre.toFixed(2),
    redLineRatio: red.toFixed(2)
  };
}
