import type { ChildStatus } from './types.js';
import { isJsonObject } from './guards/json-object.js';

export interface HeartbeatEntry {
  progress: number;
  note: string;
  ts: number;
}
export interface AutoCompactEvent {
  at: number;
  threshold: '0.85' | '0.95';
  tokensBefore: number;
  tokensAfter: number;
  scratchFile?: string;
}

/**
 * A status record as it comes off disk: an OPEN JSON object.
 *
 * WHY NOT `heartbeats?: HeartbeatEntry[]` — the honest reason, because the two
 * look equivalent and are not. The record arrives from `JSON.parse`, which
 * hands back `any`; nothing between the disk and this class has checked that
 * `heartbeats` is an array, or that its elements are heartbeat entries. Writing
 * `heartbeats?: HeartbeatEntry[]` on the interface would therefore be a CLAIM
 * about a shape nobody verified — the same offence as `as`, only harder to
 * see, because it reads as a type rather than a cast.
 *
 * So the record is declared as what it really is (an object with unknown
 * values) and the two arrays this class appends to are READ through
 * `readHeartbeats` / `readCompactEvents`, which check and drop. That is why
 * those readers return the concrete types below rather than the field being
 * declared pre-typed.
 */
export interface StatusRecord {
  [key: string]: unknown;
}

/** What `merge` returns: the record it was given, plus the fields it wrote. */
export type MergedStatusRecord = StatusRecord & {
  heartbeats: HeartbeatEntry[];
  /** Written only when the 100-entry cap actually fired (see `merge`). */
  heartbeatsTruncated?: boolean;
  status: string;
};

/** What `appendCompactEvent` returns: the record, plus the event it appended. */
export type CompactedStatusRecord = StatusRecord & {
  autoCompactEvents: AutoCompactEvent[];
};

function isHeartbeatEntry(value: unknown): value is HeartbeatEntry {
  return (
    isJsonObject(value) &&
    typeof value['progress'] === 'number' &&
    typeof value['note'] === 'string' &&
    typeof value['ts'] === 'number'
  );
}

function isCompactEvent(value: unknown): value is AutoCompactEvent {
  return (
    isJsonObject(value) &&
    typeof value['at'] === 'number' &&
    (value['threshold'] === '0.85' || value['threshold'] === '0.95') &&
    typeof value['tokensBefore'] === 'number' &&
    typeof value['tokensAfter'] === 'number' &&
    (value['scratchFile'] === undefined || typeof value['scratchFile'] === 'string')
  );
}

/**
 * The heartbeat entries carried by `rec`, in order, with anything that is not a
 * heartbeat entry dropped. `rec.heartbeats` being absent, a non-array, or an
 * array of junk all read as "no heartbeats yet" — the same outcome the old
 * `rec.heartbeats ?? []` produced for the absent case, extended to the cases it
 * silently spread into a malformed array.
 */
function readHeartbeats(rec: StatusRecord): HeartbeatEntry[] {
  const raw = rec['heartbeats'];
  if (!Array.isArray(raw)) return [];
  const out: HeartbeatEntry[] = [];
  for (const item of raw) {
    if (isHeartbeatEntry(item)) out.push(item);
  }
  return out;
}

/** The compact events carried by `rec`. Same contract as `readHeartbeats`. */
function readCompactEvents(rec: StatusRecord): AutoCompactEvent[] {
  const raw = rec['autoCompactEvents'];
  if (!Array.isArray(raw)) return [];
  const out: AutoCompactEvent[] = [];
  for (const item of raw) {
    if (isCompactEvent(item)) out.push(item);
  }
  return out;
}

export class StatusProtocol {
  /**
   * Append one heartbeat and refresh `status`. Every other key the record
   * carried is preserved; `heartbeats` is capped at the last 100 and
   * `heartbeatsTruncated` is written only when that cap fired.
   */
  merge(rec: StatusRecord, s: ChildStatus): MergedStatusRecord {
    const appended = [...readHeartbeats(rec), { progress: s.progress, note: s.note, ts: s.ts }];
    const truncated = appended.length > 100;
    return {
      ...rec,
      heartbeats: truncated ? appended.slice(-100) : appended,
      ...(truncated ? { heartbeatsTruncated: true } : {}),
      status: s.state === 'running' ? 'running' : s.state
    };
  }
  isStale(lastBeatAt: number, thresholdSec = 300): boolean {
    return Date.now() - lastBeatAt > thresholdSec * 1000;
  }
  /** Append one compact event, preserving every other key on the record. */
  appendCompactEvent(rec: StatusRecord, ev: AutoCompactEvent): CompactedStatusRecord {
    return { ...rec, autoCompactEvents: [...readCompactEvents(rec), ev] };
  }
}
