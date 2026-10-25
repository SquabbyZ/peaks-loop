/**
 * `src/services/observability/results-baseline-artifact.ts`
 *
 * WHY THIS MODULE EXISTS — the tracked artifact and the comparison against it
 * are separated from the computation, so the question "what does the baseline
 * say?" and the question "what does the machine measure right now?" can be
 * answered by different modules.
 *
 * The tracked artifact lives at `.peaks/observability/results-baseline.json`.
 * It is NOT CI-enforceable: its source data is gitignored session state
 * (`.peaks/_runtime/<sessionId>/metrics/slices.jsonl`), so a CI runner has
 * nothing to compare against. This module never wires the artifact into a
 * gate; it only reads it, writes it, and reports drift against it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  type BaselineDrift,
  type BaselineRowKind,
  type BaselineTolerance,
  type ResultsBaseline
} from './results-baseline.js';

/** Absolute path of the tracked artifact for a project root. */
export function resultsBaselinePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'observability', 'results-baseline.json');
}

/** The tracked artifact, or null when this project has none yet. */
export function readTrackedResultsBaseline(projectRoot: string): ResultsBaseline | null {
  const path = resultsBaselinePath(projectRoot);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as ResultsBaseline;
}

/** Regenerate the tracked artifact and return the path it was written to. */
export function writeResultsBaseline(projectRoot: string, baseline: ResultsBaseline): string {
  const path = resultsBaselinePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return path;
}

/** The tolerance that applies to a row kind, read from the tracked artifact. */
export function toleranceFor(tolerance: BaselineTolerance, kind: BaselineRowKind): number {
  return tolerance[kind];
}

/**
 * Compare a freshly computed baseline with the tracked one. A missing row or
 * a metric-version mismatch is drift; so is a value that moved further than
 * the tolerance its kind allows.
 */
export function compareResultsBaseline(
  computed: ResultsBaseline,
  tracked: ResultsBaseline
): BaselineDrift[] {
  const drifts: BaselineDrift[] = [];
  if (computed.metricVersion !== tracked.metricVersion) {
    drifts.push({
      rowId: 'metric-version',
      kind: 'metric-version-mismatch',
      tracked: tracked.metricVersion,
      computed: computed.metricVersion,
      tolerance: null
    });
  }
  const trackedRows = new Map(tracked.baselineRows.map((row) => [row.id, row]));
  for (const row of computed.baselineRows) {
    const prior = trackedRows.get(row.id);
    if (prior === undefined) {
      drifts.push({
        rowId: row.id,
        kind: 'row-missing',
        tracked: null,
        computed: row.value,
        tolerance: null
      });
      continue;
    }
    const tolerance = toleranceFor(tracked.tolerance, row.kind);
    if (Math.abs(row.value - prior.value) > tolerance) {
      drifts.push({
        rowId: row.id,
        kind: 'value-drift',
        tracked: prior.value,
        computed: row.value,
        tolerance
      });
    }
  }
  return drifts;
}
