// src/services/codegraph/codegraph-foreign-removal.ts
//
// The one destructive act `peaks codegraph init --force` performs: removing a
// `.codegraph/` that peaks-loop does not own, so a fresh managed index can take
// its place.
//
// Why deletion and not a backup: the owner's ruling on 2026-10-05. Another
// tool's SQLite file copied to `.codegraph.bak` inside the project root leaves
// two divergent indices where there was one, and sibling backups at a project
// root are exactly what this repo's memory-shape and codegraph-containment
// guards exist to prevent. The caller who passes `--force` has decided the
// foreign directory should go; the CLI says plainly what it deleted.
//
// Two refusals make that safe to hand to a flag:
//   - a `.codegraph` that is itself a link (symlink, or a Windows junction —
//     `lstat` reports both) is never removed. Following it would delete files
//     the project root was only pointing at, which is a different thing from
//     replacing a directory the project owns. Containment alone does not catch
//     it: a junction may legitimately point somewhere INSIDE the root.
//   - a directory carrying the peaks-loop marker is never removed. `--force`
//     replaces a FOREIGN index; aimed at our own it would be an index-wipe
//     wearing an init's name.

import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  CODEGRAPH_DIR_NAME,
  CODEGRAPH_MARKER_NAME,
  defaultCodegraphInitGuard,
  type CodegraphInitGuardResult
} from './codegraph-service.js';

/** Reported by the CLI as `CODEGRAPH_FOREIGN_REMOVAL_REFUSED`. */
export class ForeignCodegraphRemovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForeignCodegraphRemovalError';
  }
}

/**
 * Remove `<projectRoot>/.codegraph` and return the path that was deleted.
 * Throws `ForeignCodegraphRemovalError` for a link or for a
 * peaks-loop-managed directory.
 */
export function removeForeignCodegraphDir(projectRoot: string): string {
  // The LEXICAL path, deliberately: `assertCodegraphDirContained` hands back a
  // REALPATH, and removing what a realpath points at would delete the target
  // of a junction — the opposite of the refusal below.
  const codegraphDir = join(resolve(projectRoot), CODEGRAPH_DIR_NAME);

  let stats;
  try {
    stats = lstatSync(codegraphDir);
  } catch {
    throw new ForeignCodegraphRemovalError(
      `nothing to remove at ${codegraphDir}: it does not exist, so --force had no foreign ` +
        '.codegraph/ directory to replace.'
    );
  }

  // A junction reports `isSymbolicLink()` on Windows and a plain symlink does
  // on POSIX, so one check covers both. `rmSync` on a link removes the link
  // and leaves the target — but the caller asked to replace the project's
  // `.codegraph`, and replacing a link means the project now points at nothing,
  // which is not an init anyone agreed to.
  if (stats.isSymbolicLink()) {
    throw new ForeignCodegraphRemovalError(
      `refusing to remove ${codegraphDir}: it is a link (symlink or Windows junction). Delete the ` +
        'link yourself, then re-run `peaks codegraph init`.'
    );
  }

  if (stats.isDirectory() && existsSync(join(codegraphDir, CODEGRAPH_MARKER_NAME))) {
    throw new ForeignCodegraphRemovalError(
      `refusing to remove ${codegraphDir}: it carries the peaks-loop marker, so this is ` +
        'peaks-loop-owned index data, not a foreign directory. --force replaces a foreign ' +
        '.codegraph/ only.'
    );
  }

  rmSync(codegraphDir, { recursive: true, force: true });
  return codegraphDir;
}

/**
 * Remove the foreign directory and re-run the init guard, so the caller sees an
 * ordinary fresh init. Kept next to the removal because the two are one
 * decision: what `--force` means is "replace it, then continue as if it had
 * never been foreign".
 */
export function forcePastForeignConflict(projectRoot: string): {
  removed: string;
  outcome: CodegraphInitGuardResult;
} {
  const removed = removeForeignCodegraphDir(projectRoot);
  return { removed, outcome: defaultCodegraphInitGuard(projectRoot) };
}
