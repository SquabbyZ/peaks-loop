/**
 * Markdown report formatter for slice topology observability.
 *
 * from `aggregation.ts`, outputs are stable markdown strings suitable
 * for pasting into PR descriptions or `.peaks/PROJECT.md` timeline
 * entries. The CLI subcommand `peaks observability report` wires
 * the file read + aggregation + format pipeline.
 *
 *   - Header: scope, period, generated-at timestamp, and any warning the
 *     scope or the period raised — the warning travels IN the body, because
 *     the body is what gets pasted and the stderr line is what gets lost
 *   - Near-miss section: rate | denominator | coverage | flagged slices
 *   - Slice table: rid | transitions | final state | duration | outcome
 *   - Hotspots table: artifact | owner | mode | confidence | count
 *   - Fanout table: role | count
 *   - Repair-cycle table: sliceRid | cycleCount
 *   - Top-N slowest slices: rid | duration | transitions | final state,
 *     sorted by duration desc
 */

import {
  REPAIR_CYCLE_METRIC_VERSION,
  sliceOutcome,
  type FanoutBreakdown,
  type Period,
  type RepairCycleReport,
  type SliceOutcome,
  type SliceRollup,
  type StatusAggregate
} from './aggregation.js';
import type { HotspotRow } from './hotspot-shared.js';
import type { NearMissReport } from './near-miss.js';
import { markdownHotspotTables } from './report-formatter-hotspots.js';
import { markdownNearMissSection } from './report-formatter-near-miss.js';

export type ReportInput = {
  scope: 'session' | 'all-sessions';
  scopeId: string;
  period: Period;
  generatedAt: string;
  status: StatusAggregate;
  slices: SliceRollup[];
  fanout: FanoutBreakdown;
  repairCycles: RepairCycleReport;
  /**
   * The warnings the scope or the period raised, rendered in the header.
   *
   * They are the reader's answer to "why is this table empty?" — a report
   * scoped to one session, or narrowed to a period that holds no events,
   * would otherwise show an empty table with no explanation. Printed to
   * stderr they are lost the moment the report is pasted somewhere else, so
   * the body carries them.
   */
  warnings?: readonly string[];
  /**
   * The near-miss measurement, rendered when it is supplied.
   *
   * It is OPTIONAL, and absent means the section is not rendered at all — a
   * caller that does not compute the measurement gets exactly the report it
   * got before the section existed.
   *
   * THE SECTION NEVER PRINTS A BARE RATE. A rate over a reason class the
   * scope had no events for is an absence of data, not a result, so the
   * section carries the per-class coverage beside the number: which classes
   * were observable, which were not, and that the unobserved ones are not
   * measured. The section lives in `report-formatter-near-miss.ts` — this
   * file was near its cap — and the reasoning is explained there.
   */
  nearMiss?: NearMissReport;
  /**
   * The hotspot ranking, rendered when it is supplied.
   *
   * It is OPTIONAL, and absent means the section is not rendered at all — a
   * caller that does not compute the ranking gets exactly the report it got
   * before the ranking existed.
   *
   * THE SHAPE IS SET HERE, THE WIRING IS TASK 7's. The count column is
   * named for what it counts — "times observed missing" and "candidate
   * mentions" — so a reader cannot take a candidate mention for a missing
   * artifact. The CLI command that supplies the ranking is Task 7's to
   * wire; this file states the contract it will fill.
   */
  hotspots?: readonly HotspotRow[];
};

const SLOWEST_TOP_N = 5;

function pad(value: string | number, width: number): string {
  const str = String(value);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms === 0) return '0';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function markdownHeader(input: ReportInput): string {
  const lines: string[] = [];
  lines.push('# peaks observability report');
  lines.push('');
  lines.push(
    `- **scope**: ${input.scope === 'all-sessions' ? 'all sessions' : `session \`${input.scopeId}\``}`
  );
  lines.push(`- **period**: ${input.period}`);
  lines.push(`- **generated at**: ${input.generatedAt}`);
  lines.push(`- **scope marker**: from v2.11.1 install date (no backfill per PRD Q5)`);
  const warnings = input.warnings ?? [];
  if (warnings.length > 0) {
    lines.push('');
    for (const warning of warnings) lines.push(`> **warning**: ${warning}`);
  }
  lines.push('');
  return lines.join('\n');
}

function markdownStatusSummary(status: StatusAggregate): string {
  const lines: string[] = [];
  lines.push('## Status summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| total events | ${status.totalEvents} |`);
  lines.push(`| total slices | ${status.totalSlices} |`);
  lines.push(`| success count | ${status.successCount} |`);
  lines.push(`| fail count | ${status.failCount} |`);
  lines.push(`| stalled count | ${status.stalledCount} |`);
  lines.push(
    `| repair-cycle peak (v${REPAIR_CYCLE_METRIC_VERSION} metric) | ${status.repairCyclePeak} |`
  );
  lines.push(`| fanout cost total | ${status.fanoutCostTotal} |`);
  lines.push('');
  return lines.join('\n');
}

/**
 * The marker each outcome is drawn with in the slice table.
 *
 * A stalled slice is NOT a failure: it advanced partway and stopped, and
 * drawing it `✗` is what put the "8 failures" into a report whose own summary
 * counted 0 — the two halves of one report disagreeing about the same slices.
 * `…` says "did not finish" and leaves the failure marker for the slices that
 * really were blocked.
 */
const OUTCOME_MARKERS: Record<SliceOutcome, string> = {
  success: '✓',
  failed: '✗',
  stalled: '…'
};

function markdownSliceTable(slices: SliceRollup[]): string {
  const lines: string[] = [];
  lines.push('## Slices');
  lines.push('');
  if (slices.length === 0) {
    lines.push('_No slice transitions recorded for this period._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| rid | transitions | final state | duration | outcome |');
  lines.push('|---|---|---|---|---|');
  for (const slice of slices) {
    lines.push(
      `| ${slice.sliceRid} | ${slice.transitions} | ${slice.finalState ?? '—'} | ${formatDurationMs(slice.durationMs)} | ${OUTCOME_MARKERS[sliceOutcome(slice)]} |`
    );
  }
  lines.push('');
  lines.push('_✓ succeeded · ✗ failed · … did not finish (stalled)_');
  lines.push('');
  return lines.join('\n');
}

/**
 * The hotspot section: the rows, split by what their count actually counts.
 *
 * The section lives in `report-formatter-hotspots.ts` — this file was near
 * its cap — and the split of the tables is explained there.
 */
function markdownFanoutTable(fanout: FanoutBreakdown): string {
  const lines: string[] = [];
  lines.push('## Fanout');
  lines.push('');
  if (fanout.total === 0) {
    lines.push('_No sub-agent dispatches recorded for this period._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| role | count |');
  lines.push('|---|---|');
  for (const [role, count] of Object.entries(fanout.perRole)) {
    if (count > 0) {
      lines.push(`| ${role} | ${count} |`);
    }
  }
  lines.push(`| **total** | **${fanout.total}** |`);
  lines.push('');
  return lines.join('\n');
}

function markdownRepairCycleTable(repairCycles: RepairCycleReport): string {
  const lines: string[] = [];
  lines.push('## Repair cycles');
  lines.push('');
  // The version marker and the definition travel with the numbers: a reader
  // must not be able to see a v2 cap-hit count next to a v1 count without the
  // report saying that the two are different measurements.
  lines.push(`- **metric**: \`${repairCycles.metric}\` (version ${repairCycles.metricVersion})`);
  lines.push(`- **definition**: ${repairCycles.definition}`);
  lines.push('');
  if (repairCycles.perSlice.length === 0) {
    lines.push('_No slice transitions recorded for this period._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| slice rid | repair cycles |');
  lines.push('|---|---|');
  for (const row of repairCycles.perSlice) {
    lines.push(`| ${row.sliceRid} | ${row.cycleCount} |`);
  }
  lines.push('');
  lines.push(
    `- **total repair cycles (v${repairCycles.metricVersion})**: ${repairCycles.totalCycles}`
  );
  lines.push(`- **cap**: ${repairCycles.cap}`);
  lines.push(`- **cap hit**: ${repairCycles.capHit ? 'yes' : 'no'}`);
  lines.push(`- **slices at cap (v${repairCycles.metricVersion})**: ${repairCycles.capHitCount}`);
  lines.push(
    `- **QA rounds (a separate metric — a QA phase, NOT a repair cycle)**: total ${repairCycles.qaRounds.total}, peak ${repairCycles.qaRounds.peak}`
  );
  const legacy = repairCycles.legacyQaEventCount;
  lines.push(
    `- **legacy v${legacy.metricVersion} \`${legacy.metric}\` (NOT a repair-cycle count)**: total ${legacy.total}, peak ${legacy.peak}, slices at cap ${legacy.capHitCount}`
  );
  lines.push(`- **legacy note**: ${legacy.note}`);
  lines.push('');
  return lines.join('\n');
}

function markdownSlowestSlices(slices: SliceRollup[]): string {
  const lines: string[] = [];
  lines.push(`## Top-${SLOWEST_TOP_N} slowest slices`);
  lines.push('');
  const sorted = [...slices]
    .filter((s) => s.durationMs !== null && s.durationMs > 0)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, SLOWEST_TOP_N);
  if (sorted.length === 0) {
    lines.push('_No slice durations available._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| rid | duration | transitions | final state |');
  lines.push('|---|---|---|---|');
  for (const slice of sorted) {
    lines.push(
      `| ${slice.sliceRid} | ${formatDurationMs(slice.durationMs)} | ${slice.transitions} | ${slice.finalState ?? '—'} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the full markdown report. Pure function — no IO. The CLI
 * layer reads events, calls aggregations, and passes the result here.
 */
export function renderObservabilityReport(input: ReportInput): string {
  const sections: string[] = [markdownHeader(input), markdownStatusSummary(input.status)];
  // The near-miss section is rendered ONLY when the measurement is supplied,
  // so a caller that does not compute it gets exactly the report it got
  // before. It sits between the summary and the slice table: the summary
  // says what the slices did, the near-misses say what was skipped.
  if (input.nearMiss !== undefined) sections.push(markdownNearMissSection(input.nearMiss));
  sections.push(markdownSliceTable(input.slices));
  // The hotspot section is rendered ONLY when the ranking is supplied, so a
  // caller that does not compute it gets exactly the report it got before.
  if (input.hotspots !== undefined) sections.push(markdownHotspotTables(input.hotspots));
  sections.push(
    markdownFanoutTable(input.fanout),
    markdownRepairCycleTable(input.repairCycles),
    markdownSlowestSlices(input.slices)
  );
  return sections.join('\n').trimEnd() + '\n';
}

export const REPORT_FORMAT_CONSTANTS = {
  SLOWEST_TOP_N
} as const;

// Surface `pad` for snapshot-test stability assertions; exported only
// to keep the formatter module self-contained for snapshot diffing.
export const __reportTestHelpers = { pad, formatDurationMs };
