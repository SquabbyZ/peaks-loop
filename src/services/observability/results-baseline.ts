/**
 * `src/services/observability/results-baseline.ts`
 *
 * WHY THIS MODULE EXISTS — the results layer had no baseline at all, and the
 * constraint that shapes what a baseline can be here is that the DATA IS NOT
 * IN GIT.
 *
 * Observability data lives at `.peaks/_runtime/<sessionId>/metrics/slices.jsonl`
 * and every such path is gitignored (verified with `git check-ignore`). A CI
 * runner has no session data, therefore a results-layer baseline CANNOT be a
 * CI gate. Pretending otherwise would produce a green CI job that checks
 * nothing, so the tracked artifact says in machine-readable form that it is
 * not CI-enforceable and why, and this module never wires itself into CI.
 *
 * What it IS: a tracked artifact (`.peaks/observability/results-baseline.json`)
 * that records the current results-layer numbers as RATES and PEAKS — never
 * as raw counts that grow with the number of slices ever recorded — is
 * regenerable on demand (`peaks observability baseline --write`) and can be
 * compared during a local run or a slice review (`--check`).
 *
 * The artifact also carries the old-vs-new comparison of the repair-cycle
 * metric, because the historical numbers were a DIFFERENT MEASUREMENT and not
 * a regression: version 1 counted qa-role transition events, version 2 counts
 * repair cycles.
 */

import { aggregateRepairCycles, aggregateStatus, readAllSessionEvents } from './aggregation.js';
import { listSessionDirsWithMetrics } from './jsonl-store.js';
import { REPAIR_CYCLE_METRIC_VERSION } from './repair-cycle-metric.js';
import { baselineRows, metricComparison } from './results-baseline-rows.js';

/** The tracked artifact's path, relative to the project root. */
export const RESULTS_BASELINE_RELATIVE_PATH = '.peaks/observability/results-baseline.json';

export const RESULTS_BASELINE_SCHEMA_VERSION = 1;

/**
 * Machine-readable statement that this artifact is NOT a CI gate, and why.
 * A reader who finds the file must not assume a CI job enforces it.
 */
export const CI_ENFORCEABLE_REASON =
  'NOT CI-ENFORCEABLE. The source data lives in .peaks/_runtime/<sessionId>/metrics/slices.jsonl, ' +
  'and every such path is gitignored — a CI runner has no session data, so there is nothing there to ' +
  'compare against. This file is a local review artifact: regenerate it with ' +
  '`peaks observability baseline --write` on a machine that has session data and compare it with ' +
  '`peaks observability baseline --check` during a local run or a slice review.';

/**
 * The drift `--check` tolerates per row kind. Absolute, not relative: the
 * baseline rows are rates and peaks, and a relative band on a rate that is
 * near zero would be meaningless.
 */
export const RESULTS_BASELINE_TOLERANCE = {
  rate: 0.02,
  peak: 1,
  mean: 0.5
} as const;

export type BaselineRowKind = 'rate' | 'peak' | 'mean';

export type BaselineRow = {
  id: string;
  kind: BaselineRowKind;
  value: number;
  unit: string;
  description: string;
};

export type BaselineTolerance = {
  rate: number;
  peak: number;
  mean: number;
  note: string;
};

export type BaselinePopulation = {
  scope: string;
  sessionIds: string[];
  sessionCount: number;
  sliceCount: number;
  sliceTransitionEventCount: number;
  measuredAt: string;
};

export type MetricComparisonSide = {
  metric: string;
  metricVersion: number;
  total: number;
  peak: number;
  slicesMeasured: number;
  slicesAtOrOverCap: number;
  distribution: Record<string, number>;
};

export type ResultsBaseline = {
  schemaVersion: number;
  metricVersion: number;
  generatedAt: string;
  ciEnforceable: false;
  ciEnforceableReason: string;
  tolerance: BaselineTolerance;
  baselineRows: BaselineRow[];
  population: BaselinePopulation;
  populationDescriptors: {
    note: string;
    totalSlices: number;
    totalSliceTransitionEvents: number;
    totalRepairCycles: number;
    totalQaRounds: number;
    totalLegacyQaEvents: number;
  };
  metricComparison: {
    note: string;
    v1QaEventCount: MetricComparisonSide;
    v2RepairCycles: MetricComparisonSide;
  };
};

export type BaselineDrift = {
  rowId: string;
  kind: 'row-missing' | 'value-drift' | 'metric-version-mismatch';
  tracked: number | null;
  computed: number | null;
  tolerance: number | null;
};

/**
 * Compute the baseline over the WHOLE recorded history of a project. This is
 * the population the tracked artifact describes; a session-scoped run would
 * measure a different population and could not be compared with it.
 */
export function computeResultsBaseline(projectRoot: string): ResultsBaseline {
  const events = readAllSessionEvents(projectRoot);
  const status = aggregateStatus(events);
  const cycles = aggregateRepairCycles(events);
  const sessionIds = listSessionDirsWithMetrics(projectRoot).map((entry) => entry.sessionId);
  const sliceTransitionEventCount = events.filter(
    (event) => event.category === 'slice-transition'
  ).length;
  const slices = status.totalSlices;
  const generatedAt = new Date().toISOString();

  return {
    schemaVersion: RESULTS_BASELINE_SCHEMA_VERSION,
    metricVersion: REPAIR_CYCLE_METRIC_VERSION,
    generatedAt,
    ciEnforceable: false,
    ciEnforceableReason: CI_ENFORCEABLE_REASON,
    tolerance: {
      ...RESULTS_BASELINE_TOLERANCE,
      note:
        'Absolute drift allowed per row kind when `peaks observability baseline --check` compares ' +
        'the tracked artifact with the freshly computed baseline.'
    },
    baselineRows: baselineRows(status, cycles, slices),
    population: {
      scope: 'all-sessions',
      sessionIds,
      sessionCount: sessionIds.length,
      sliceCount: slices,
      sliceTransitionEventCount,
      measuredAt: generatedAt
    },
    populationDescriptors: {
      note:
        'Population descriptors, NOT baseline rows: these grow with the number of slices ever ' +
        'recorded and must never be gated on. The baseline rows above are rates and peaks.',
      totalSlices: slices,
      totalSliceTransitionEvents: sliceTransitionEventCount,
      totalRepairCycles: cycles.totalCycles,
      totalQaRounds: cycles.qaRounds.total,
      totalLegacyQaEvents: cycles.legacyQaEventCount.total
    },
    metricComparison: metricComparison(cycles, slices)
  };
}

/**
 * `src/services/observability/results-baseline-artifact.ts` holds the
 * tracked artifact's on-disk side: reading it, writing it, and reporting
 * drift against a freshly computed baseline.
 */
