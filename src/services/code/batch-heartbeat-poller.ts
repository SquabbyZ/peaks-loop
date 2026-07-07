/**
 * G6 — in-process batch heartbeat poller.
 *
 * The Dispatcher (peaks-code main loop) starts one poller per batch.
 * The poller ticks every 10 s, reads `heartbeats[]` + `lastBeatAt` from
 * each record in the batch, and emits:
 *
 *   - a `dispatcherStatus` envelope to the renderer's `onStatus` callback
 *     (which formats the single-line status per G6.5)
 *   - a `stale` envelope to `onStale` if a record crosses the 5-min
 *     threshold (G6.2 / AC-35)
 *
 * The poller does **not**:
 *   - cancel, kill, or send SIGTERM to a sub-agent (RL-15)
 *   - modify `outcome` (only the aggregate `status` is flipped to 'stale')
 *   - block the LLM call (it is fire-and-forget; the parent batch-sync
 *     wait is governed by the LLM platform, not by this poller)
 *
 * The poller stops when:
 *   - the parent calls `stop()` (batch finished)
 *   - all records are terminal (`done` / `failed` / `cancelled` / `no-execution`)
 *
 * Pure JS event loop — no native deps, no IPC. Designed to be replaced
 * by a real OS-level watcher in a future slice without changing the
 * callback contract.
 */
import type { DispatchRecord, HeartbeatStatus } from '../dispatch/dispatch-record-writer.js';
import { readRecords } from '../dispatch/dispatch-record-writer.js';
import { renderStatusLine, summarize, viewSubAgent, type SubAgentLiveView } from './status-line-renderer.js';

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export type PollRecord = {
  readonly path: string;
  readonly role: string;
};

export type PollerStatusEvent = {
  readonly kind: 'status';
  readonly line: string;
  readonly summary: ReturnType<typeof summarize>;
  readonly views: readonly SubAgentLiveView[];
};

export type PollerStaleEvent = {
  readonly kind: 'stale';
  readonly path: string;
  readonly role: string;
  readonly lastBeatAgoSec: number;
  readonly thresholdSec: number;
};

export type PollerDoneEvent = {
  readonly kind: 'done';
  readonly summary: ReturnType<typeof summarize>;
};

export type PollerEvent = PollerStatusEvent | PollerStaleEvent | PollerDoneEvent;

export type PollerHandlers = {
  onStatus?: (event: PollerStatusEvent) => void;
  onStale?: (event: PollerStaleEvent) => void;
  onDone?: (event: PollerDoneEvent) => void;
  onError?: (error: unknown) => void;
};

export type PollerOptions = {
  prefix: string;
  intervalMs?: number;
  staleThresholdMs?: number;
  now?: () => Date;
};

const TERMINAL_STATUSES: readonly HeartbeatStatus[] = ['done', 'failed'];
const TERMINAL_RECORD_STATUSES: readonly DispatchRecord['status'][] = [
  'done',
  'failed',
  'cancelled',
  'no-execution'
];

export class BatchHeartbeatPoller {
  private timer: NodeJS.Timeout | null = null;
  private prevStale: Set<string> = new Set();
  private prevSummaryDone = 0;
  private running = false;

  constructor(
    private readonly records: readonly PollRecord[],
    private readonly handlers: PollerHandlers,
    private readonly options: PollerOptions
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
    const interval = this.options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timer = setInterval(() => this.tick(), interval);
    // Don't keep the process alive just for the poller.
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force a tick (testing seam + low-level access for explicit invocation). */
  tick(): void {
    let recs: DispatchRecord[];
    try {
      recs = readRecords(this.records.map((r) => r.path));
    } catch (error: unknown) {
      this.handlers.onError?.(error);
      return;
    }
    const now = this.options.now ?? (() => new Date());
    const summary = summarize(recs);
    const views = recs.map((r) => viewSubAgent(r, now));
    const line = renderStatusLine(this.options.prefix, recs, now);
    this.handlers.onStatus?.({ kind: 'status', line, summary, views });

    const staleThresholdSec = Math.floor(
      (this.options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS) / 1000
    );
    for (const rec of recs) {
      const v = viewSubAgent(rec, now);
      if (v.isStale) {
        const key = `${rec.role}::${rec.requestId}`;
        if (!this.prevStale.has(key)) {
          this.prevStale.add(key);
          this.handlers.onStale?.({
            kind: 'stale',
            path: this.records.find((p) => p.role === rec.role)?.path ?? '',
            role: rec.role,
            lastBeatAgoSec: v.lastBeatAgoSec ?? -1,
            thresholdSec: staleThresholdSec
          });
        }
      }
    }

    if (summary.total > 0 && summary.done === summary.total && this.prevSummaryDone !== summary.done) {
      this.prevSummaryDone = summary.done;
      this.handlers.onDone?.({ kind: 'done', summary });
      this.stop();
    } else if (
      recs.length > 0 &&
      recs.every((r) => TERMINAL_RECORD_STATUSES.includes(r.status) || TERMINAL_STATUSES.includes(r.status as HeartbeatStatus))
    ) {
      this.handlers.onDone?.({ kind: 'done', summary });
      this.stop();
    } else {
      this.prevSummaryDone = summary.done;
    }
  }
}
