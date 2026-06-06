/**
 * Slice #009 / G5 RL-8 — sub-agent dispatch record archival + 30-day GC.
 *
 * Called by the `peaks session finish` / `peaks session abandon` /
 * new-rid-startup hooks. Walks the per-session `.peaks/_sub_agents/<sid>/`
 * tree and moves completed + disposed records to
 * `.peaks/_runtime/<sid>/_archive/_sub_agents/<sliceId>/`.
 *
 * GC policy:
 *   - Records with `disposed: true` AND `outcome ∈ {success, failed,
 *     timeout, cancelled}` (not "no-execution") → archive + 30-day GC.
 *   - Records with `disposed: false` (any outcome) → archive but NOT
 *     GC'd. Next session will see them as still-pending in
 *     `_archive/.../in-flight/` and can resume reducer work.
 *
 * Lazy GC: `archiveSubAgentRecords` also scans the archive dir and
 * deletes entries older than 30 days. No cron, no background daemon.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isDispatchStatus, isOutcome, type DispatchRecord } from '../dispatch/dispatch-record-writer.js';

export const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface ArchiveResult {
  readonly archivedCompleted: number;
  readonly archivedInFlight: number;
  readonly gcDeleted: number;
}

/** Build the canonical archive dir for a given session + slice id. */
export function archiveDir(projectRoot: string, sessionId: string, sliceId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, '_archive', '_sub_agents', sliceId);
}

/** Build the in-flight subdir (records not yet disposed). */
export function inFlightArchiveDir(projectRoot: string, sessionId: string, sliceId: string): string {
  return join(archiveDir(projectRoot, sessionId, sliceId), 'in-flight');
}

/**
 * Archive the current `.peaks/_sub_agents/<sid>/` tree under
 * `<archiveDir>` (per the sliceId), separating completed vs in-flight.
 * Then run the 30-day GC over the archive dir.
 */
export function archiveSubAgentRecords(
  projectRoot: string,
  options: { sessionId: string; sliceId: string; now?: () => Date }
): ArchiveResult {
  const now = options.now ?? (() => new Date());
  const sourceDir = join(projectRoot, '.peaks', '_sub_agents', options.sessionId);
  const completedDir = archiveDir(projectRoot, options.sessionId, options.sliceId);
  const inFlightDir = inFlightArchiveDir(projectRoot, options.sessionId, options.sliceId);
  mkdirSync(completedDir, { recursive: true });
  mkdirSync(inFlightDir, { recursive: true });

  let archivedCompleted = 0;
  let archivedInFlight = 0;

  if (existsSync(sourceDir)) {
    for (const entry of readdirSync(sourceDir)) {
      if (!entry.startsWith('dispatch-') || !entry.endsWith('.json')) continue;
      const src = join(sourceDir, entry);
      const record = readRecordOrNull(src);
      if (record === null) continue;
      if (record.disposed === true && isCompletedOutcome(record.outcome)) {
        renameSync(src, join(completedDir, entry));
        archivedCompleted += 1;
      } else {
        renameSync(src, join(inFlightDir, entry));
        archivedInFlight += 1;
      }
    }
  }

  // 30-day GC: walk the archive root (any sliceId), delete entries
  // whose file mtime is older than the retention.
  const gcDeleted = runGarbageCollection(completedDir, now().getTime());

  return { archivedCompleted, archivedInFlight, gcDeleted };
}

function isCompletedOutcome(outcome: DispatchRecord['outcome']): boolean {
  return outcome === 'success' || outcome === 'failed' || outcome === 'timeout' || outcome === 'cancelled';
}

function readRecordOrNull(path: string): DispatchRecord | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (!isOutcome(obj.outcome) || !isDispatchStatus(obj.status)) return null;
    if (typeof obj.disposed !== 'boolean') return null;
    return obj as unknown as DispatchRecord;
  } catch {
    return null;
  }
}

function runGarbageCollection(dir: string, nowMs: number): number {
  if (!existsSync(dir)) return 0;
  let deleted = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        deleted += runGarbageCollection(full, nowMs);
        continue;
      }
      const ageMs = nowMs - stat.mtimeMs;
      if (ageMs > ARCHIVE_RETENTION_MS) {
        unlinkSync(full);
        deleted += 1;
      }
    } catch {
      /* skip unreadable; do not crash the archive op */
    }
  }
  return deleted;
}
