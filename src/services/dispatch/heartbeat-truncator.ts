/**
 * G6.4 / RL-16 — heartbeat truncation helper.
 *
 * Each dispatch record keeps an append-only `heartbeats[]` array so
 * reducers / auditors can reconstruct what the sub-agent did. Without
 * a cap, a long-running sub-agent can blow the record JSON past 1 MB
 * (a 30s cadence over a 1-hour run = 120 entries * ~120 bytes = ~14 KB;
 * a 5s cadence over 24h = 17 000 entries * ~120 bytes = ~2 MB). The
 * 100-entry cap is LLM-friendly: stale heartbeats are not informative
 * once the poller has read them, so dropping the oldest ones is a
 * non-event.
 *
 * Pure helper; no IO. The writer in `dispatch-record-writer.ts` calls
 * this on every `appendHeartbeat`. Exposed as a separate module so
 * tests can pin the contract.
 */
import type { Heartbeat } from './dispatch-record-writer.js';

export const HEARTBEAT_TRUNCATE_LIMIT = 100;

export interface TruncationResult {
  readonly heartbeats: readonly Heartbeat[];
  readonly truncated: boolean;
  /** The number of entries dropped by this truncation. */
  readonly dropped: number;
}

/** Apply the 100-entry cap. Returns the most recent N entries + a flag. */
export function truncateHeartbeats(entries: readonly Heartbeat[]): TruncationResult {
  if (entries.length <= HEARTBEAT_TRUNCATE_LIMIT) {
    return { heartbeats: [...entries], truncated: false, dropped: 0 };
  }
  const start = entries.length - HEARTBEAT_TRUNCATE_LIMIT;
  return {
    heartbeats: entries.slice(start),
    truncated: true,
    dropped: start
  };
}
