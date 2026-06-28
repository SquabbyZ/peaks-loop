/**
 * Prose-only ratio calculator — Slice C Group G3 (v2.14.0).
 *
 * Computes the prose-only ratio for a set of red-line entries. Per
 * spec §10.2 + the v2.12.1 reform (`.peaks/memory/2026-06-27-
 * prose-only-catalog-followup.md`), an entry counts as prose-only
 * only when BOTH:
 *   1. `backing === 'prose-only'`
 *   2. `informational !== true`
 *
 * The 80 discovered advisory SKILL.md phrases (auto-marked
 * `informational=true` by `classifier.ts:141`) are excluded from
 * the ratio so the gate (≤ 5% per slice C AC A3.1) reflects the
 * actionable backlog.
 *
 * Karpathy §2 simplicity: one exported function plus a thin
 * calculator interface; no I/O. The pure form makes the ≥8
 * test cases in prose-ratio-calculator.test.ts trivial.
 */

import type { RedLineEntry } from './types.js';

export interface ProseRatioResult {
  /** Total catalog size (entries.length). */
  readonly totalRedLines: number;
  /** Count of entries with backing === 'cli-backed'. */
  readonly cliBacked: number;
  /** Count of entries with backing === 'partial'. */
  readonly partial: number;
  /** Count of entries with backing === 'prose-only' AND informational !== true. */
  readonly proseOnly: number;
  /** Count of entries with informational === true (excluded from ratio). */
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
  options: ProseRatioOptions = {},
): ProseRatioResult {
  const target = options.target ?? DEFAULT_PROSE_RATIO_TARGET;
  let cliBacked = 0;
  let partial = 0;
  let proseOnly = 0;
  let informational = 0;

  for (const entry of entries) {
    if (entry.informational === true) {
      informational += 1;
      continue;
    }
    if (entry.backing === 'cli-backed') cliBacked += 1;
    else if (entry.backing === 'partial') partial += 1;
    else if (entry.backing === 'prose-only') proseOnly += 1;
  }

  const totalRedLines = entries.length;
  const ratio = totalRedLines === 0 ? 0 : proseOnly / totalRedLines;
  return {
    totalRedLines,
    cliBacked,
    partial,
    proseOnly,
    informational,
    ratio,
    target,
    exceeds: ratio > target,
  };
}
