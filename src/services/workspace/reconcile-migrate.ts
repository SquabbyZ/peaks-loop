/**
 * Migration helpers extracted from `reconcile-service.ts`
 * (slice 2026-09-06-split-batch-b) so the service stays under the
 * 800-line cap. Behaviour-preserving verbatim move.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// Call-time-only dependency on the sibling service: `migrateSubAgentState`
// walks every discovered session via `discoverSessions`, which is invoked
// only at call time (after both modules have fully evaluated), so the
// value-level circular import is safe under ESM live bindings.
import { discoverSessions } from './reconcile-service.js';

// Sub-agent state file basenames (slice 2026-06-06-sub-agent-spawn-bug-and-decouple).
// The legacy location was `.peaks/_runtime/<sid>/system/<filename>`; the canonical new
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
 *   - `.peaks/_runtime/<sid>/system/subagent-progress.json`
 *   - `.peaks/_runtime/<sid>/system/progress-spawn.json`
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
 *   relative paths (e.g. `.peaks/_runtime/<sid>/system/subagent-progress.json`) that
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
        try { rmSync(oldPath, { force: true }); } catch { /* best effort */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
    } catch { /* best effort */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  }
  return { migratedFiles, errors };
}
