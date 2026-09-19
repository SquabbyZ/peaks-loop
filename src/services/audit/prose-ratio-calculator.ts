/**
 * Prose-only ratio calculator — Slice C Group G3 (v2.14.0),
 * corrected in S3 of the 2026-09-15 diagnosis-remediation job.
 *
 * An entry counts as prose-only when `backing === 'prose-only'`.
 * Full stop. There is no second condition.
 *
 * The pre-S3 version also required `informational !== true`, on the
 * reasoning that auto-discovered advisory SKILL.md phrases are "not
 * actionable red lines". Whatever the merits of that reading, the effect
 * was to move 44 of 152 rows — 29% of the catalog — out of the
 * denominator, so the gate reported `proseOnly: 0` while the same JSON
 * carried 44 rows with `"backing": "prose-only"`. A metric whose
 * denominator can be redefined by the code it measures is not a metric.
 *
 * `informational` survives as a triage label — `discoveredProseOnly`
 * below counts those rows — but it no longer moves any number that the
 * ratio is computed from. Expect the ratio to look much worse than it
 * did; that is this correction working.
 *
 * Karpathy §2 simplicity: one exported function plus a thin calculator
 * interface; no I/O.
 */

import type { RedLineEntry } from './types.js';

export interface ProseRatioResult {
  /** Total entries considered (entries.length) — the denominator, always. */
  readonly totalRedLines: number;
  /** Count of entries with backing === 'cli-backed'. */
  readonly cliBacked: number;
  /** Count of entries with backing === 'partial'. */
  readonly partial: number;
  /** Count of entries with backing === 'prose-only'. THE numerator. */
  readonly proseOnly: number;
  /**
   * Breakdown only — the subset of `proseOnly` that carries
   * `informational: true` (auto-discovered advisory phrases with no
   * catalog template). Included in `proseOnly`; changing it changes
   * nothing about `proseOnly` or `ratio`.
   */
  readonly discoveredProseOnly: number;
  /** Count of entries with informational === true, whatever their backing. */
  readonly informational: number;
  /** proseOnly / totalRedLines. Returns 0 when totalRedLines === 0. */
  readonly ratio: number;
  /** Target threshold (default 0.05 per A3.1). */
  readonly target: number;
  /** True when ratio > target. */
  readonly exceeds: boolean;
}

export interface ProseRatioOptions {
  /** Target threshold (default 0.05). */
  readonly target?: number;
}

/** Default target: 5% (per A3.1). */
export const DEFAULT_PROSE_RATIO_TARGET = 0.05;

export function computeProseRatio(
  entries: readonly RedLineEntry[],
  options: ProseRatioOptions = {}
): ProseRatioResult {
  const target = options.target ?? DEFAULT_PROSE_RATIO_TARGET;
  let cliBacked = 0;
  let partial = 0;
  let proseOnly = 0;
  let discoveredProseOnly = 0;
  let informational = 0;

  for (const entry of entries) {
    if (entry.informational === true) informational += 1;
    if (entry.backing === 'cli-backed') cliBacked += 1;
    else if (entry.backing === 'partial') partial += 1;
    else if (entry.backing === 'prose-only') {
      proseOnly += 1;
      if (entry.informational === true) discoveredProseOnly += 1;
    }
  }

  const totalRedLines = entries.length;
  const ratio = totalRedLines === 0 ? 0 : proseOnly / totalRedLines;
  return {
    totalRedLines,
    cliBacked,
    partial,
    proseOnly,
    discoveredProseOnly,
    informational,
    ratio,
    target,
    exceeds: ratio > target
  };
}
