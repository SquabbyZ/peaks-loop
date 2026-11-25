/**
 * The bounded source walk the S7 audit uses, split out of `audit-project.ts`.
 *
 * It is deliberately small and dependency-free: an app-relative, sorted file
 * list for one root and an extension set, with installed/generated directories
 * skipped and any path that escapes the app root dropped. The audit does not
 * follow a markup page's import closure here; that gap is named in
 * `audit-project.ts`'s header rather than hidden here.
 *
 * TWO GAPS ARE REPORTED, NEVER SWALLOWED (Task 6e). A directory whose entries
 * cannot be read is named in the caller's `gaps`, because a permission-denied
 * subtree otherwise looks empty and a partial read can be reported clean. A
 * walk that hits `maxFiles` says so in the same list instead of silently
 * truncating.
 */

import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import { isInsidePath, normalizePath } from '../../../shared/path-utils.js';

/** Installed and generated trees are never the project's own UI source. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out']);

/** One directory's entries, and whether the directory could be read at all. */
type EntryRead = { entries: Dirent[]; readable: boolean };

function readEntries(dir: string): EntryRead {
  try {
    return { entries: readdirSync(dir, { withFileTypes: true }), readable: true };
  } catch {
    return { entries: [], readable: false };
  }
}

/** The app-relative path of a walked file, or null when it escapes the app. */
function appRelative(appRoot: string, absolute: string): string | null {
  const rel = relative(appRoot, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return normalizePath(rel);
}

/** The state one bounded walk shares across directories. */
type WalkState = {
  appRoot: string;
  extensions: ReadonlySet<string>;
  maxFiles: number;
  gaps: string[];
  pending: string[];
  files: string[];
  truncated: boolean;
};

/** One directory's entries: subdirectories to walk, wanted files to record. */
function visitDirectory(state: WalkState, dir: string): void {
  const read = readEntries(dir);
  if (!read.readable) {
    state.gaps.push(
      `${appRelative(state.appRoot, dir) ?? normalizePath(dir)} (unreadable directory)`
    );
    return;
  }
  for (const entry of read.entries) {
    if (state.files.length >= state.maxFiles) {
      state.truncated = true;
      return;
    }
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) state.pending.push(absolute);
      continue;
    }
    if (!entry.isFile() || !state.extensions.has(extname(entry.name).toLowerCase())) continue;
    const rel = appRelative(state.appRoot, absolute);
    if (rel !== null) state.files.push(rel);
  }
}

/** The options a bounded walk accepts; absent means "no gap sink, no cap". */
export type WalkOptions = {
  /** Receives one line per unreadable directory and one per cap hit. */
  gaps?: string[];
  /** Hard bound on recorded files; the default bounds a hostile tree. */
  maxFiles?: number;
};

/** The default walk bound: a 10k-file UI tree is already pathological. */
export const DEFAULT_MAX_WALK_FILES = 20000;

/** Every file under `root` whose extension is wanted, app-relative and sorted. */
export function walkFiles(
  appRoot: string,
  root: string,
  extensions: ReadonlySet<string>,
  options: WalkOptions = {}
): string[] {
  const start = resolve(appRoot, root);
  if (!isInsidePath(start, appRoot) || !existsSync(start)) return [];
  const state: WalkState = {
    appRoot,
    extensions,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_WALK_FILES,
    gaps: options.gaps ?? [],
    pending: [start],
    files: [],
    truncated: false
  };
  while (state.pending.length > 0) {
    const dir = state.pending.pop();
    if (dir !== undefined) visitDirectory(state, dir);
    if (state.truncated) break;
  }
  if (state.truncated) {
    state.gaps.push(`${normalizePath(root)} (walk stopped at its ${state.maxFiles}-file bound)`);
  }
  return state.files.sort((left, right) => left.localeCompare(right));
}
