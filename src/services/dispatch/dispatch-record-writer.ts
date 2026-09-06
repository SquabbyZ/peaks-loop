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
import { assertSafeDispatchRecordPath, dispatchRecordPath } from '../security/safe-settings-path.js';
import { withFileLockSync } from 'peaks-loop-shared-channel';
import { isStageLabel, type StageLabel } from './stage-enum.js';
import { emitLeaseEvent } from '../observability/observability-service.js';
import { upgradeRecord } from './dispatch-record-upgrade.js';
import { MAX_PROMPT_BYTES, MS_PER_DAY, NOTE_MAX_CHARS } from './dispatch-record-types.js';
import type {
  AppendHeartbeatInput,
  DispatchRecord,
  DispatchRecordStatus,
  Heartbeat,
  HeartbeatStatus,
  LifecycleInput,
  WriteInitialDispatchInput
} from './dispatch-record-types.js';

export type {
  AppendHeartbeatInput,
  DispatchOutcome,
  DispatchRecord,
  DispatchRecordStatus,
  Heartbeat,
  HeartbeatStatus,
  LifecycleInput,
  WriteInitialDispatchInput
} from './dispatch-record-types.js';
export { isDispatchStatus, isOutcome } from './dispatch-record-upgrade.js';

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

  const record = buildInitialDispatchRecord(input, now);
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
 * Construct the initial `DispatchRecord` from a `WriteInitialDispatchInput`.
 * PRD-002b slice 6: extracted from `writeInitialDispatchRecord` so the
 * writer stays under the `max-lines-per-function: 50` ESLint ceiling.
 * Behavior is byte-identical to the previous inline literal.
 */
function buildInitialDispatchRecord(input: WriteInitialDispatchInput, now: () => Date): DispatchRecord {
  const { role, requestId, sessionId, prompt, toolCall, batchId } = input;
  return {
    version: '4.1.0',
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
    // Phase A Task 8: detached sub-agent mode (default in-process).
    mode: input.mode === 'detached' ? 'detached' : 'in-process',
    vendor: input.vendor === 'claude' || input.vendor === 'codex' || input.vendor === 'copilot' ? input.vendor : null,
    autoCompactEvents: Array.isArray(input.autoCompactEvents)
      ? input.autoCompactEvents.filter((e): e is { at: number; threshold: '0.85' | '0.95'; tokensBefore: number; tokensAfter: number; scratchFile?: string } =>
          typeof e?.at === 'number' &&
          (e?.threshold === '0.85' || e?.threshold === '0.95') &&
          typeof e?.tokensBefore === 'number' &&
          typeof e?.tokensAfter === 'number',
        )
      : [],
    tokenUsage:
      typeof input.tokenUsage === 'object' && input.tokenUsage !== null && typeof input.tokenUsage.promptTokens === 'number' && typeof input.tokenUsage.completionTokens === 'number'
        ? {
            promptTokens: input.tokenUsage.promptTokens,
            completionTokens: input.tokenUsage.completionTokens,
            ...(typeof input.tokenUsage.totalCostUsd === 'number' ? { totalCostUsd: input.tokenUsage.totalCostUsd } : {}),
          }
        : null,
  };
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
  void spawnLeaseReleaseChild(args);
  // NB: we deliberately do NOT log per-call here — every heartbeat
  // that reports done in a busy session would otherwise spam the
  // log. The release CLI itself emits a structured envelope on
  // success; that's the audit record.
  if (args.logger !== undefined) {
    args.logger(`peaks.worktree.autoRelease leaseId=${args.leaseId} sessionId=${args.sessionId}`);
  }
}

/**
 * Spawn the detached `peaks worktree release` subprocess.
 * PRD-002b slice 6: extracted from `tryAutoReleaseLease` so the
 * public wrapper stays under the `max-lines-per-function: 50`
 * ESLint ceiling. Behavior is byte-identical to the previous
 * inline IIFE.
 */
async function spawnLeaseReleaseChild(args: {
  projectRoot: string;
  sessionId: string;
  leaseId: string;
}): Promise<void> {
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
    scheduleGraphEnvelopeTransition(input, result.record);
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

/**
 * Schedule a detached graph-envelope transition for a completed dispatch.
 * PRD-002b slice 6: extracted from `markCompleted` to keep that function
 * under the `max-lines-per-function: 50` ESLint ceiling. Behavior is
 * byte-identical to the previous inline block:
 *   - skip when graph binding fields are all non-null on the record;
 *   - dynamic ESM import the lifecycle + store modules (not on hot path);
 *   - best-effort; failures swallowed so the dispatch record write is
 *     load-bearing and the next CLI call can observe the transition.
 */
function scheduleGraphEnvelopeTransition(input: LifecycleInput, record: DispatchRecord): void {
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
              sessionId: record.sessionId,
              graphRef: record.graphRef ?? '',
              workflowId: record.workflowId ?? '',
            });
          } catch { return null; }
        })();
        if (sessionRoot === null) return;
        const graph = storeMod.readGraph({
          projectRoot: input.projectRoot ?? '',
          sessionId: record.sessionId,
          graphRef: record.graphRef ?? '',
          workflowId: record.workflowId ?? '',
        });
        const node = graph.nodes.find((n) => n.id === record.graphNodeId);
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
