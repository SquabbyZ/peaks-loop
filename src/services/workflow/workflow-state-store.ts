/**
 * Slice 2026-06-13-peaks-workflow-skip — workflow state store.
 *
 * Per-slice ephemeral runtime state, keyed by rid. Lives under
 * `.peaks/_runtime/<sessionId>/workflow-state/<rid>.json` (gitignored
 * alongside the rest of `.peaks/_runtime/`).
 *
 * Today only the skip-marker shape is persisted. Future workflow-edit
 * primitives (e.g. `peaks workflow inject`, `peaks workflow unskip`)
 * can extend the schema additively.
 *
 * Design:
 *   - Synchronous read (the state file is tiny, < 200 bytes; not worth
 *     an async I/O layer for it).
 *   - Synchronous write (same rationale; the file is in the user's
 *     own `.peaks/_runtime/` and the write is bounded by the
 *     dispatcher that already has the file handle).
 *   - Tolerate malformed JSON: returns null on parse error so the
 *     caller can treat "no state" as "no skip applied" rather than
 *     blowing up the workflow.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type WorkflowSkipState = {
  rid: string;
  skippedGates: string[];
  skipReason: string;
  skipAppliedAt: string; // ISO 8601 UTC
  skipAppliedBy: string;
  callerKind: 'human' | 'llm' | 'script';
};

const STATE_FILE_NAME = 'workflow-state.json';

function stateFilePath(projectRoot: string, sessionId: string, rid: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, 'workflow-state', `${rid}.json`);
}

/**
 * Read the skip-state for a rid, or `null` if no state file exists or
 * the file is malformed. The caller is expected to treat `null` as
 * "no skip applied; evaluate all gates normally".
 */
export function readSkipState(projectRoot: string, sessionId: string, rid: string): WorkflowSkipState | null {
  const path = stateFilePath(projectRoot, sessionId, rid);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkflowSkipState(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write (or overwrite) the skip-state for a rid. Returns the absolute
 * path to the file that was written. Caller is responsible for
 * surfacing this in the envelope as `persistedTo`.
 */
export function writeSkipState(
  projectRoot: string,
  sessionId: string,
  state: WorkflowSkipState
): string {
  const path = stateFilePath(projectRoot, sessionId, state.rid);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Delete the skip-state file for a rid. Idempotent: missing file is
 * a no-op (returns false). Used by `peaks workflow unskip` (v2) and
 * by the rollback path of `applySkip` if the caller passes
 * `--dry-run` and we want to clean up any preview state.
 */
export function deleteSkipState(projectRoot: string, sessionId: string, rid: string): boolean {
  const path = stateFilePath(projectRoot, sessionId, rid);
  if (!existsSync(path)) {
    return false;
  }
  unlinkSync(path);
  return true;
}

function isWorkflowSkipState(value: unknown): value is WorkflowSkipState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Partial<WorkflowSkipState>;
  if (typeof v.rid !== 'string') return false;
  if (!Array.isArray(v.skippedGates)) return false;
  if (!v.skippedGates.every((g) => typeof g === 'string')) return false;
  if (typeof v.skipReason !== 'string') return false;
  if (typeof v.skipAppliedAt !== 'string') return false;
  if (typeof v.skipAppliedBy !== 'string') return false;
  if (v.callerKind !== 'human' && v.callerKind !== 'llm' && v.callerKind !== 'script') return false;
  return true;
}
