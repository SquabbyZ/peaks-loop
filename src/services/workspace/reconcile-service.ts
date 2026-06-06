/**
 * Reconcile service for `.peaks/2026-MM-DD-session-<6hex>/` directories.
 *
 * Reconcile scans the project root's `.peaks/` directory, identifies a
 * canonical session via a 4-tier heuristic, re-points
 * `.peaks/_runtime/session.json` (the canonical new home of the
 * binding; legacy `.peaks/.session.json` is read-only back-compat),
 * and (optionally, with apply === true) deletes empty / abandoned
 * session dirs older than olderThanMs.
 *
 * As of slice 2026-06-05-peaks-runtime-layer the top-level orchestrator
 * also runs `migrateOldRuntimeState` at the start so pre-migration
 * trees have their `.peaks/.session.json` / `.peaks/.active-skill.json`
 * / `.peaks/sop-state/` files moved into `.peaks/_runtime/`.
 *
 * Pure hand-rolled; uses only node:fs, node:path, and the existing
 * session-manager helper for writing the binding. No new dependencies.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getSessionIdCanonical, setCurrentSessionBinding } from '../session/session-manager.js';
import type {
  ReconcileOptions,
  ReconcileResult,
  SessionEntry
} from './reconcile-types.js';

const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/;
const META_FILE = 'session.json';

// Sub-agent state file basenames (slice 2026-06-06-sub-agent-spawn-bug-and-decouple).
// The legacy location was `.peaks/<sid>/system/<filename>`; the canonical new
// location is `.peaks/_sub_agents/<sid>/<filename>`. `migrateSubAgentState`
// moves the two files between these homes on every `reconcileWorkspace` run.
const SUB_AGENT_MIGRATION_FILES: ReadonlyArray<string> = [
  'subagent-progress.json',
  'progress-spawn.json'
];
const SUB_AGENTS_DIR = '_sub_agents';

// As of slice 2026-06-05-peaks-runtime-layer these old paths are the
// back-compat read-only fallbacks; the canonical new home is
// `.peaks/_runtime/`. `migrateOldRuntimeState` moves them to the new
// location on disk. The leading dot is dropped when computing the
// new basename (e.g. `.session.json` → `session.json`), so the new
// layout is `.peaks/_runtime/{session.json,active-skill.json,sop-state/}`.
const RUNTIME_OLD_PATHS: ReadonlyArray<string> = [
  '.session.json',
  '.active-skill.json',
  'sop-state'
];
const RUNTIME_DIR = join('.peaks', '_runtime');

/**
 * Map a legacy path basename (e.g. `.session.json`) to its canonical
 * new basename (e.g. `session.json`). The dot is dropped so the new
 * layer reads naturally. Directories pass through unchanged.
 */
function runtimeNewBasename(oldBasename: string): string {
  if (oldBasename.startsWith('.') && oldBasename.length > 1) {
    return oldBasename.slice(1);
  }
  return oldBasename;
}

/**
 * Walk the project root's `.peaks/` directory and return an entry per
 * session dir matching the standard naming pattern, sorted by name
 * ascending (the most recent is last by sort order, since the date
 * prefix dominates the lexicographic order).
 *
 * Each entry's `lastActivity` is the mtime of the inner `session.json`
 * file, or null if that file is missing. `artifactCount` is the count
 * of files under the dir excluding `session.json` itself.
 */
export function discoverSessions(projectRoot: string): SessionEntry[] {
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime');
  const peaksRoot = join(projectRoot, '.peaks');
  // As of slice 003, the canonical home for session dirs is
  // `.peaks/_runtime/<sid>/`. The legacy top-level layout is
  // read for back-compat (one minor release) so pre-migration
  // trees keep working. Both are scanned; duplicates (same sid
  // in both homes) are de-duplicated with the canonical home
  // winning.
  const seen = new Set<string>();
  const entries: SessionEntry[] = [];

  const collect = (root: string): void => {
    if (!existsSync(root)) return;
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      return;
    }
    for (const name of names) {
      if (!SESSION_ID_PATTERN.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      scanSessionDir(root, name, entries);
    }
  };

  collect(runtimeRoot);
  collect(peaksRoot);

  entries.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return entries;
}

function scanSessionDir(peaksRoot: string, name: string, entries: SessionEntry[]): void {
  const dir = join(peaksRoot, name);
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return;
  }
  if (!stat.isDirectory()) return;

  const metaPath = join(dir, META_FILE);
  let lastActivity: number | null = null;
  if (existsSync(metaPath)) {
    try {
      lastActivity = statSync(metaPath).mtimeMs;
    } catch {
      lastActivity = null;
    }
  }

  let childNames: string[];
  try {
    childNames = readdirSync(dir);
  } catch {
    childNames = [];
  }
  let artifactCount = 0;
  for (const child of childNames) {
    if (child === META_FILE) continue;
    artifactCount += 1;
  }

  entries.push({ sessionId: name, path: dir, lastActivity, artifactCount });
}


/**
 * 4-tier canonical selection. Tiers evaluated in order; first one that
 * yields a session id wins.
 *
 *   1. active-skill sessionId, if it matches a real entry
 *   2. entry with the most recent `session.json` mtime
 *   3. entry with the most recent mtime of any file inside it
 *   4. entry whose dir name sorts last lexicographically
 */
export function pickCanonicalSession(
  entries: SessionEntry[],
  activeSkillSessionId: string | null
): { sessionId: string; source: ReconcileResult['canonicalSource'] } | null {
  if (entries.length === 0) return null;

  // Tier 1
  if (activeSkillSessionId !== null) {
    const hit = entries.find((e) => e.sessionId === activeSkillSessionId);
    if (hit !== undefined) {
      return { sessionId: hit.sessionId, source: 'active-skill' };
    }
  }

  // Tier 2
  let tier2Best: { sessionId: string; lastActivity: number } | null = null;
  for (const e of entries) {
    if (e.lastActivity === null) continue;
    if (tier2Best === null || e.lastActivity > tier2Best.lastActivity) {
      tier2Best = { sessionId: e.sessionId, lastActivity: e.lastActivity };
    }
  }
  if (tier2Best !== null) {
    return { sessionId: tier2Best.sessionId, source: 'latest-session-json-mtime' };
  }

  // Tier 3
  let tier3Best: { sessionId: string; path: string } | null = null;
  let tier3Mtime = -Infinity;
  for (const e of entries) {
    const mtime = newestMtimeRecursive(e.path);
    if (mtime === null) continue;
    if (mtime > tier3Mtime) {
      tier3Mtime = mtime;
      tier3Best = { sessionId: e.sessionId, path: e.path };
    }
  }
  if (tier3Best !== null) {
    return { sessionId: tier3Best.sessionId, source: 'latest-any-file-mtime' };
  }

  // Tier 4
  const sortedAsc = [...entries].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const last = sortedAsc[sortedAsc.length - 1];
  if (last !== undefined) {
    return { sessionId: last.sessionId, source: 'dir-name-sort' };
  }

  return null;
}

function newestMtimeRecursive(dirPath: string): number | null {
  let best: number | null = null;
  let stack: string[] = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const childPath = join(current, name);
      let stat;
      try {
        stat = statSync(childPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(childPath);
        continue;
      }
      if (stat.mtimeMs > (best ?? -Infinity)) {
        best = stat.mtimeMs;
      }
    }
  }
  return best;
}

/**
 * Write `.peaks/.session.json` to bind the project to `canonicalSessionId`.
 * Preserves the projectRoot. The previous binding is returned so the CLI
 * can surface the re-point delta.
 */
export function repointSessionJson(
  projectRoot: string,
  canonicalSessionId: string,
  repointedFrom: string | null
): { repointedFrom: string | null; repointedTo: string } {
  setCurrentSessionBinding(projectRoot, canonicalSessionId);
  return { repointedFrom, repointedTo: canonicalSessionId };
}

/**
 * Identify deletion candidates. A session is a candidate when:
 *   - the resolved `lastActivity` is older than `ageThresholdMs`, AND
 *   - the dir is "empty or auto-only" (artifactCount === 0, OR the
 *     only file is `session.json` which is auto-generated).
 *
 * If `lastActivity` is null (no `session.json` inside), the session's
 * own dir mtime is used as a fallback so empty dirs without inner
 * metadata are still fair-game.
 */
export function findDeletionCandidates(
  entries: SessionEntry[],
  ageThresholdMs: number
): SessionEntry[] {
  const now = Date.now();
  const candidates: SessionEntry[] = [];
  for (const e of entries) {
    const isEmptyOrAutoOnly = e.artifactCount === 0;
    if (!isEmptyOrAutoOnly) continue;
    const mtime =
      e.lastActivity !== null
        ? e.lastActivity
        : readDirMtime(e.path);
    if (mtime === null) continue;
    if (now - mtime < ageThresholdMs) continue;
    candidates.push(e);
  }
  return candidates;
}

function readDirMtime(dirPath: string): number | null {
  try {
    return statSync(dirPath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Apply or report deletion of the given candidates. When `apply` is
 * false, just return `wouldDelete` and do not touch disk. When `apply`
 * is true, actually `rm -rf` each dir and accumulate any per-dir
 * errors in the result.
 */
export function applyDeletions(
  candidates: SessionEntry[],
  apply: boolean
): { deleted: string[]; wouldDelete: string[]; errors: Array<{ sessionId: string; message: string }> } {
  if (!apply) {
    return {
      deleted: [],
      wouldDelete: candidates.map((c) => c.sessionId),
      errors: []
    };
  }

  const deleted: string[] = [];
  const errors: Array<{ sessionId: string; message: string }> = [];
  for (const c of candidates) {
    try {
      rmSync(c.path, { recursive: true, force: true });
      deleted.push(c.sessionId);
    } catch (error) {
      errors.push({
        sessionId: c.sessionId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { deleted, wouldDelete: [], errors };
}

/**
 * Read the orchestrator's active-skill marker and extract the
 * session id. As of slice 2026-06-05-peaks-runtime-layer the
 * canonical home is `.peaks/_runtime/active-skill.json`; the legacy
 * `.peaks/.active-skill.json` is consulted as a one-minor-release
 * back-compat fallback (the new path wins when both exist).
 *
 * Returns null when the file is missing or malformed.
 */
function readActiveSkillSessionId(projectRoot: string): string | null {
  const newPath = join(projectRoot, '.peaks', '_runtime', 'active-skill.json');
  const legacyPath = join(projectRoot, '.peaks', '.active-skill.json');
  const pathToRead = existsSync(newPath) ? newPath : legacyPath;
  if (!existsSync(pathToRead)) return null;
  try {
    // Sync read: tiny file, no I/O benefit from async
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const raw = readFileSync(pathToRead, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0) {
      return parsed.sessionId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Sync the single `change/<canonicalSessionId>/` live marker under
 * `.peaks/_runtime/change/`. The marker is an EMPTY directory (no
 * symlinks, no manifest, no content). Slice 006 collapses the F3
 * per-change-id symlink layer to a single live marker so the
 * `change/` layer is a single sentinel — easy for the LLM to
 * navigate, easy for tests to assert on.
 *
 * Steps:
 *   1. Ensure `.peaks/_runtime/change/` exists.
 *   2. List its entries.
 *   3. Remove every entry whose name is NOT `<canonicalSessionId>/`
 *      (no-op for those whose name matches).
 *   4. If `<canonicalSessionId>/` is missing, create it (empty).
 *   5. Return the diff for telemetry.
 *
 * Path-traversal guards: the canonical session id is validated by
 * the caller (`SESSION_ID_PATTERN` in the session-manager helper).
 * The function only ever operates under the project-root-resolved
 * `.peaks/_runtime/change/` dir, so the resolved paths cannot
 * escape the project tree.
 *
 * @returns `{ removed, created, error }`:
 *   - `removed`: list of entry names that were deleted (e.g. `['<oldSid>/']`).
 *   - `created`: name of the new marker (e.g. `'<newSid>/'`) or null
 *     when the canonical marker already existed (no-op).
 *   - `error`: error message string or null.
 */
export function syncChangeMarker(
  projectRoot: string,
  canonicalSessionId: string
): { removed: string[]; created: string | null; error: string | null } {
  const root = resolve(projectRoot);
  const changeDir = join(root, '.peaks', '_runtime', 'change');
  const removed: string[] = [];
  let created: string | null = null;
  let error: string | null = null;

  try {
    if (!existsSync(changeDir)) {
      mkdirSync(changeDir, { recursive: true });
    }
    const markerPath = join(changeDir, canonicalSessionId);
    let existingNames: string[] = [];
    try {
      existingNames = readdirSync(changeDir);
    } catch {
      existingNames = [];
    }
    for (const name of existingNames) {
      if (name === canonicalSessionId) continue;
      const stale = join(changeDir, name);
      try {
        rmSync(stale, { recursive: true, force: true });
        removed.push(name);
      } catch (e) {
        // Best-effort: a single un-deletable entry must not abort the
        // sync (the caller gets the rest of the diff).
        error = e instanceof Error ? e.message : String(e);
      }
    }
    if (!existsSync(markerPath)) {
      mkdirSync(markerPath, { recursive: true });
      created = canonicalSessionId;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { removed, created, error };
}

/**
 * One-time migration step (added in slice 2026-06-05-peaks-runtime-layer).
 *
 * Move the legacy runtime files at:
 *   - `.peaks/.session.json`
 *   - `.peaks/.active-skill.json`
 *   - `.peaks/sop-state/`
 * into their new canonical home at:
 *   - `.peaks/_runtime/session.json`
 *   - `.peaks/_runtime/active-skill.json`
 *   - `.peaks/_runtime/sop-state/`
 *
 * Behavior:
 *   - Idempotent: re-running on a tree that is already on the new
 *     layout produces `migratedFiles: []`.
 *   - Best-effort: uses `fs.renameSync` (atomic on POSIX, best-effort
 *     on Windows) and falls back to `copyFileSync` + `unlinkSync` if
 *     rename throws (e.g. cross-device move on Windows). Errors are
 *     collected per file and returned in the `errors` array so the
 *     reconcile envelope can surface them without blocking the rest of
 *     the migration.
 *   - Creates `.peaks/_runtime/` on demand if any of the old paths
 *     are present.
 *
 * @returns `{ migratedFiles, errors }`. `migratedFiles` lists the
 *   *old* relative paths (e.g. `.peaks/.session.json`) that were
 *   successfully moved, in move order. `errors` lists per-file
 *   failures with the old path and a human-readable message.
 */
export function migrateOldRuntimeState(projectRoot: string): { migratedFiles: string[]; errors: Array<{ path: string; message: string }> } {
  const root = resolve(projectRoot);
  const peaksRoot = join(root, '.peaks');
  const newDir = join(root, RUNTIME_DIR);
  const migratedFiles: string[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  for (const rel of RUNTIME_OLD_PATHS) {
    const oldPath = join(peaksRoot, rel);
    if (!existsSync(oldPath)) continue;
    // Skip if the corresponding new path already exists — we treat the
    // new path as authoritative when both exist, so the old file would
    // only be stale data.
    const newPath = join(newDir, runtimeNewBasename(rel));
    if (existsSync(newPath)) {
      // Best-effort cleanup of the stale old file so a re-run stays
      // idempotent and the tree converges on the new layout.
      try {
        rmSync(oldPath, { recursive: true, force: true });
      } catch (error) {
        errors.push({
          path: rel,
          message: `Could not remove stale legacy file after migration: ${error instanceof Error ? error.message : String(error)}`
        });
      }
      continue;
    }
    try {
      // Ensure the new parent dir exists. `mkdirSync(dirname(newPath), { recursive: true })`
      // covers both the file case (`.peaks/_runtime`) and the
      // directory case (`.peaks/_runtime/sop-state`).
      mkdirSync(dirname(newPath), { recursive: true });
      try {
        renameSync(oldPath, newPath);
      } catch (renameError) {
        // Cross-device or locked-file fallback: copy + unlink.
        const stat = lstatSync(oldPath);
        if (stat.isDirectory()) {
          // Recursive copy for the sop-state dir.
          copyDirRecursiveSync(oldPath, newPath);
          rmSync(oldPath, { recursive: true, force: true });
        } else {
          copyFileSync(oldPath, newPath);
          unlinkSync(oldPath);
        }
      }
      migratedFiles.push(join('.peaks', rel));
    } catch (error) {
      errors.push({
        path: rel,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { migratedFiles, errors };
}

function copyDirRecursiveSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const childSrc = join(src, name);
    const childDest = join(dest, name);
    const stat = lstatSync(childSrc);
    if (stat.isDirectory()) {
      copyDirRecursiveSync(childSrc, childDest);
    } else {
      copyFileSync(childSrc, childDest);
    }
  }
}

/**
 * One-time sub-agent state migration (slice 2026-06-06-sub-agent-spawn-bug-and-decouple).
 *
 * Move the legacy per-session sub-agent state files at:
 *   - `.peaks/<sid>/system/subagent-progress.json`
 *   - `.peaks/<sid>/system/progress-spawn.json`
 * into the new canonical home at:
 *   - `.peaks/_sub_agents/<sid>/subagent-progress.json`
 *   - `.peaks/_sub_agents/<sid>/progress-spawn.json`
 *
 * Behavior:
 *   - Idempotent: re-running on a tree that is already on the new layout
 *     produces `migratedFiles: []`.
 *   - Best-effort: uses `fs.renameSync` and falls back to `copyFileSync +
 *     unlinkSync` if rename throws (e.g. cross-device move on Windows).
 *   - Empty `<sid>/system/` dir removal (R-2 guard): the legacy `system/`
 *     subdir is only removed when it has zero other files, so a tree where
 *     the user had unrelated content in `system/` is left untouched.
 *   - New-path-wins: when both old and new files exist, the old file is
 *     removed (the new path is authoritative).
 *
 * Walks every discovered session — not just the canonical one — so a user
 * with 6 pre-migration sessions gets all of them migrated in one reconcile
 * pass.
 *
 * @returns `{ migratedFiles, errors }`. `migratedFiles` lists the *old*
 *   relative paths (e.g. `.peaks/<sid>/system/subagent-progress.json`) that
 *   were successfully moved. `errors` lists per-file failures.
 */
export function migrateSubAgentState(projectRoot: string): { migratedFiles: string[]; errors: Array<{ path: string; message: string }> } {
  const root = resolve(projectRoot);
  const newDir = join(root, '.peaks', SUB_AGENTS_DIR);
  const migratedFiles: string[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  for (const session of discoverSessions(projectRoot)) {
    const oldSystemDir = join(session.path, 'system');
    if (!existsSync(oldSystemDir)) continue;
    const newSessionDir = join(newDir, session.sessionId);
    mkdirSync(newSessionDir, { recursive: true });
    for (const fname of SUB_AGENT_MIGRATION_FILES) {
      const oldPath = join(oldSystemDir, fname);
      const newPath = join(newSessionDir, fname);
      if (!existsSync(oldPath)) continue;
      if (existsSync(newPath)) {
        // New path is authoritative; remove stale old file.
        try { rmSync(oldPath, { force: true }); } catch { /* best effort */ }
        continue;
      }
      try {
        try {
          renameSync(oldPath, newPath);
        } catch (renameError) {
          // Cross-device or locked-file fallback: copy + unlink.
          copyFileSync(oldPath, newPath);
          unlinkSync(oldPath);
        }
        migratedFiles.push(join('.peaks', session.sessionId, 'system', fname));
      } catch (error) {
        errors.push({
          path: oldPath,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    // R-2 guard: only remove the legacy system/ dir when it has zero
    // remaining files (the user might have unrelated content there).
    try {
      const remaining = readdirSync(oldSystemDir);
      if (remaining.length === 0) {
        rmdirSync(oldSystemDir);
      }
    } catch { /* best effort */ }
  }
  return { migratedFiles, errors };
}

/**
 * Top-level orchestrator. Wires migration (added in slice
 * 2026-06-05-peaks-runtime-layer), discovery, canonical pick, re-point,
 * deletion-candidate selection, and deletion into a single result.
 */
export function reconcileWorkspace(options: ReconcileOptions): ReconcileResult {
  const projectRoot = resolve(options.projectRoot);
  const apply = options.apply === true;
  const ageThresholdMs = options.olderThanMs;

  // Migration runs FIRST. The canonical-session logic still consults
  // the session-manager helper which already reads the new path first
  // and falls back to the old path; moving the old file out of the way
  // before that read means the new path is the only path observed by
  // `getSessionIdCanonical` after this call returns.
  const migration = migrateOldRuntimeState(projectRoot);
  const subAgentMigration = migrateSubAgentState(projectRoot);
  const migrateErrors: Array<{ kind: 'migrate'; path: string; message: string }> = [
    ...migration.errors.map((e) => ({
      kind: 'migrate' as const,
      path: e.path,
      message: e.message
    })),
    ...subAgentMigration.errors.map((e) => ({
      kind: 'migrate' as const,
      path: e.path,
      message: e.message
    }))
  ];

  const sessions = discoverSessions(projectRoot);
  const activeSkillSessionId = readActiveSkillSessionId(projectRoot);
  const canonical = pickCanonicalSession(sessions, activeSkillSessionId);

  const previousBinding = getSessionIdCanonical(projectRoot);
  let repointedFrom: string | null = previousBinding;
  let repointedTo: string | null = null;
  let repointed = false;

  if (canonical !== null) {
    if (previousBinding !== canonical.sessionId) {
      const repoint = repointSessionJson(projectRoot, canonical.sessionId, previousBinding);
      repointedFrom = repoint.repointedFrom;
      repointedTo = repoint.repointedTo;
      repointed = true;
    } else {
      // No-op: re-point the same binding so lastActivity is refreshed
      const repoint = repointSessionJson(projectRoot, canonical.sessionId, previousBinding);
      repointedFrom = repoint.repointedFrom;
      repointedTo = repoint.repointedTo;
    }
  }

  const deletionCandidates = findDeletionCandidates(sessions, ageThresholdMs);
  const deletionResult = applyDeletions(deletionCandidates, apply);

  // Slice 006: sync the single `change/<canonicalSessionId>/` live
  // marker (replaces the F3 per-change-id symlink layer). The marker
  // is an empty dir; the function removes every other entry under
  // `.peaks/_runtime/change/`. Idempotent. This step is independent
  // of the apply flag — syncing the marker is a derived-state write,
  // not a destructive side effect.
  const changeMarker = canonical === null
    ? { removed: [] as string[], created: null as string | null, error: 'no canonical session' as string | null }
    : syncChangeMarker(projectRoot, canonical.sessionId);

  // Slice 006: clean up the F3-introduced `.peaks/_runtime/<sid>/system/`
  // subdir under EVERY session dir (not just the canonical one). The
  // subdir was created eagerly by `initWorkspace` (F3) but was never
  // used. The cleanup is idempotent: re-running on a tree without the
  // subdir is a no-op. We walk every discovered session, not just the
  // canonical one, because the user has 6 F3 sessions with the cruft
  // and the spec says all of them must be removed. Logged in the
  // systemCleaned array.
  const systemCleaned: string[] = [];
  for (const session of sessions) {
    const systemDir = join(session.path, 'system');
    if (existsSync(systemDir)) {
      try {
        rmSync(systemDir, { recursive: true, force: true });
        systemCleaned.push(systemDir);
      } catch {
        // Best-effort: a locked subdir does not block the rest of reconcile.
      }
    }
  }

  return {
    projectRoot,
    sessions,
    canonicalSessionId: canonical === null ? null : canonical.sessionId,
    canonicalSource: canonical === null ? null : canonical.source,
    repointedFrom,
    repointedTo,
    deletionCandidates,
    deleted: deletionResult.deleted,
    wouldDelete: deletionResult.wouldDelete,
    ageThresholdMs,
    apply,
    repointed,
    migratedFiles: migration.migratedFiles,
    subAgentStateMigrated: subAgentMigration.migratedFiles.length,
    errors: [...migrateErrors, ...deletionResult.errors],
    changeMarker,
    systemCleaned
  };
}
