/**
 * Polyrepo scanner — slice S2-b of RD-2.
 *
 * Walks a parent directory looking for child git repos. A "child
 * git repo" is defined as: a directory that contains a `.git`
 * entry (file or directory — worktrees + submodules both qualify),
 * is NOT the root itself, and sits at depth 1 from the root.
 *
 * Depth is intentionally bounded to 1 (per the PRD §4.3 model):
 *   parent/
 *     .peaks/
 *     frontend/.git
 *     backend/.git
 * We do not recurse into nested monorepos in this slice — that is
 * a future-slice concern.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import type { PolyrepoChild, PolyrepoManifest } from './polyrepo-types.js';

export interface ScanOptions {
  /** Explicit list of child directory names (relative to root). When
   *  provided, the scanner uses these instead of auto-discovery.
   *  Matches the `peaks polyrepo init --children <dir1,dir2>` shape. */
  readonly explicitChildren?: readonly string[];
}

function isGitRoot(dir: string): boolean {
  // A `.git` directory (normal repo) OR a `.git` file (worktree +
  // submodule pointer) both count. statSync follows the pointer for
  // a `.git` file, so the existence check is the same.
  return existsSync(join(dir, '.git'));
}

function childHasPeaks(dir: string): boolean {
  return existsSync(join(dir, '.peaks'));
}

/** Sanitize a candidate child id: lowercase, dash-joined, no
 *  leading dots or dashes. Used when the dir name itself is the id
 *  (the common case). */
function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

/** Walk the parent root at depth 1 and return discovered children. */
export function scanPolyrepo(root: string, opts: ScanOptions = {}): PolyrepoManifest {
  const absRoot = resolve(root);
  if (!existsSync(absRoot)) {
    throw new Error(`polyrepo root does not exist: ${absRoot}`);
  }
  const rootStat = statSync(absRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`polyrepo root is not a directory: ${absRoot}`);
  }

  const children: PolyrepoChild[] = [];

  if (opts.explicitChildren !== undefined && opts.explicitChildren.length > 0) {
    // Explicit mode: only consider the named subdirs. This matches
    // `peaks polyrepo init --children ./frontend,./backend`.
    for (const name of opts.explicitChildren) {
      const childPath = resolve(absRoot, name);
      if (!existsSync(childPath)) {
        throw new Error(`polyrepo child directory does not exist: ${childPath}`);
      }
      const s = statSync(childPath);
      if (!s.isDirectory()) {
        throw new Error(`polyrepo child path is not a directory: ${childPath}`);
      }
      children.push({
        id: sanitizeId(basename(childPath)),
        path: childPath,
        gitRoot: isGitRoot(childPath),
        peaksScope: childHasPeaks(childPath) ? 'root+child' : 'child-only',
        peaksInstalled: childHasPeaks(childPath)
      });
    }
  } else {
    // Auto-discovery mode: list immediate entries, filter to dirs with
    // `.git`. This is intentionally narrow — see the file-level
    // rationale at the top of this file.
    const entries = readdirSync(absRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue; // skip .git, .peaks, .vscode, etc.
      const childPath = join(absRoot, entry.name);
      if (!isGitRoot(childPath)) continue;
      children.push({
        id: sanitizeId(entry.name),
        path: childPath,
        gitRoot: true,
        peaksScope: childHasPeaks(childPath) ? 'root+child' : 'child-only',
        peaksInstalled: childHasPeaks(childPath)
      });
    }
  }

  return {
    version: 1,
    root: absRoot,
    detectedAt: new Date().toISOString(),
    children
  };
}