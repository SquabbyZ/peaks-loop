// tests/unit/services/observability/results-baseline.test.ts
//
// WHY THIS FILE EXISTS. The results layer had no baseline, and the one
// constraint that shapes what a baseline can be here is that the DATA IS NOT
// IN GIT: observability events live in the gitignored
// `.peaks/_runtime/<sessionId>/metrics/slices.jsonl`, so a CI runner has
// nothing to compare against and the tracked artifact CANNOT be a CI gate.
// These tests pin three things a reader must be able to rely on: the
// published rows are rates and peaks (never raw counts that grow with the
// number of slices ever recorded), the artifact says in machine-readable form
// that it is not CI-enforceable, and the old-vs-new metric comparison is
// recorded so the historical numbers are not mistaken for a regression.
//
// Dimensions:
//   - behavior:    which rows are published and what the comparison records
//   - render:      the artifact's serialized shape
//   - integration: the tracked artifact on disk — write, read back, compare
//   - a11y:        the human-facing statements about CI enforceability

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ObservabilityEvent } from '~/src/services/observability/observability-service.js';
import {
  computeResultsBaseline,
  type ResultsBaseline
} from '~/src/services/observability/results-baseline.js';
import {
  compareResultsBaseline,
  readTrackedResultsBaseline,
  writeResultsBaseline
} from '~/src/services/observability/results-baseline-artifact.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/observability/results-baseline.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-01-01-session-baseline';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function event(
  sliceRid: string,
  index: number,
  detail: Record<string, unknown>
): ObservabilityEvent {
  return {
    schemaVersion: 1,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    sessionId: SESSION_ID,
    category: 'slice-transition',
    sliceRid,
    detail
  };
}

/**
 * A project with two recorded slices:
 *   - `slice-no-rework` never returns to an RD work state after QA, so the
 *     CORRECTED metric scores it 0 while the LEGACY counter sees four
 *     qa-role events and would alarm on it;
 *   - `slice-one-rework` really does come back to `spec-locked` once, so the
 *     corrected metric scores it 1.
 */
function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-results-baseline-'));
  roots.push(root);
  const noRework: ObservabilityEvent[] = [
    event('slice-no-rework', 0, { to: 'implemented', artifactRole: 'rd' }),
    event('slice-no-rework', 1, { to: 'qa-handoff', artifactRole: 'rd' }),
    event('slice-no-rework', 2, { to: 'running', artifactRole: 'qa' }),
    event('slice-no-rework', 3, { to: 'verdict-issued', artifactRole: 'qa' }),
    event('slice-no-rework', 4, { to: 'qa-handoff', artifactRole: 'rd' }),
    event('slice-no-rework', 5, { to: 'running', artifactRole: 'qa' }),
    event('slice-no-rework', 6, { to: 'verdict-issued', artifactRole: 'qa' }),
    event('slice-no-rework', 7, { to: 'handed-off', artifactRole: 'rd' })
  ];
  const oneRework: ObservabilityEvent[] = [
    event('slice-one-rework', 8, { to: 'spec-locked', artifactRole: 'rd' }),
    event('slice-one-rework', 9, { to: 'implemented', artifactRole: 'rd' }),
    event('slice-one-rework', 10, { to: 'qa-handoff', artifactRole: 'rd' }),
    event('slice-one-rework', 11, { to: 'running', artifactRole: 'qa' }),
    event('slice-one-rework', 12, { to: 'verdict-issued', artifactRole: 'qa' }),
    event('slice-one-rework', 13, { to: 'spec-locked', artifactRole: 'rd' }),
    event('slice-one-rework', 14, { to: 'implemented', artifactRole: 'rd' }),
    event('slice-one-rework', 15, { to: 'qa-handoff', artifactRole: 'rd' }),
    event('slice-one-rework', 16, { to: 'handed-off', artifactRole: 'rd' })
  ];
  const dispatch: ObservabilityEvent[] = [
    {
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 17)).toISOString(),
      sessionId: SESSION_ID,
      category: 'dispatch',
      role: 'rd',
      detail: { status: 'done' }
    }
  ];
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'metrics');
  mkdirSync(dir, { recursive: true });
  const lines = [...noRework, ...oneRework, ...dispatch]
    .map((record) => JSON.stringify(record))
    .join('\n');
  writeFileSync(join(dir, 'slices.jsonl'), `${lines}\n`, 'utf8');
  return root;
}

describe('behavior — the published baseline rows', () => {
  it('should publish only rates and peaks when the baseline rows are read', () => {
    // given: a project with recorded session data
    // when:  the baseline is computed
    // then:  every row is a rate, a peak or a mean — never a growing raw count
    const baseline = computeResultsBaseline(seedProject());
    expect(baseline.baselineRows.length).toBeGreaterThan(0);
    for (const row of baseline.baselineRows) {
      expect(['rate', 'peak', 'mean']).toContain(row.kind);
    }
    expect(baseline.baselineRows.map((row) => row.id)).not.toContain('totalSlices');
  });

  it('should record the old-versus-new comparison when the metric versions are compared', () => {
    // given: a project whose legacy count alarms and whose corrected count does not
    // when:  the baseline is computed
    // then:  both conventions are recorded side by side
    const baseline = computeResultsBaseline(seedProject());
    expect(baseline.metricVersion).toBe(2);
    expect(baseline.metricComparison.v1QaEventCount.metricVersion).toBe(1);
    expect(baseline.metricComparison.v1QaEventCount.slicesAtOrOverCap).toBe(1);
    expect(baseline.metricComparison.v2RepairCycles.slicesAtOrOverCap).toBe(0);
    expect(baseline.metricComparison.v2RepairCycles.total).toBe(1);
  });

  it('should state the drift tolerance when the tolerance block is read', () => {
    // given: a project with recorded session data
    // when:  the baseline is computed
    // then:  every row kind has an explicit, positive tolerance
    const baseline = computeResultsBaseline(seedProject());
    expect(baseline.tolerance.rate).toBeGreaterThan(0);
    expect(baseline.tolerance.peak).toBeGreaterThan(0);
    expect(baseline.tolerance.mean).toBeGreaterThan(0);
    expect(baseline.tolerance.note).toContain('--check');
  });
});

describe('render — the tracked artifact shape', () => {
  it('should keep the not-CI-enforceable marker when the artifact is serialized', () => {
    // given: a computed baseline
    // when:  the artifact is written and read back as JSON
    // then:  the marker, the rows and the population survive the round trip
    const root = seedProject();
    const baseline = computeResultsBaseline(root);
    const raw = JSON.parse(
      readFileSync(writeResultsBaseline(root, baseline), 'utf8')
    ) as ResultsBaseline;
    expect(raw.ciEnforceable).toBe(false);
    expect(raw.baselineRows.length).toBe(baseline.baselineRows.length);
    expect(raw.population.sliceCount).toBe(2);
    expect(raw.population.sessionIds).toEqual([SESSION_ID]);
  });
});

describe('integration — the tracked artifact on disk', () => {
  it('should report no drift when the tracked artifact is compared with a fresh computation', () => {
    // given: a tracked artifact written from the same data
    // when:  the fresh computation is compared with the tracked artifact
    // then:  there is nothing to report
    const root = seedProject();
    const baseline = computeResultsBaseline(root);
    writeResultsBaseline(root, baseline);
    const tracked = readTrackedResultsBaseline(root);
    if (tracked === null) throw new Error('tracked baseline was not written');
    expect(compareResultsBaseline(baseline, tracked)).toEqual([]);
  });

  it('should report drift when a tracked row moves past the documented tolerance', () => {
    // given: a tracked artifact whose cap-hit rate is far from the computed one
    // when:  the fresh computation is compared with the tracked artifact
    // then:  the moved row is named and marked as a value drift
    const root = seedProject();
    const baseline = computeResultsBaseline(root);
    writeResultsBaseline(root, {
      ...baseline,
      baselineRows: baseline.baselineRows.map((row) =>
        row.id === 'repair-cycle-cap-hit-rate' ? { ...row, value: 0.9 } : row
      )
    });
    const tracked = readTrackedResultsBaseline(root);
    if (tracked === null) throw new Error('tracked baseline was not written');
    const drifts = compareResultsBaseline(baseline, tracked);
    expect(drifts.map((drift) => drift.rowId)).toContain('repair-cycle-cap-hit-rate');
    expect(drifts[0]?.kind).toBe('value-drift');
  });

  it('should report a missing row when the tracked artifact drops a baseline row', () => {
    // given: a tracked artifact that lost one of its rows
    // when:  the fresh computation is compared with the tracked artifact
    // then:  the missing row is named
    const root = seedProject();
    const baseline = computeResultsBaseline(root);
    writeResultsBaseline(root, {
      ...baseline,
      baselineRows: baseline.baselineRows.filter((row) => row.id !== 'qa-round-peak')
    });
    const tracked = readTrackedResultsBaseline(root);
    if (tracked === null) throw new Error('tracked baseline was not written');
    const drifts = compareResultsBaseline(baseline, tracked);
    expect(drifts.map((drift) => drift.rowId)).toContain('qa-round-peak');
    expect(drifts[0]?.kind).toBe('row-missing');
  });
});

describe('a11y — what a reader of the artifact is told', () => {
  it('should say that the baseline is not CI-enforceable when a reader opens the artifact', () => {
    // given: a computed baseline
    // when:  the reason is read
    // then:  it says it is not a gate and names the gitignored source data
    const baseline = computeResultsBaseline(seedProject());
    expect(baseline.ciEnforceableReason).toContain('NOT CI-ENFORCEABLE');
    expect(baseline.ciEnforceableReason).toContain('gitignored');
  });

  it('should label the population descriptors as not-baseline-rows when a reader hunts for a gate', () => {
    // given: a computed baseline
    // when:  the descriptor note is read
    // then:  it says the raw counts must never be gated on
    const baseline = computeResultsBaseline(seedProject());
    expect(baseline.populationDescriptors.note).toContain('NOT baseline rows');
  });
});
