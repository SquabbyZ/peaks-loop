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
  // Slice 2026-07-29-dispatch-stall-governance / S2 (AC-2.3) — split
  // "no beat ever seen" (never-started) from "heartbeat seen, then
  // quiet" (stale). The watch surface renders these as two distinct
  // buckets so an orchestrator can tell a sub-agent that never picked
  // up the work apart from one that has gone quiet after starting.
  readonly isNeverStarted: boolean;
  // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1 / AC-5.2)
  // — the record's stage label, when the dispatcher / sub-agent
  // supplied one. `null` for records that did not (or could not) emit
  // a stage; the watch surface renders it as `(stage: <label>)` so a
  // long-`running` agent is legible.
  readonly stage: string | null;
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
  // Slice 2026-07-29-dispatch-stall-governance / S2 (AC-2.3) — never-
  // started: no heartbeat ever landed (lastBeatAgo is null AND the
  // record has not been promoted by a startup-timeout marker).
  const isNeverStarted = lastBeatAgo === null && record.status === 'queued';
  return {
    role: record.role,
    status: record.status,
    progress: latest ? latest.progress : null,
    lastBeatAgoSec: lastBeatAgo,
    isStale,
    isNeverStarted,
    // S5 — surface the optional stage label so a long-running agent is
    // legible. Reads from the record's `stage` field (added in the
    // same slice); undefined on legacy records degrades to null.
    stage: typeof (record as DispatchRecord & { stage?: string | null }).stage === 'string'
      ? ((record as DispatchRecord & { stage?: string | null }).stage ?? null)
      : null
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
  // Slice 2026-07-29-dispatch-stall-governance / S2 (AC-2.3) — render
  // never-started distinctly from stale so the orchestrator's eye can
  // tell a sub-agent that never picked up the work apart from one that
  // has gone quiet after starting.
  const marker = view.isNeverStarted ? ' ⚠ never-started' : view.isStale ? ' ⚠ stale' : '';
  // S5 (AC-5.2) — surface the optional stage label inline so a long-
  // `running` agent is legible. Empty stage is omitted silently.
  const stageSuffix = view.stage && view.stage.length > 0 ? ` [${view.stage}]` : '';
  return `${view.role} ${pct} (${ago})${marker}${stageSuffix}`;
}