/**
 * Type-guard helpers for the dispatch-record upgrade path.
 * C wave 1 / slice c1 (leaf c1w1-record-upgrade): extracted verbatim from
 * `dispatch-record-upgrade.ts` so the reader module clears the line cap.
 * Behavior is byte-identical to the previous in-file definitions; the
 * `isDispatchStatus` / `isOutcome` re-export from the upgrade module keeps
 * every existing importer (e.g. `dispatch-record-writer.ts`) resolving them
 * at the original path.
 */
import type {
  DispatchOutcome,
  DispatchRecordStatus,
  Heartbeat,
  HeartbeatStatus
} from './dispatch-record-types.js';

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new Error(`Dispatch record field '${key}' must be a string (got ${typeof v})`);
  }
  return v;
}

export function isValidHeartbeat(v: unknown): v is Heartbeat {
  if (!isObject(v)) return false;
  return (
    typeof v.at === 'string' &&
    isHeartbeatStatus(v.status) &&
    typeof v.progress === 'number' &&
    (v.note === null || typeof v.note === 'string')
  );
}

function isHeartbeatStatus(v: unknown): v is HeartbeatStatus {
  return (
    v === 'queued' ||
    v === 'running' ||
    v === 'finalizing' ||
    v === 'done' ||
    v === 'failed' ||
    v === 'stale' ||
    // S1 terminal members so a sub-agent can report `cancelled`,
    // `no-execution`, `never-started`, or `unreadable` through the
    // heartbeat CLI.
    v === 'cancelled' ||
    v === 'no-execution' ||
    v === 'never-started' ||
    v === 'unreadable'
  );
}

export function isDispatchStatus(v: unknown): v is DispatchRecordStatus {
  return (
    v === 'queued' ||
    v === 'running' ||
    v === 'finalizing' ||
    v === 'done' ||
    v === 'failed' ||
    v === 'cancelled' ||
    v === 'no-execution' ||
    v === 'stale' ||
    // new terminal members from the startup-timeout service.
    v === 'never-started' ||
    v === 'unreadable'
  );
}

export function isOutcome(v: unknown): v is DispatchOutcome {
  return (
    v === 'success' ||
    v === 'failed' ||
    v === 'timeout' ||
    v === 'cancelled' ||
    v === 'no-execution'
  );
}
