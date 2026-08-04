import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { isWindows, platform, type Platform } from './platform.js';

export const SEP = sep;

const localPathConverters: Record<Platform, (p: string) => string> = {
  win32: (p) => p.replace(/\//g, '\\'),
  darwin: (p) => p,
  linux: (p) => p
};

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function localPath(p: string, targetPlatform: Platform = platform): string {
  return localPathConverters[targetPlatform](p);
}

export function getTempDir(options?: { env?: NodeJS.ProcessEnv }): string {
  const env = options?.env ?? process.env;
  if (env.TEMP) return env.TEMP;
  if (env.TMP) return env.TMP;
  return tmpdir();
}

export function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

export function resolveInputPath(path: string): string {
  return isWindowsAbsolutePath(path) ? normalizePath(path) : resolve(path);
}

export function stableRealPath(path: string): string {
  return realpathSync(resolveInputPath(path));
}

export function stablePath(path: string): string {
  const resolvedPath = resolveInputPath(path);
  if (existsSync(resolvedPath)) {
    return stableRealPath(resolvedPath);
  }

  const parsedPath = parse(resolvedPath);
  const missingSegments: string[] = [];
  let currentPath = resolvedPath;

  while (!existsSync(currentPath) && currentPath !== parsedPath.root) {
    const parsedCurrent = parse(currentPath);
    missingSegments.unshift(parsedCurrent.base);
    currentPath = parsedCurrent.dir;
  }

  const realExistingPath = existsSync(currentPath) ? stableRealPath(currentPath) : parsedPath.root;
  return resolve(realExistingPath, ...missingSegments);
}

/**
 * Build the comparison key for a `projectRoot` value. Two paths that
 * denote the same physical directory MUST produce the same key, and two
 * paths that denote different directories MUST NOT.
 *
 * Composed from the existing `path-utils.ts` primitives; no new
 * dependency. Three normalizations, in order:
 *
 *   1. **Symlink resolution** via `stableRealPath` — collapses macOS
 *      `/var/folders/...` vs `/private/var/folders/...` (`/var` is a
 *      symlink to `/private/var`). Falls back to `resolveInputPath`
 *      when the path does not exist, so this never throws for callers
 *      that pass a not-yet-created root (or a stale binding whose
 *      directory has since been deleted).
 *   2. **Separator folding** via `normalizePath` — collapses the
 *      Windows `C:\Users\...` (written by `peaks workspace init`) vs
 *      `C:/Users/...` (passed by a Git Bash caller) split that was the
 *      original `PEAKS_SESSION_NOT_BOUND` trigger.
 *   3. **Case folding, Windows only** — NTFS is case-insensitive, so
 *      `C:\Foo` and `c:/foo` are the same directory. This step is
 *      guarded on `isWindows` because POSIX filesystems are
 *      case-SENSITIVE: folding case on Linux would make the genuinely
 *      distinct `/tmp/Foo` and `/tmp/foo` compare equal.
 *
 * Note on step 3: `realpathSync` alone is NOT sufficient for the
 * Windows case split. Verified empirically on Node 22 / win32 —
 * `realpathSync('c:\\...\\foo')` echoes the caller's casing, while only
 * `realpathSync.native` case-folds. We do not switch to `.native`
 * because it also rewrites 8.3 short names (`SMALLM~1` → `smallMark`),
 * which would change the on-disk form of every existing binding.
 * Explicit `toLowerCase()` is the narrower, more predictable fix.
 *
 * This is a compare key ONLY — never persist it. The value written to
 * disk stays the real path (see `writeSessionFile`).
 *
 * Lifted from `src/services/session/session-manager.ts` in slice
 * `2026-08-04-rid-002-bridge-canonicalize` so both `session-manager.ts`
 * and `session-binding-bridge.ts` share a single canonicalization
 * authority.
 */
export function projectRootCompareKey(p: string): string {
  let canonical: string;
  try {
    canonical = stableRealPath(p);
  } catch {
    // Path does not exist (yet). Fall back to the resolved absolute
    // form so a binding written before its directory exists — and a
    // binding whose directory was later deleted — still compares by
    // separator + case rather than throwing.
    canonical = resolveInputPath(p);
  }
  const separatorFolded = normalizePath(canonical);
  return isWindows ? separatorFolded.toLowerCase() : separatorFolded;
}

/**
 * Compare two `projectRoot` values under the canonicalization rules
 * documented on `projectRootCompareKey`. Returns true iff both paths
 * canonicalize to the same key — covers symlink resolution, separator
 * folding, and (Windows only) case folding.
 */
export function projectRootsMatch(a: string, b: string): boolean {
  return projectRootCompareKey(a) === projectRootCompareKey(b);
}