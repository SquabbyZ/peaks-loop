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
import { withFileLockSync } from 'peaks-loop-shared-channel';
import { isStageLabel, type StageLabel } from './stage-enum.js';
import { emitLeaseEvent } from '../observability/observability-service.js';

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
  | 'stale'
  // Slice 2026-07-29-dispatch-stall-governance / S2 — align the per-
  // heartbeat vocabulary with the dispatch record's aggregate status
  // union so a sub-agent can report any aggregate state through the
  // heartbeat CLI (and the help text enumerates the same set the
  // writer accepts). See tests/unit/dispatch/heartbeat-parity.test.ts
  // for the pinned CLI↔writer parity assertion (AC-2.2).
  | 'cancelled'
  | 'no-execution'
  | 'never-started'
  | 'unreadable';

export type DispatchRecordStatus =
  | 'queued'
  | 'running'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'no-execution'
  | 'stale'
  // Slice 2026-07-29-dispatch-stall-governance / S1 — distinguish
  // *never-started* (record written, no first heartbeat within the
  // startup budget) from `stale` (heartbeat seen, then quiet) and from
  // `unreadable` (record body corrupt / unparseable). The startup-
  // timeout service in ./startup-timeout.ts is the canonical writer.
  | 'never-started'
  | 'unreadable';

export type DispatchOutcome =
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'no-execution';

/** G2+G5+G6 dispatch record schema (AC-26 + AC-34). */
export interface DispatchRecord {
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 4.C: schema v3 makes
   * `leaseId` a structurally required field (was `leaseId?: string | null`
   * in v2). The v3 upgrade is a "fill in" migration: every dispatch
   * writer knows its lease id at construction time (Part 2.C's
   * --isolation worktree spawns it; non-isolation dispatches stamp
   * `null`). Readers tolerate both v2 and v3 on disk (see
   * `upgradeRecord`); the `?` was a Part 4.A ergonomic concession
   * to keep 4 unit-test literal sites from breaking the build. v3
   * moves the optional off the type and adds the field to the
   * 4 literal sites in one pass.
   *
   * Slice 2026-07-29-worktree-l2-extended Part 7: schema v3.1 adds
   * `isolationStartedAt: string | null` for the L4 isolation
   * bridge (Part 8 container POC). It's the ISO timestamp of
   * when the isolation mode was set up (e.g. when the worktree
   * was spawned). `null` means the dispatch did not request
   * isolation. The `version` field stays at 3 because the
   * v3 → v3.1 transition is additive; the new field is
   * defaulted to `null` on read so v3 records upgrade cleanly.
   */
  /**
   * Slice 2026-07-29-rid-prose-only-sweep Part 34: schema v3.1
   * is the explicit minor bump that records the
   * `isolationStartedAt` (Part 7) and `leaseId` (Part 3.A.1 +
   * Part 4.C) fields as part of the canonical schema. v3
   * records on disk upgrade transparently — see `upgradeRecord`
   * in this file. The literal type ('3.1') is the source of
   * truth for "this record is v3.1-form"; readers check
   * `version === '3.1'` for forward-compatible dispatching.
   */
  readonly version: '4.0.0';
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
  // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1) — bounded,
  // machine-readable stage label. Free-form `note` was never a stage
  // — the value is one of a small enum in ./stage-enum.ts (PB-2: a
  // legacy record missing this field upgrades to `null`, not an
  // empty string, so the watch surface can distinguish "no stage
  // ever emitted" from "stage: ''").
  readonly stage: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 3.A + Part 4.C: the
   * worktree lease id stamped on this dispatch (via `peaks sub-agent
   * dispatch --isolation worktree`). The release hook (see
   * markCompleted + `peaks sub-agent heartbeat --status done`)
   * reads this field to auto-call `peaks worktree release` when
   * the sub-agent finalizes. `null` means the dispatch did not
   * request isolation and no release will fire. Persisted for
   * audit + idempotency so a re-read of an old record still
   * surfaces the lease id even if the on-disk lease file has since
   * been gc'd.
   *
   * v3 (Part 4.C) makes this structurally required. v2 records
   * missing the field upgrade to `null` on read (see
   * `upgradeRecord`).
   */
  readonly leaseId: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 7: ISO timestamp of
   * when the isolation mode was set up. For `--isolation worktree`
   * this is the moment `peaks worktree spawn` returned; for
   * `--isolation container` (Part 8) it's when the container
   * runtime reported the container as running. `null` when the
   * dispatch did not request isolation. Lets the dashboard
   * compute isolation duration (now - isolationStartedAt) without
   * cross-referencing the metrics stream.
   */
  readonly isolationStartedAt: string | null;
  /**
   * Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.2 schema
   * bump. One entry per pid the parent best-effort-killed during
   * the service-shutdown phase of the merge-back pipeline (see
   * src/services/dispatch/service-shutdown.ts). Empty array when
   * the sub-agent did not register any services. The shape is the
   * union of ServiceKillOutcome (skipped=false) and
   * ServiceKillSkipped (skipped=true) — kept as a plain object
   * here so the on-disk schema does not lock onto the helper's
   * narrower union. The reader (merge-back-runner.ts) interprets
   * each entry based on the `skipped` field.
   */
  readonly serviceKill: ReadonlyArray<{
    readonly pid: number;
    readonly name: string;
    readonly signal: string;
    readonly exitCode: number | null;
    readonly skipped?: boolean;
    readonly reason?: string;
  }>;
  /**
   * Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.2 schema
   * bump. Counts how many merge attempts the parent session has
   * made against this dispatch's branch. The conflict-replay
   * orchestrator bumps this on each retry (bounded to ONE re-dispatch
   * per merge attempt; multi-conflict cases escalate). Persisted so
   * the dashboard can render the retry count without replaying the
   * merge transcript.
   */
  readonly mergeBackAttempts: number;
  /**
   * Slice 4.0.8 RD §4 D4c (presence-lease-graph): the workflow id +
   * graph node id + graphRef this dispatch is bound to. Persisted
   * directly in the dispatch record (NOT in a sidecar) so the
   * envelope-writer `markCompleted` can auto-transition the bound
   * graph node to `envelope-received` with `ackStatus=pending` in
   * one protected update.
   *
   * The schema bump from `3.2 → 4.0.0` is BREAKING in the sense
   * that the literal type is narrowed. The optional `?` keeps back-
   * compat for old records that pre-date the binding (the
   * `upgradeRecord` reader defaults them to `null`).
   */
  readonly workflowId: string | null;
  readonly graphNodeId: string | null;
  readonly graphRef: string | null;
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
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 3.A: the worktree
   * lease id this dispatch owns (set by `peaks sub-agent dispatch
   * --isolation worktree`). Persisted so the finalize-time release
   * hook in `markCompleted` can fire even after the dispatch
   * process exits. Optional; absent when the dispatch did not
   * request isolation.
   */
  leaseId?: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 7: ISO timestamp
   * when the isolation mode was set up. Optional on the input
   * (defaults to `null`); dispatch-commands.ts passes the spawn
   * time when `--isolation` is requested.
   */
  isolationStartedAt?: string | null;
  /**
   * Slice 4.0.8: workflow graph binding for the dispatch. Defaults
   * to `null` so a non-graph dispatch (legacy CLI flow, ad-hoc
   * dispatch) still writes a v4.0.0 record.
   */
  workflowId?: string | null;
  graphNodeId?: string | null;
  graphRef?: string | null;
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

/**
 * PRD-002b slice 2 — extract dispatch-record size budgets (max-prompt
 * bytes, note truncation cap) + time-math primitives so the
 * no-magic-numbers rule stops flagging the writer pipeline.
 */
const BYTES_PER_KB = 1024;
const MAX_PROMPT_KB = 256;
const MAX_PROMPT_BYTES = MAX_PROMPT_KB * BYTES_PER_KB;
const NOTE_MAX_CHARS = 200;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const REDACTION_MAX_SCAN_DEPTH = 20;

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
    version: '4.0.0',
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
    status: 'queued',
    // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1) — new
    // records start with `stage: null`; the sub-agent promotes it
    // through `setStage` / the heartbeat CLI's `--stage` flag.
    stage: null,
    // Slice 2026-07-29-worktree-l2-extended Part 3.A: when the
    // dispatch was issued with --isolation worktree, persist the
    // lease id so the finalize-time release hook in markCompleted
    // can fire. Validation is the same 16-hex regex the gate uses
    // (gate-commands.ts), so an attacker-controlled toolCall.env
    // cannot inject a non-hex value and get the release path to
    // misfire.
    leaseId: typeof input.leaseId === 'string' && /^[a-f0-9]{16}$/.test(input.leaseId)
      ? input.leaseId
      : null,
    // Slice 2026-07-29-worktree-l2-extended Part 7: v3.1 field.
    // ISO timestamp when the isolation mode was set up. Default
    // null when the dispatch did not request isolation. We do
    // NOT validate the format — the writer is the source of
    // truth here, and any ISO 8601 string Date.parse() can
    // handle is acceptable for the dashboard.
    isolationStartedAt: typeof input.isolationStartedAt === 'string' && input.isolationStartedAt.length > 0
      ? input.isolationStartedAt
      : null,
    // Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.2 fields.
    // New records start with empty serviceKill and zero attempts;
    // the merge-back-runner (Task 9) populates them in place.
    serviceKill: [],
    mergeBackAttempts: 0,
    // Slice 4.0.8: workflow graph binding (RD §4 D4c). Defaults to
    // `null` for legacy / ad-hoc dispatches that do not bind a graph
    // node; v4.0.0 schema is structural (required field), so a `null`
    // is the explicit "no binding" state.
    workflowId: typeof input.workflowId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(input.workflowId) ? input.workflowId : null,
    graphNodeId: typeof input.graphNodeId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(input.graphNodeId) ? input.graphNodeId : null,
    graphRef: typeof input.graphRef === 'string' && input.graphRef.length > 0 ? input.graphRef : null,
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
  // Slice 2026-07-29-dispatch-stall-governance / S1 — accept the two new
  // terminal members from the startup-timeout service.
  readonly status:
    | 'queued'
    | 'running'
    | 'finalizing'
    | 'done'
    | 'failed'
    | 'cancelled'
    | 'stale'
    | 'no-execution'
    | 'never-started'
    | 'unreadable';
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
    // Slice 2026-07-29-dispatch-stall-governance / S1 — `never-started`
    // and `unreadable` are terminal (the startup-timeout service writes
    // them as terminal markers). Unregister on the full terminal set.
    if (
      input.status === 'done' ||
      input.status === 'failed' ||
      input.status === 'cancelled' ||
      input.status === 'no-execution' ||
      input.status === 'never-started' ||
      input.status === 'unreadable'
    ) {
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
  const ttlMs = DISPATCH_RECORD_TTL_DAYS * MS_PER_DAY;
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
  if (note !== undefined && note.length > NOTE_MAX_CHARS) {
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

/**
 * Slice 2026-07-29-worktree-l2-extended Part 3.A: fire-and-forget
 * auto-release for the lease owned by a dispatch. Called from
 * `markCompleted` (terminal status) and from the heartbeat CLI
 * (`--status done`).
 *
 * Design:
 * - The release subprocess is spawned ASYNC and detached. The
 *   finalize-time caller (heartbeat / share / dispatch reducer)
 *   does NOT await it; the caller's job is to record the
 *   finalization, not to wait for the lease cleanup.
 * - Failures are swallowed (best-effort, same as `git worktree
 *   remove` inside `peaks worktree release` itself). The next
 *   `peaks worktree gc` pass is the safety net.
 * - Idempotent: re-calling with the same leaseId is a no-op on
 *   the release side (the CLI refuses to re-release an already-
 *   released lease; see Part 1 release command).
 * - The leaseId MUST be 16-hex (same regex the gate uses). Any
 *   other value is silently ignored — we never shell out to
 *   `peaks worktree release` with attacker-controlled input.
 */
export function tryAutoReleaseLease(args: {
  projectRoot: string;
  sessionId: string;
  leaseId: string;
  /** Best-effort logging hook (e.g. logger.writeLogEntry). Returns null on failure. */
  logger?: (line: string) => void;
}): void {
  if (typeof args.leaseId !== 'string' || !/^[a-f0-9]{16}$/.test(args.leaseId)) {
    return;
  }
  if (typeof args.projectRoot !== 'string' || args.projectRoot.length === 0) {
    return;
  }
  // Spawn detached. The CLI itself runs `git worktree remove` and
  // marks the lease released; we trust its at-least-once semantics.
  // `node:child_process` is loaded via dynamic import so this module
  // remains ESM-compatible (the compiled heartbeat CLI throws
  // `require is not defined` if we use `require` here).
  void (async () => {
    let spawned = false;
    try {
      const cp = await import('node:child_process');
      const child = cp.spawn(
        process.execPath,
        [
          process.argv[1] ?? '',
          'worktree', 'release',
          '--lease-id', args.leaseId,
          '--project', args.projectRoot,
          '--session', args.sessionId,
          '--json'
        ],
        // `pipe` rather than `ignore` so a spawn failure (e.g. ENOENT
        // on process.argv[1] in a test) shows up on stderr instead
        // of vanishing into the void. The release CLI is short-lived
        // so buffering is irrelevant.
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true }
      );
      spawned = true;
      if (process.env.PEAKS_WORKTREE_LEASE_DEBUG) {
        child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[release] ${d.toString('utf8')}`));
        child.stdout?.on('data', (d: Buffer) => process.stderr.write(`[release] ${d.toString('utf8')}`));
        child.on('error', (e) => process.stderr.write(`[release error] ${e.message}\n`));
        child.on('exit', (code) => process.stderr.write(`[release exit] code=${code}\n`));
      } else {
        child.stderr?.on('data', () => { /* drain */ });
        child.stdout?.on('data', () => { /* drain */ });
        child.on('error', () => { /* detached best-effort */ });
      }
      child.unref();
    } catch (e) {
      // Slice 2026-07-29-worktree-l2-extended Part 4.A: surface
      // auto-release failures to the observability stream so the
      // dashboard can alert. The spawn-attempt itself threw (not
      // a child-process exit-code failure — those are not
      // catchable from the parent because the child is detached
      // and unref'd). emitLeaseEvent is fire-and-forget; it
      // returns a result we don't inspect.
      emitLeaseEvent({
        sessionId: args.sessionId,
        projectRoot: args.projectRoot,
        kind: 'autoRelease-failed',
        leaseId: args.leaseId,
        reason: (e as Error).message
      });
    }
    if (spawned) {
      // Record the success path. Idempotent with the manual
      // `peaks worktree release` metric — the release CLI itself
      // emits a 'release' event when it runs and lands. Two
      // events for one logical release is acceptable; the
      // dashboard can dedup or count both under
      // lease.autoRelease.count.
      emitLeaseEvent({
        sessionId: args.sessionId,
        projectRoot: args.projectRoot,
        kind: 'autoRelease',
        leaseId: args.leaseId
      });
    }
  })();
  // NB: we deliberately do NOT log per-call here — every heartbeat
  // that reports done in a busy session would otherwise spam the
  // log. The release CLI itself emits a structured envelope on
  // success; that's the audit record.
  if (args.logger !== undefined) {
    args.logger(`peaks.worktree.autoRelease leaseId=${args.leaseId} sessionId=${args.sessionId}`);
  }
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
  // Slice 4.0.8 RD §4 D4c: after validating the artifact/envelope
  // association with `dispatchRef`, automatically transition the
  // bound graph node to `envelope-received` with
  // `ackStatus=pending`. This is the auto-transition the parent
  // ack protocol relies on — the canonical dispatch chain is
  // `prepare -> dispatched -> running -> envelope-received -> consumed-by-parent`.
  // The transition runs through `workflow-node-lifecycle.writeEnvelope`
  // so the same typed error contract (PEAKS_ENVELOPE_GRAPH_MISMATCH,
  // PEAKS_GRAPH_REF_BROKEN, etc.) is reused. Failures are swallowed
  // (best-effort; the dispatch record itself is the source of truth
  // and the transition is observable through the graph store).
  if (result.record.workflowId !== null && result.record.graphNodeId !== null && result.record.graphRef !== null) {
    try {
      // Lazy ESM dynamic import: the graph lifecycle service is not
      // on the dispatch hot path; it would be wasteful to import it
      // for non-graph-bound dispatches. ESM dynamic import returns
      // a promise; we do not await (best-effort) — the dispatch
      // record write is the load-bearing artifact, and the graph
      // node transition is observable to the next CLI call.
      void (async () => {
        try {
          const lifecycleMod = await import('../workflow/workflow-node-lifecycle.js');
          const storeMod = await import('../workflow/workflow-graph-store.js');
          const sessionRoot = (() => {
            try {
              return storeMod.graphPathFor({
                projectRoot: input.projectRoot ?? '',
                sessionId: result.record.sessionId,
                graphRef: result.record.graphRef ?? '',
                workflowId: result.record.workflowId ?? '',
              });
            } catch { return null; }
          })();
          if (sessionRoot === null) return;
          const graph = storeMod.readGraph({
            projectRoot: input.projectRoot ?? '',
            sessionId: result.record.sessionId,
            graphRef: result.record.graphRef ?? '',
            workflowId: result.record.workflowId ?? '',
          });
          const node = graph.nodes.find((n) => n.id === result.record.graphNodeId);
          if (node === undefined) return;
          // Use the dispatch record's path as the dispatchRef. The
          // record itself is the load-bearing artifact; the
          // graph-node transition is a derived side-effect.
          const dispatchRef = input.recordPath;
          lifecycleMod.writeEnvelope({
            graphNode: node,
            dispatchRef,
            envelopeDispatchRef: dispatchRef,
          });
        } catch { /* best-effort graph transition */ }
      })();
    } catch { /* best-effort */ }
  }
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
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      /* best-effort */
    }
  }
  // Slice 2026-07-29-worktree-l2-extended Part 3.A: finalize-time
  // lease release. The terminal status (done/failed/cancelled/
  // no-execution) means the sub-agent is no longer using the
  // worktree; auto-release closes the loop. The release is detached
  // and best-effort; a crash here cannot roll back the markCompleted
  // write (we already returned from the lock). The next gc pass is
  // the safety net.
  if (result.record.leaseId !== null && typeof input.projectRoot === 'string' && input.projectRoot.length > 0) {
    try {
      tryAutoReleaseLease({
        projectRoot: input.projectRoot,
        sessionId: result.record.sessionId,
        leaseId: result.record.leaseId
      });
    } catch { // best-effort; release is async anyway
      /* swallow */
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
 * Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1) — promote
 * the record's `stage` field. Rejects unknown values with
 * `INVALID_STAGE`; the LLM-side runner surfaces the error so the
 * sub-agent can pick from the bounded enum in ./stage-enum.ts.
 *
 * Atomic via the same `withFileLockSync` lock as `appendHeartbeat` /
 * `markCompleted`. `null` is a valid argument ("clear the stage")
 * but unknown strings are not.
 */
export function setStage(input: {
  recordPath: string;
  stage: StageLabel | null;
  now?: () => Date;
}): { record: DispatchRecord } {
  if (input.stage !== null && !isStageLabel(input.stage)) {
    const err = new Error(
      `stage must be one of the bounded stage labels (got: ${JSON.stringify(input.stage)})`
    ) as Error & { code: string };
    err.code = 'INVALID_STAGE';
    throw err;
  }
  return withFileLockSync(input.recordPath, () => {
    const existing = readRecord(input.recordPath);
    const next: DispatchRecord = {
      ...existing,
      stage: input.stage
    };
    writeAtomic(input.recordPath, next);
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
  // Slice 4.0.8: 3.2 → 4.0.0 schema bump. The literal type narrows
  // to '4.0.0' but legacy v3.2 / v3.1 / 3 / 2 / 1 records are
  // accepted transparently and upgraded on read.
  const rawVersion = obj.version;
  if (rawVersion !== '4.0.0' && rawVersion !== '3.2' && rawVersion !== '3.1' && rawVersion !== 3 && rawVersion !== 2 && rawVersion !== 1) {
    throw new Error(
      `Dispatch record version mismatch: expected '4.0.0', '3.2', '3.1', 3, 2, or 1, got ${JSON.stringify(rawVersion)}. ` +
      'The v1 → v4.0.0 migration is in-file; records from much older or newer builds must be regenerated.'
    );
  }
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
  // Slice 2026-07-29-dispatch-stall-governance / S1 (UQ-1) — `no-execution`
  // keeps its natural "dispatched, never executed" reading; an unparseable
  // status field now resolves to a *distinct* `unreadable` label so the
  // caller can tell "corrupt record" apart from "record written, no first
  // heartbeat" (which is the new `never-started` state).
  const status: DispatchRecordStatus = isDispatchStatus(obj.status)
    ? obj.status
    : 'unreadable';
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
    version: '4.0.0',
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
    status,
    // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1 / PB-2)
    // — legacy records (pre-slice) had no `stage` field. The reader
    // defaults to `null` so the watch surface can tell "no stage ever
    // emitted" apart from "stage: ''" (which is itself a *valid*
    // round-trip through the writer — an empty stage is rejected by
    // `setStage`, but a record that round-tripped through a non-strict
    // tool would land here).
    stage: typeof obj.stage === 'string' && obj.stage.length > 0 ? obj.stage : null,
    // Slice 2026-07-29-worktree-l2-extended Part 3.A: legacy records
    // have no `leaseId`; default to `null` so the auto-release hook
    // in `markCompleted` is a clean no-op for them.
    leaseId: typeof obj.leaseId === 'string' && /^[a-f0-9]{16}$/.test(obj.leaseId)
      ? obj.leaseId
      : null,
    // Slice 2026-07-29-worktree-l2-extended Part 7: v3 → v3.1
    // migration. Legacy records have no `isolationStartedAt`; default
    // to `null`. v3.1 readers can treat the field as opt-in.
    isolationStartedAt: typeof obj.isolationStartedAt === 'string' && obj.isolationStartedAt.length > 0
      ? obj.isolationStartedAt
      : null,
    // Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.1 → v3.2
    // migration. Legacy v3.1 records have no `serviceKill` or
    // `mergeBackAttempts` fields. Default to [] and 0 so the
    // merge-back-runner (Task 9) can read either schema on disk.
    serviceKill: Array.isArray(obj.serviceKill)
      ? (obj.serviceKill.filter((e): e is { readonly pid: number; readonly name: string; readonly signal: string; readonly exitCode: number | null; readonly skipped?: boolean; readonly reason?: string } => {
          if (typeof e !== 'object' || e === null) return false;
          const o = e as Record<string, unknown>;
          return typeof o.pid === 'number' && typeof o.name === 'string' && typeof o.signal === 'string' && (o.exitCode === null || typeof o.exitCode === 'number');
        }))
      : [],
    mergeBackAttempts: typeof obj.mergeBackAttempts === 'number' && Number.isFinite(obj.mergeBackAttempts) && obj.mergeBackAttempts >= 0
      ? Math.floor(obj.mergeBackAttempts)
      : 0,
    // Slice 4.0.8: 3.2 → 4.0.0 migration. v3.2 records on disk
    // pre-date the workflow-graph binding; default all three
    // fields to `null` so a legacy record upgrades transparently.
    workflowId: typeof obj.workflowId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(obj.workflowId) ? obj.workflowId : null,
    graphNodeId: typeof obj.graphNodeId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(obj.graphNodeId) ? obj.graphNodeId : null,
    graphRef: typeof obj.graphRef === 'string' ? obj.graphRef : null
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
    v === 'done' || v === 'failed' || v === 'stale' ||
    // Slice 2026-07-29-dispatch-stall-governance / S2 — accept the
    // S1 terminal members so a sub-agent can report `cancelled`,
    // `no-execution`, `never-started`, or `unreadable` through the
    // heartbeat CLI.
    v === 'cancelled' || v === 'no-execution' ||
    v === 'never-started' || v === 'unreadable'
  );
}

function isDispatchStatus(v: unknown): v is DispatchRecordStatus {
  return (
    v === 'queued' || v === 'running' || v === 'finalizing' ||
    v === 'done' || v === 'failed' || v === 'cancelled' ||
    v === 'no-execution' || v === 'stale' ||
    // Slice 2026-07-29-dispatch-stall-governance / S1 — accept the two
    // new terminal members from the startup-timeout service.
    v === 'never-started' || v === 'unreadable'
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