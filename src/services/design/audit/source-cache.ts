/**
 * The per-run source reader the S7 audit shares across pages (Task 6e).
 *
 * Two problems this solves at once.
 *
 *   SPEED. Every page used to re-read its whole import closure: the pilot issued
 *   5,459 reads for 895 distinct files. This cache reads each real file once and
 *   returns the SAME `AuditSource` object to every page that needs it, so the
 *   per-object view cache (`source-view.ts`) computes `stripViews` and line
 *   starts once per file instead of once per page-and-detector.
 *
 *   CONTAINMENT. The closure and the stylesheet reader used to check containment
 *   LEXICALLY and then follow a symlink, reading a file outside the app root. A
 *   path is now resolved with `realpathSync` first and the REAL path is checked
 *   against the REAL app root; a target that escapes is reported (never read).
 *   A source larger than `MAX_SOURCE_BYTES` is skipped and reported too, so one
 *   multi-gigabyte file cannot be loaded and re-scanned.
 */

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { isInsidePath, normalizePath, stableRealPath } from '../../../shared/path-utils.js';
import { MAX_SOURCE_BYTES } from '../file-cap.js';
import type { AuditSource } from './audit-finding.js';

/** One source file larger than this is not read; the cap is reported. */
export { MAX_SOURCE_BYTES };

/** Where a requested path lands after symlinks are resolved. */
export type Located =
  | { kind: 'inside'; file: string; real: string; size: number }
  | { kind: 'missing' }
  | { kind: 'escapes'; file: string };

/** What one read produced; a non-read is a gap the caller must report. */
export type SourceRead =
  | { kind: 'read'; source: AuditSource }
  | { kind: 'missing' }
  | { kind: 'escapes'; file: string }
  | { kind: 'oversize'; file: string; bytes: number };

export type SourceCache = {
  /** Real containment and size for a path, without reading it. */
  locate(path: string): Located;
  /** Read one path, cached by real path; a non-read is a gap, never silence. */
  read(path: string): SourceRead;
};

/** The two maps and the resolved root one run's cache owns. */
type CacheState = {
  root: string;
  rootReal: string;
  located: Map<string, Located>;
  reads: Map<string, SourceRead>;
};

function absoluteOf(appRoot: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(appRoot, path);
}

/** The app-relative name a gap message can cite, even for an escaping target. */
function displayPath(appRoot: string, absolute: string): string {
  const rel = relative(appRoot, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return normalizePath(absolute);
  return normalizePath(rel);
}

/** The real app root, or the resolved one when it does not exist yet. */
function realRootOf(root: string): string {
  try {
    return stableRealPath(root);
  } catch {
    return root;
  }
}

/** Resolve a path to its real location and check containment at that location. */
function locateIn(state: CacheState, path: string): Located {
  const absolute = absoluteOf(state.root, path);
  const cached = state.located.get(absolute);
  if (cached !== undefined) return cached;
  let real: string;
  try {
    real = stableRealPath(absolute);
  } catch {
    const missing: Located = { kind: 'missing' };
    state.located.set(absolute, missing);
    return missing;
  }
  if (!isInsidePath(real, state.rootReal)) {
    const escapes: Located = { kind: 'escapes', file: displayPath(state.rootReal, absolute) };
    state.located.set(absolute, escapes);
    return escapes;
  }
  let size = 0;
  try {
    size = statSync(real).size;
  } catch {
    const missing: Located = { kind: 'missing' };
    state.located.set(absolute, missing);
    return missing;
  }
  const inside: Located = {
    kind: 'inside',
    file: normalizePath(relative(state.rootReal, real)),
    real,
    size
  };
  state.located.set(absolute, inside);
  return inside;
}

/** Read one located file, keyed by its real path so two spellings share a body. */
function readIn(state: CacheState, path: string): SourceRead {
  const where = locateIn(state, path);
  if (where.kind !== 'inside') return where;
  if (where.size > MAX_SOURCE_BYTES) {
    return { kind: 'oversize', file: where.file, bytes: where.size };
  }
  const cached = state.reads.get(where.real);
  if (cached !== undefined) return cached;
  let result: SourceRead;
  try {
    result = {
      kind: 'read',
      source: { file: where.file, source: readFileSync(where.real, 'utf8') }
    };
  } catch {
    result = { kind: 'missing' };
  }
  state.reads.set(where.real, result);
  return result;
}

/** One real app root and the two maps a run needs. */
export function createSourceCache(appRoot: string): SourceCache {
  const root = resolve(appRoot);
  const state: CacheState = {
    root,
    rootReal: realRootOf(root),
    located: new Map<string, Located>(),
    reads: new Map<string, SourceRead>()
  };
  return {
    locate: (path: string): Located => locateIn(state, path),
    read: (path: string): SourceRead => readIn(state, path)
  };
}
