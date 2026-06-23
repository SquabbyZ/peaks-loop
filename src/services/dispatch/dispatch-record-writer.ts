/**
 * Dispatch record writer — slice 2026-06-07-sub-agent-dispatch-decouple (G2 + G5 + G6).
 *
 * Owns the on-disk format of `.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json`:
 *   - G2: atomic write helper (mkdirSync recursive + tmp + rename) and
 *     R-2 guard (path must live under `.peaks/_sub_agents/<sid>/`).
 *   - G5: lifecycle schema (`createdAt` / `completedAt` / `outcome` /
 *     `artifactPaths` / `disposed` / `disposedAt`) per AC-26 + RL-6..RL-9.
 *   - G6: heartbeat schema upgrade per AC-33/AC-34 — `heartbeats[]` +
 *     `lastBeatAt` + `status` aggregate. Read-side backward compat
 *     supplies defaults for old records missing the G6 fields.
 *
 * The write helpers are intentionally small and pure:
 *   - `writeInitialDispatchRecord`: append a new dispatch record at the
 *     start of a sub-agent dispatch (called by `peaks sub-agent dispatch`).
 *   - `appendHeartbeat`: append one heartbeat to an existing record
 *     (called by `peaks sub-agent heartbeat`).
 *   - `markCompleted` / `markFailed` / `markCancelled` / `markNoExecution`:
 *     lifecycle transitions called by the reducer.
 *
 * All writes are atomic (tmp + rename) so a process crash mid-write
 * cannot leave a half-truncated JSON file. All reads tolerate missing
 * G6 fields (backward compat) and the G5 schema fields default to
 * `null` / `false` / `'no-execution'` if the file was written by an
 * older peaks build.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SubAgentToolCall } from './sub-agent-dispatcher.js';
import { assertSafeDispatchRecordPath, dispatchRecordPath } from '../security/safe-settings-path.js';
import { withFileLockSync } from '../filesystem/file-lock.js';

/** G6.3 Heartbeat entry — single update written by a running sub-agent. */
export interface Heartbeat {
  readonly at: string;
  readonly status: HeartbeatStatus;
  readonly progress: number;
  readonly note: string | null;
}

export type HeartbeatStatus =
  | 'queued'
  | 'running'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'stale';

export type DispatchRecordStatus =
  | 'queued'
  | 'running'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'no-execution'
  | 'stale';

export type DispatchOutcome =
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'no-execution';

/** G2+G5+G6 dispatch record schema (AC-26 + AC-34). */
export interface DispatchRecord {
  readonly version: 2;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly outcome: DispatchOutcome;
  readonly artifactPaths: readonly string[];
  readonly disposed: boolean;
  readonly disposedAt: string | null;
  readonly role: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly toolCall: SubAgentToolCall;
  /** G5 batch id (AC-27) — uuid-like opaque token grouping one batch. */
  readonly batchId: string;
  /** G6 fields (AC-34) — backward compat: defaults on read. */
  readonly heartbeats: readonly Heartbeat[];
  readonly lastBeatAt: string | null;
  readonly status: DispatchRecordStatus;
}

/** Input for the initial write. */
export type WriteInitialDispatchInput = {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  role: string;
  prompt: string;
  toolCall: SubAgentToolCall;
  batchId: string;
  /** Override the timestamp (testing). */
  now?: () => Date;
};

/** Heartbeat write input. */
export type AppendHeartbeatInput = {
  recordPath: string;
  status: HeartbeatStatus;
  progress: number;
  note?: string;
  now?: () => Date;
};

/** Lifecycle transition input. */
export type LifecycleInput = {
  recordPath: string;
  outcome: DispatchOutcome;
  status: DispatchRecordStatus;
  artifactPaths?: readonly string[];
  now?: () => Date;
};

const MAX_PROMPT_BYTES = 256 * 1024;

/** Write a new dispatch record (G2 + G5 + G6). Returns the absolute path. */
export function writeInitialDispatchRecord(input: WriteInitialDispatchInput): {
  path: string;
  record: DispatchRecord;
} {
  const { projectRoot, sessionId, requestId, role, prompt, toolCall, batchId } = input;
  const now = input.now ?? (() => new Date());
  if (prompt.length > MAX_PROMPT_BYTES) {
    const err = new Error(
      `prompt exceeds ${MAX_PROMPT_BYTES} bytes (got ${prompt.length}); ` +
      `truncate or split into multiple dispatches`
    ) as Error & { code: string };
    err.code = 'PROMPT_TOO_LARGE';
    throw err;
  }

  const path = dispatchRecordPath(projectRoot, sessionId, requestId, now());
  const safePath = assertSafeDispatchRecordPath(path, projectRoot);

  const record: DispatchRecord = {
    version: 2,
    createdAt: now().toISOString(),
    completedAt: null,
    outcome: 'no-execution',
    artifactPaths: [],
    disposed: false,
    disposedAt: null,
    role,
    requestId,
    sessionId,
    prompt,
    toolCall,
    batchId,
    heartbeats: [],
    lastBeatAt: null,
    status: 'queued'
  };

  writeAtomic(safePath, record);
  return { path: safePath, record };
}

/** Append a heartbeat (G6). Idempotent on (at, status) — append-only. */
export function appendHeartbeat(input: AppendHeartbeatInput): { record: DispatchRecord; truncated: boolean } {
  const { recordPath, status, progress, note } = input;
  const now = input.now ?? (() => new Date());
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    const err = new Error(`progress must be integer 0..100 (got ${progress})`) as Error & { code: string };
    err.code = 'INVALID_PROGRESS';
    throw err;
  }
  if (note !== undefined && note.length > 200) {
    const err = new Error(`note must be ≤ 200 chars (got ${note.length})`) as Error & { code: string };
    err.code = 'NOTE_TOO_LONG';
    throw err;
  }

  const existing = readRecord(recordPath);
  const entry: Heartbeat = {
    at: now().toISOString(),
    status,
    progress,
    note: note ?? null
  };

  const { heartbeats, truncated } = applyTruncation([...existing.heartbeats, entry]);
  const next: DispatchRecord = {
    ...existing,
    heartbeats,
    lastBeatAt: entry.at,
    status: mapStatusToAggregate(status, existing.status)
  };
  // Slice 2026-06-23-audit-3rd #3: wrap the read-then-write in a file
  // lock. Without the lock, a heartbeat arriving 100ms before
  // markCompleted can be silently discarded — the parent's view of the
  // sub-agent shows "completed" but the last progress update is lost.
  return withFileLockSync(recordPath, () => {
    // Re-read under the lock — the file may have been mutated between
    // our pre-lock `readRecord` above and lock acquisition (heartbeats
    // and markCompleted share the same record file).
    const lockedExisting = readRecord(recordPath);
    const lockedHeartbeats = applyTruncation([
      ...lockedExisting.heartbeats,
      entry
    ]).heartbeats;
    const lockedNext: DispatchRecord = {
      ...lockedExisting,
      heartbeats: lockedHeartbeats,
      lastBeatAt: entry.at,
      status: mapStatusToAggregate(status, lockedExisting.status)
    };
    writeAtomic(recordPath, lockedNext);
    // Recompute truncated flag from the locked-read result so the
    // caller sees the actual post-lock truncation state.
    return {
      record: lockedNext,
      truncated: lockedHeartbeats.length < lockedExisting.heartbeats.length + 1
    };
  });
}

/** Apply truncation: keep most recent 100, mark truncated flag. */
export function applyTruncation(entries: readonly Heartbeat[]): { heartbeats: Heartbeat[]; truncated: boolean } {
  if (entries.length <= 100) {
    return { heartbeats: [...entries], truncated: false };
  }
  return { heartbeats: entries.slice(-100), truncated: true };
}

function mapStatusToAggregate(latest: HeartbeatStatus, current: DispatchRecordStatus): DispatchRecordStatus {
  // 'stale' is a poller-driven warning and must not be overwritten by
  // a normal heartbeat that arrives after the stale flag was set.
  if (current === 'stale') {
    return 'stale';
  }
  return latest;
}

/** Mark a record as completed (success / failed / cancelled / no-execution). */
export function markCompleted(input: LifecycleInput): { record: DispatchRecord } {
  // Slice 2026-06-23-audit-3rd #3: lock + re-read so a concurrent
  // heartbeat arriving just before markCompleted is preserved in the
  // final record.
  return withFileLockSync(input.recordPath, () => {
    const existing = readRecord(input.recordPath);
    const next: DispatchRecord = {
      ...existing,
      completedAt: (input.now ?? (() => new Date()))().toISOString(),
      outcome: input.outcome,
      status: input.status,
      artifactPaths: input.artifactPaths ?? existing.artifactPaths
    };
    writeAtomic(input.recordPath, next);
    return { record: next };
  });
}

/** Mark a record as disposed (reducer ran). */
export function markDisposed(recordPath: string, now: () => Date = () => new Date()): { record: DispatchRecord } {
  // Lock + re-read (see markCompleted).
  return withFileLockSync(recordPath, () => {
    const existing = readRecord(recordPath);
    const next: DispatchRecord = {
      ...existing,
      disposed: true,
      disposedAt: now().toISOString()
    };
    writeAtomic(recordPath, next);
    return { record: next };
  });
}

/**
 * Read a dispatch record with backward-compat defaults. Old records
 * missing G5 / G6 fields are upgraded on read (no error, no overwrite).
 */
export function readRecord(recordPath: string): DispatchRecord {
  if (!existsSync(recordPath)) {
    const err = new Error(`Dispatch record not found: ${recordPath}`) as Error & { code: string; path: string };
    err.code = 'RECORD_NOT_FOUND';
    (err as unknown as { path: string }).path = recordPath;
    throw err;
  }
  const raw = readFileSync(recordPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const err = new Error(`Invalid dispatch record JSON: ${(error as Error).message}`) as Error & { code: string };
    err.code = 'INVALID_RECORD_JSON';
    throw err;
  }
  return upgradeRecord(parsed);
}

/** Read multiple records from a list of paths. Tolerates missing files. */
export function readRecords(paths: readonly string[]): DispatchRecord[] {
  const out: DispatchRecord[] = [];
  for (const p of paths) {
    try {
      out.push(readRecord(p));
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'RECORD_NOT_FOUND') {
        continue;
      }
      throw error;
    }
  }
  return out;
}

function upgradeRecord(parsed: unknown): DispatchRecord {
  if (!isObject(parsed)) {
    throw new Error('Dispatch record root must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const role = stringField(obj, 'role');
  const requestId = stringField(obj, 'requestId');
  const sessionId = stringField(obj, 'sessionId');
  const prompt = stringField(obj, 'prompt');
  const toolCall = obj.toolCall as SubAgentToolCall;
  if (!isObject(toolCall) || typeof toolCall.name !== 'string') {
    throw new Error('Dispatch record toolCall must be { name, args }');
  }
  const createdAt = stringField(obj, 'createdAt');
  const heartbeats = Array.isArray(obj.heartbeats)
    ? (obj.heartbeats.filter(isValidHeartbeat) as Heartbeat[])
    : [];
  const lastBeatAt = typeof obj.lastBeatAt === 'string' ? obj.lastBeatAt : null;
  const status = isDispatchStatus(obj.status) ? obj.status : 'no-execution';
  const completedAt = typeof obj.completedAt === 'string' ? obj.completedAt : null;
  const outcome: DispatchOutcome = isOutcome(obj.outcome) ? obj.outcome : 'no-execution';
  const artifactPaths = Array.isArray(obj.artifactPaths)
    ? obj.artifactPaths.filter((p): p is string => typeof p === 'string')
    : [];
  const disposed = obj.disposed === true;
  const disposedAt = typeof obj.disposedAt === 'string' ? obj.disposedAt : null;
  const batchId = typeof obj.batchId === 'string' && obj.batchId.length > 0
    ? obj.batchId
    : 'legacy-batch';

  return {
    version: 2,
    createdAt,
    completedAt,
    outcome,
    artifactPaths,
    disposed,
    disposedAt,
    role,
    requestId,
    sessionId,
    prompt,
    toolCall,
    batchId,
    heartbeats,
    lastBeatAt,
    status
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new Error(`Dispatch record field '${key}' must be a string (got ${typeof v})`);
  }
  return v;
}

function isValidHeartbeat(v: unknown): v is Heartbeat {
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
    v === 'queued' || v === 'running' || v === 'finalizing' ||
    v === 'done' || v === 'failed' || v === 'stale'
  );
}

function isDispatchStatus(v: unknown): v is DispatchRecordStatus {
  return (
    v === 'queued' || v === 'running' || v === 'finalizing' ||
    v === 'done' || v === 'failed' || v === 'cancelled' ||
    v === 'no-execution' || v === 'stale'
  );
}

function isOutcome(v: unknown): v is DispatchOutcome {
  return (
    v === 'success' || v === 'failed' || v === 'timeout' ||
    v === 'cancelled' || v === 'no-execution'
  );
}

export { isDispatchStatus, isOutcome };

function writeAtomic(path: string, record: DispatchRecord): void {
  const dir = dirname(path);
  // Slice 2026-06-23-audit-3rd #11: skip mkdirSync when the dir already
  // exists (every heartbeat + every dispatch read-modify-write).
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const safeTmp = resolve(dir, tmp.split(/[\\/]/).pop() as string);
  writeFileSync(safeTmp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  renameSync(safeTmp, path);
}
