// ---------------------------------------------------------------------------
// Filesystem path safety helpers.
//
// All read/write paths in the project-memory-service flow through these
// guards. The contract:
//
//   - `normalizeRoot` — collapses a caller-supplied project root into the
//     canonical form the rest of the codebase expects (handles input-path
//     quirks from the path-utils layer).
//   - `realPathOrThrow` — refuses symlinks and missing paths. Throws with
//     a stable message so callers can distinguish "missing" from "escape
//     attempt".
//   - `assertInsideProject` — confirms an artifact path resolves inside
//     the project root after realpath, throwing the same kind of error
//     message realPathOrThrow uses.
//   - `assertSafeProjectMemoryDir` — confirms `.peaks/memory/` exists (or
//     can be returned without creation) AND it is not a symlink and its
//     realpath lives inside the project root. Returns the joined path.
//   - `assertSafeSessionDir` — symmetric for `.peaks/_runtime/<sid>/`.
//     Distinguishes benign "not found" (returns `SESSION_DIR_NOT_FOUND`
//     sentinel message) from "escapes project root" (throws hard).
//
// All helpers are pure (no side effects other than throwing).
// ---------------------------------------------------------------------------

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import {
  isInsidePath,
  isWindowsAbsolutePath,
  normalizePath,
  resolveInputPath,
  stableRealPath
} from '../../../../shared/path-utils.js';
import { getSessionDir } from '../../../session/getSessionDir.js';

export function normalizeRoot(path: string): string {
  return resolveInputPath(path);
}

export function normalizeRealRoot(path: string): string {
  return stableRealPath(path);
}

export function realPathOrThrow(path: string, errorMessage: string): string {
  if (!existsSync(path)) {
    throw new Error(errorMessage);
  }
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error(errorMessage);
  }
  return realpathSync(path);
}

export function resolveProjectPath(path: string, projectRoot: string): string {
  if (isWindowsAbsolutePath(path)) return normalizePath(path);
  if (isAbsolute(path)) return resolve(path);
  const resolvedPath = join(projectRoot, path);
  return isWindowsAbsolutePath(projectRoot) ? normalizePath(resolvedPath) : resolve(resolvedPath);
}

export function assertInsideProject(path: string, projectRoot: string): string {
  const resolvedRoot = normalizeRoot(projectRoot);
  const resolvedPath = resolveProjectPath(path, resolvedRoot);
  const realProjectRoot = realPathOrThrow(resolvedRoot, 'Project root is not accessible');
  const realArtifactPath = realPathOrThrow(resolvedPath, 'Artifact path must stay inside the project root');
  if (!isInsidePath(realArtifactPath, realProjectRoot)) {
    throw new Error('Artifact path must stay inside the project root');
  }
  return resolvedPath;
}

export function assertSafeProjectMemoryDir(projectRoot: string): string {
  const resolvedRoot = normalizeRoot(projectRoot);
  const realRoot = normalizeRealRoot(projectRoot);
  const peaksDir = join(resolvedRoot, '.peaks');
  if (existsSync(peaksDir) && lstatSync(peaksDir).isSymbolicLink()) {
    throw new Error('Project memory directory must stay inside the project root');
  }

  const memoryDir = join(peaksDir, 'memory');
  if (existsSync(memoryDir)) {
    if (lstatSync(memoryDir).isSymbolicLink()) {
      throw new Error('Project memory directory must stay inside the project root');
    }
    const realMemoryDir = realpathSync(memoryDir);
    if (!isInsidePath(realMemoryDir, realRoot)) {
      throw new Error('Project memory directory must stay inside the project root');
    }
    return memoryDir;
  }

  return memoryDir;
}

export function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

export function assertSafeSessionDir(projectRoot: string, sessionId: string): string {
  const normalizedRoot = normalizeRoot(projectRoot);
  const realRoot = normalizeRealRoot(projectRoot);
  const sessionDir = getSessionDir(normalizedRoot, sessionId);
  if (!existsSync(sessionDir)) {
    // Distinguish "not found" (caller will treat as no-op) from "escapes project
    // root" (caller must surface a hard error). We probe by checking whether the
    // joined path, after realpath, would still be inside the project root.
    if (isAbsolute(getSessionDir(normalizedRoot, sessionId))) {
      const realJoined = safeRealpath(getSessionDir(normalizedRoot, sessionId));
      if (realJoined && !isInsidePath(realJoined, realRoot)) {
        throw new Error('Session directory must stay inside the project root');
      }
    }
    throw new Error('SESSION_DIR_NOT_FOUND');
  }
  const stats = lstatSync(sessionDir);
  if (stats.isSymbolicLink()) {
    throw new Error('Session directory must stay inside the project root');
  }
  const realSessionDir = realpathSync(sessionDir);
  if (!isInsidePath(realSessionDir, realRoot)) {
    throw new Error('Session directory must stay inside the project root');
  }
  return sessionDir;
}