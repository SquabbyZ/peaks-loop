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
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
  /**
   * Slice 2026-06-23-audit-4th #A4: trusted project root. Required
   * so the active-dispatches index can be updated without deriving
   * the root from the recordPath (the same anti-pattern that
   * audit-3rd #1 fixed for heartbeat). The CLI / LLM-side runner
   * passes this from `--project` or `process.cwd()`.
   */
  projectRoot?: string;
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
    // Slice 2026-06-23-audit-4th #C2: propagate toolCallVersion.
    // The dispatcher's buildToolCall already stamps it (claude-code 2.0.0
    // etc.); we re-default to '2.0.0' if absent so the on-disk record
    // is self-describing without reading the dispatcher source.
    toolCall: { ...toolCall, toolCallVersion: toolCall.toolCallVersion ?? '2.0.0' },
    batchId,
    heartbeats: [],
    lastBeatAt: null,
    status: 'queued'
  };

  writeAtomic(safePath, record);
  // Slice 2026-06-23-audit-4th #A4: register the path in the
  // session's active-dispatches index so a future restart can
  // discover in-flight records without scanning the directory.
  // The index is best-effort (no lock): the on-disk record is the
  // source of truth; the index is purely a hint for the LLM-side
  // runner. A crash between writeAtomic and the index write is
  // non-fatal — the next restart scans the directory anyway.
  registerActiveDispatch({
    projectRoot,
    sessionId,
    recordPath: safePath,
    requestId,
    role,
    batchId,
    now
  });
  return { path: safePath, record };
}

/**
 * Active-dispatches index. Per-session JSON file at
 * `.peaks/_sub_agents/<sid>/active-dispatches.json`. Map<recordPath,
 * ActiveDispatchEntry>. Updated on dispatch + completion.
 */
export interface ActiveDispatchEntry {
  readonly recordPath: string;
  readonly requestId: string;
  readonly role: string;
  readonly batchId: string;
  readonly createdAt: string;
  readonly status: 'queued' | 'running' | 'finalizing' | 'done' | 'failed' | 'cancelled' | 'stale' | 'no-execution';
}

function activeDispatchIndexPath(projectRoot: string, sessionId: string): string {
  return resolve(projectRoot, '.peaks', '_sub_agents', sessionId, 'active-dispatches.json');
}

function registerActiveDispatch(input: {
  projectRoot: string;
  sessionId: string;
  recordPath: string;
  requestId: string;
  role: string;
  batchId: string;
  now: () => Date;
}): void {
  const indexPath = activeDispatchIndexPath(input.projectRoot, input.sessionId);
  const dir = dirname(indexPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  let index: Record<string, ActiveDispatchEntry> = {};
  try {
    if (existsSync(indexPath)) {
      const raw = readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'object' && v !== null && 'recordPath' in v) {
            index[k] = v as ActiveDispatchEntry;
          }
        }
      }
    }
  } catch {
    // Corrupt index — start fresh. The on-disk record is the source of truth.
    index = {};
  }
  index[input.recordPath] = {
    recordPath: input.recordPath,
    requestId: input.requestId,
    role: input.role,
    batchId: input.batchId,
    createdAt: input.now().toISOString(),
    status: 'queued'
  };
  const tmp = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, indexPath);
}

function unregisterActiveDispatch(input: {
  projectRoot: string;
  sessionId: string;
  recordPath: string;
  status: ActiveDispatchEntry['status'];
}): void {
  const indexPath = activeDispatchIndexPath(input.projectRoot, input.sessionId);
  if (!existsSync(indexPath)) return;
  let index: Record<string, ActiveDispatchEntry> = {};
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'object' && v !== null && 'recordPath' in v) {
          index[k] = v as ActiveDispatchEntry;
        }
      }
    }
  } catch {
    return;
  }
  if (input.recordPath in index) {
    index[input.recordPath] = { ...index[input.recordPath]!, status: input.status };
    if (input.status === 'done' || input.status === 'failed' || input.status === 'cancelled' || input.status === 'no-execution') {
      delete index[input.recordPath];
    }
    const tmp = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
    renameSync(tmp, indexPath);
  }
}

/**
 * Slice 2026-06-23-audit-4th #A4: read the active-dispatches index
 * for a session. Returns the current map<recordPath, entry>. Used
 * by the LLM-side runner to discover in-flight records on restart.
 * Returns an empty map when the index file is missing or corrupt
 * (the on-disk records directory is the next fallback).
 */
export function readActiveDispatchIndex(projectRoot: string, sessionId: string): Record<string, ActiveDispatchEntry> {
  const indexPath = activeDispatchIndexPath(projectRoot, sessionId);
  if (!existsSync(indexPath)) return {};
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, ActiveDispatchEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'object' && v !== null && 'recordPath' in v && 'role' in v) {
        out[k] = v as ActiveDispatchEntry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Slice 2026-06-23-audit-4th #A3: default TTL for dispatch records. */
export const DISPATCH_RECORD_TTL_DAYS = 30;

/**
 * Slice 2026-06-23-audit-4th #A3: is this dispatch record an orphan
 * (older than DISPATCH_RECORD_TTL_DAYS or already GC'd)? Mirrors
 * `isOrphanChannel` in shared-channel.ts so a future
 * `peaks sub-agent cleanup` umbrella can run all three sweeps
 * (shared channel + dispatch record + contract) in one pass.
 */
export function isOrphanDispatchRecord(opts: {
  projectRoot: string;
  sid: string;
  rid: string;
  recordPath: string;
  now?: Date;
}): boolean {
  if (!existsSync(opts.recordPath)) return true;
  const s = statSync(opts.recordPath);
  const now = opts.now ?? new Date();
  const ageMs = now.getTime() - s.mtimeMs;
  const ttlMs = DISPATCH_RECORD_TTL_DAYS * 24 * 60 * 60 * 1000;
  return ageMs > ttlMs;
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
  const result = withFileLockSync(input.recordPath, () => {
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
  // Slice 2026-06-23-audit-4th #A4: update the active-dispatches
  // index. Best-effort (the on-disk record is the source of truth);
  // we only attempt the update when the trusted projectRoot is
  // available so a malicious recordPath cannot redirect the index
  // write (audit-3rd #1 anti-pattern).
  if (typeof input.projectRoot === 'string' && input.projectRoot.length > 0) {
    try {
      unregisterActiveDispatch({
        projectRoot: input.projectRoot,
        sessionId: result.record.sessionId,
        recordPath: input.recordPath,
        status: input.status
      });
    } catch {
      /* best-effort */
    }
  }
  return result;
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
  // Slice 2026-06-23-audit-4th #C2: preserve toolCallVersion on read.
  // Pre-versioning records default to '2.0.0' (the pre-#C2 implicit
  // shape; matches the version stamped by every current dispatcher).
  const rawToolCall = obj.toolCall as Record<string, unknown>;
  if (!isObject(rawToolCall) || typeof rawToolCall.name !== 'string') {
    throw new Error('Dispatch record toolCall must be { name, args }');
  }
  const toolCall: SubAgentToolCall = {
    name: rawToolCall.name as string,
    args: (isObject(rawToolCall.args) ? rawToolCall.args : {}) as Readonly<Record<string, unknown>>,
    ...(typeof rawToolCall.toolCallVersion === 'string' ? { toolCallVersion: rawToolCall.toolCallVersion } : { toolCallVersion: '2.0.0' })
  };
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
