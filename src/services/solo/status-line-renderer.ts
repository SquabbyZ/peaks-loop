/**
 * G6.5 — status line renderer for the peaks-code batch-sync wait period.
 *
 * Single line, 80-120 chars, status-line-friendly. The shape is
 * documented in PRD §G6.5:
 *
 *   [peaks-code] swarm 3/3 running | rd-planning 45% (12s ago) | qa-test-cases 30% (5s ago) | ui-design 20% (2s ago)
 *   [peaks-code] swarm 3/3 running | rd-planning 70% (8s ago) | qa-test-cases 50% (3s ago) | ui-design 30% (6s ago)
 *   ...
 *   [peaks-code] swarm 3/3 done in 47.3s
 *
 * Pure helper; the poller calls it once per tick. No IO.
 */
import type { DispatchRecord } from '../dispatch/dispatch-record-writer.js';

export type SubAgentLiveView = {
  readonly role: string;
  readonly status: string;
  readonly progress: number | null;
  readonly lastBeatAgoSec: number | null;
  readonly isStale: boolean;
};

export type SwarmSummary = {
  readonly total: number;
  readonly running: number;
  readonly done: number;
  readonly failed: number;
  readonly stale: number;
};

const STALE_THRESHOLD_SEC = 5 * 60;

/** Build a per-sub-agent view of the current state of one record. */
export function viewSubAgent(record: DispatchRecord, now: () => Date = () => new Date()): SubAgentLiveView {
  const latest = record.heartbeats[record.heartbeats.length - 1];
  const lastBeatAgo = record.lastBeatAt
    ? Math.max(0, Math.floor((now().getTime() - new Date(record.lastBeatAt).getTime()) / 1000))
    : null;
  const isStale = lastBeatAgo !== null && lastBeatAgo > STALE_THRESHOLD_SEC;
  return {
    role: record.role,
    status: record.status,
    progress: latest ? latest.progress : null,
    lastBeatAgoSec: lastBeatAgo,
    isStale
  };
}

/** Aggregate swarm summary. */
export function summarize(records: readonly DispatchRecord[]): SwarmSummary {
  let running = 0;
  let done = 0;
  let failed = 0;
  let stale = 0;
  for (const r of records) {
    const v = viewSubAgent(r);
    if (v.isStale) stale += 1;
    if (r.status === 'done') done += 1;
    else if (r.status === 'failed' || r.status === 'cancelled') failed += 1;
    else running += 1;
  }
  return { total: records.length, running, done, failed, stale };
}

/** Render a single status line. */
export function renderStatusLine(prefix: string, records: readonly DispatchRecord[], now: () => Date = () => new Date()): string {
  if (records.length === 0) {
    return `${prefix} swarm 0/0 idle`;
  }
  const summary = summarize(records);
  const allDone = summary.done === summary.total;
  if (allDone) {
    return `${prefix} swarm ${summary.done}/${summary.total} done`;
  }
  const parts = records.map((r) => renderOne(r, now));
  return `${prefix} swarm ${summary.running}/${summary.total} running | ${parts.join(' | ')}`;
}

function renderOne(record: DispatchRecord, now: () => Date): string {
  const view = viewSubAgent(record, now);
  const pct = view.progress !== null ? `${view.progress}%` : '?%';
  const ago = view.lastBeatAgoSec !== null ? `${view.lastBeatAgoSec}s ago` : 'no beat';
  const stale = view.isStale ? ' ⚠ stale' : '';
  return `${view.role} ${pct} (${ago})${stale}`;
}
