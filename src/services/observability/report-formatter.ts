/**
 * Markdown report formatter for slice topology observability.
 *
 * Slice D of v2.11.1 (AC-5). Pure functions: inputs are aggregations
 * from `aggregation.ts`, outputs are stable markdown strings suitable
 * for pasting into PR descriptions or `.peaks/PROJECT.md` timeline
 * entries. The CLI subcommand `peaks observability report` wires
 * the file read + aggregation + format pipeline.
 *
 * Format contract (per PRD AC-5):
 *   - Header: scope, period, generated-at timestamp
 *   - Slice table: rid | transitions | finalState | durationMs | success
 *   - Fanout table: role | count
 *   - Repair-cycle table: sliceRid | cycleCount
 *   - Top-N slowest slices: same as slice table, sorted by durationMs desc
 */

import type {
  FanoutBreakdown,
  Period,
  RepairCycleReport,
  SliceRollup,
  StatusAggregate
} from './aggregation.js';

export type ReportInput = {
  scope: 'session' | 'all-sessions';
  scopeId: string;
  period: Period;
  generatedAt: string;
  status: StatusAggregate;
  slices: SliceRollup[];
  fanout: FanoutBreakdown;
  repairCycles: RepairCycleReport;
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
  lines.push(`- **scope**: ${input.scope === 'all-sessions' ? 'all sessions' : `session \`${input.scopeId}\``}`);
  lines.push(`- **period**: ${input.period}`);
  lines.push(`- **generated at**: ${input.generatedAt}`);
  lines.push(`- **scope marker**: from v2.11.1 install date (no backfill per PRD Q5)`);
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
  lines.push(`| repair-cycle peak | ${status.repairCyclePeak} |`);
  lines.push(`| fanout cost total | ${status.fanoutCostTotal} |`);
  lines.push('');
  return lines.join('\n');
}

function markdownSliceTable(slices: SliceRollup[]): string {
  const lines: string[] = [];
  lines.push('## Slices');
  lines.push('');
  if (slices.length === 0) {
    lines.push('_No slice transitions recorded for this period._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| rid | transitions | final state | duration | success |');
  lines.push('|---|---|---|---|---|');
  for (const slice of slices) {
    lines.push(`| ${slice.sliceRid} | ${slice.transitions} | ${slice.finalState ?? '—'} | ${formatDurationMs(slice.durationMs)} | ${slice.success ? '✓' : '✗'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

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
  if (repairCycles.perSlice.length === 0) {
    lines.push('_No repair cycles recorded for this period._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| slice rid | cycle count |');
  lines.push('|---|---|');
  for (const row of repairCycles.perSlice) {
    lines.push(`| ${row.sliceRid} | ${row.cycleCount} |`);
  }
  lines.push('');
  lines.push(`- **cap**: ${repairCycles.cap}`);
  lines.push(`- **cap hit**: ${repairCycles.capHit ? 'yes' : 'no'}`);
  lines.push(`- **slices at cap**: ${repairCycles.capHitCount}`);
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
    lines.push(`| ${slice.sliceRid} | ${formatDurationMs(slice.durationMs)} | ${slice.transitions} | ${slice.finalState ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the full markdown report. Pure function — no IO. The CLI
 * layer reads events, calls aggregations, and passes the result here.
 */
export function renderObservabilityReport(input: ReportInput): string {
  const sections: string[] = [
    markdownHeader(input),
    markdownStatusSummary(input.status),
    markdownSliceTable(input.slices),
    markdownFanoutTable(input.fanout),
    markdownRepairCycleTable(input.repairCycles),
    markdownSlowestSlices(input.slices)
  ];
  return sections.join('\n').trimEnd() + '\n';
}

export const REPORT_FORMAT_CONSTANTS = {
  SLOWEST_TOP_N
} as const;

// Surface `pad` for snapshot-test stability assertions; exported only
// to keep the formatter module self-contained for snapshot diffing.
export const __reportTestHelpers = { pad, formatDurationMs };