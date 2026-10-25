/**
 * `src/services/observability/results-baseline-rows.ts`
 *
 * WHY THIS MODULE EXISTS. The published rows and the old-vs-new metric
 * comparison are the two parts of the results baseline that decide what a
 * reader is shown, and both are big enough to push the computation module
 * over the repository's 300 raw-line file-size cap.
 *
 * THE RULE THE ROWS OBEY. Every published row is a RATE or a PEAK. A raw
 * count that grows with the number of slices ever recorded is a population
 * descriptor, not a baseline row — those live in their own block of the
 * artifact, and a reader must never mistake one for the other.
 *
 * THE RULE THE COMPARISON OBEY. Version 1 of the repair-cycle metric counted
 * qa-role slice-transition events — QA's own internal state transitions,
 * doubled by the duplicate emission — and was never a repair-cycle count.
 * Version 2 counts repair cycles. The two are recorded side by side so the
 * historical numbers are read as a DIFFERENT MEASUREMENT, not as a
 * regression.
 */

import type { RepairCycleReport, StatusAggregate } from './aggregation-types.js';
import type { BaselineRow, ResultsBaseline } from './results-baseline.js';

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/** Decimal base of the rounding helper. */
const DECIMAL_BASE = 10;

/** How many decimal places a published rate carries. */
const RATE_DIGITS = 6;

function round(value: number, digits: number): number {
  const factor = DECIMAL_BASE ** digits;
  return Math.round(value * factor) / factor;
}

/** How many slices hold each value — the measured distribution of one metric. */
function distributionOf(values: readonly number[]): Record<string, number> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const key of [...counts.keys()].sort((a, b) => a - b)) {
    out[String(key)] = counts.get(key) ?? 0;
  }
  return out;
}

/**
 * The published rows. Every one of them is a RATE or a PEAK: a raw count that
 * grows with the number of slices ever recorded is a population descriptor,
 * not a baseline row.
 */
export function baselineRows(
  status: StatusAggregate,
  cycles: RepairCycleReport,
  slices: number
): BaselineRow[] {
  return [
    {
      id: 'repair-cycle-cap-hit-rate',
      kind: 'rate',
      value: round(ratio(cycles.capHitCount, slices), RATE_DIGITS),
      unit: 'slices at or over the cap / slices',
      description: 'Share of slices at or over the RD/QA repair cap. Version 2 metric.'
    },
    {
      id: 'repair-cycle-peak',
      kind: 'peak',
      value: status.repairCyclePeak,
      unit: 'repair cycles in one slice',
      description: 'Highest repair-cycle count held by a single slice. Version 2 metric.'
    },
    {
      id: 'qa-round-peak',
      kind: 'peak',
      value: cycles.qaRounds.peak,
      unit: 'QA phases in one slice',
      description: 'Highest number of QA phases in one slice. A QA phase is NOT a repair cycle.'
    },
    {
      id: 'slice-success-rate',
      kind: 'rate',
      value: round(ratio(status.successCount, slices), RATE_DIGITS),
      unit: 'successful slices / slices',
      description: 'Share of slices whose final state is a terminal happy state.'
    },
    {
      id: 'slice-failure-rate',
      kind: 'rate',
      value: round(ratio(status.failCount, slices), RATE_DIGITS),
      unit: 'failed slices / slices',
      description: 'Share of slices whose final state is blocked.'
    },
    {
      id: 'fanout-cost-per-slice',
      kind: 'mean',
      value: round(ratio(status.fanoutCostTotal, slices), RATE_DIGITS),
      unit: 'dispatch events / slice',
      description: 'Mean sub-agent dispatch cost per slice.'
    }
  ];
}

/**
 * The old-vs-new comparison, recorded so a reader sees that the historical
 * numbers were a DIFFERENT MEASUREMENT and not a regression.
 */
export function metricComparison(
  cycles: RepairCycleReport,
  slices: number
): ResultsBaseline['metricComparison'] {
  const legacyValues = cycles.legacyQaEventCount.perSlice.map((row) => row.eventCount);
  const cycleValues = cycles.perSlice.map((row) => row.cycleCount);
  return {
    note:
      "Version 1 counted qa-role slice-transition events (QA's own internal state transitions, " +
      'doubled by the duplicate emission) and was never a repair-cycle count. Version 2 counts ' +
      'repair cycles. The historical numbers below are a different measurement, not a regression — ' +
      'do not compare a v1 number with a v2 number.',
    v1QaEventCount: {
      metric: cycles.legacyQaEventCount.metric,
      metricVersion: cycles.legacyQaEventCount.metricVersion,
      total: cycles.legacyQaEventCount.total,
      peak: cycles.legacyQaEventCount.peak,
      slicesMeasured: slices,
      slicesAtOrOverCap: cycles.legacyQaEventCount.capHitCount,
      distribution: distributionOf(legacyValues)
    },
    v2RepairCycles: {
      metric: cycles.metric,
      metricVersion: cycles.metricVersion,
      total: cycles.totalCycles,
      peak: cycles.perSlice.reduce((peak, row) => Math.max(peak, row.cycleCount), 0),
      slicesMeasured: slices,
      slicesAtOrOverCap: cycles.capHitCount,
      distribution: distributionOf(cycleValues)
    }
  };
}
