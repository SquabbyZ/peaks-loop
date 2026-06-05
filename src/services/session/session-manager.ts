/**
 * Session management service for Peaks artifact storage.
 * Manages session lifecycle: creation, retrieval, and directory initialization.
 *
 * Sessions are automatically created when any skill is invoked.
 * Each session gets a unique directory under .peaks/ with incrementing numbered files.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { initWorkspace } from '../workspace/workspace-service.js';

export type SessionInfo = {
  sessionId: string;
  createdAt: string;
  projectRoot: string;
};

export type SessionMeta = {
  sessionId: string;
  title?: string;
  skill?: string;
  mode?: string;
  gate?: string;
  createdAt: string;
  lastActivity?: string;
  projectRoot: string;
  /**
   * The outer (harness / IDE / plugin) session id that
   * `ensureSession` was called from. Sourced from
   * `PEAKS_OUTER_SESSION_ID` env var, with `CLAUDE_CODE_SESSION_ID`
   * as a Claude-Code fallback. Stamped once at session creation;
   * later presence writes can compare against this to detect an
   * outer-session swap and AskUserQuestion the user about rolling
   * a new peaks session. Sessions predating the field simply
   * have it undefined; presence-mismatch detection skips those
   * (no false positives on legacy data).
   */
  outerSessionId?: string;
};

// As of slice 2026-06-05-peaks-runtime-layer the project-level session
// binding lives under `.peaks/_runtime/session.json`. The legacy
// `.peaks/.session.json` path is preserved as a read-only fallback for one
// minor release so older CLI versions (or trees that have not been migrated
// by `peaks workspace reconcile`) keep working without a forced re-init.
const SESSION_FILE = join('_runtime', 'session.json');
const LEGACY_SESSION_FILE = '.session.json';
const META_FILE = 'session.json';

function getLegacySessionFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', LEGACY_SESSION_FILE);
}

/**
 * Canonicalize a project root path. Returns the realpath
 * (resolving all symlinks — important on macOS where `/var`
 * is a symlink to `/private/var`, and on the dev box where
 * `/tmp` is the same `/private/var/folders/...` target as
 * `/var/folders/...`). If the path does not exist (e.g. in
 * tests that write the binding before the dir, or callers
 * that pass a non-existent path), falls back to the
 * `resolve()`d absolute form so the function NEVER throws.
 */
function canonicalizeProjectRoot(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Resolve a stored `projectRoot` value (from
 * `.peaks/.session.json`) against the caller-passed
 * `projectRoot`, then canonicalize. Handles two forms the
 * legacy strict-equality check missed:
 *
 *   1. **Stored is relative** (e.g. `"."` when the binding
 *      was written from inside the project dir). We resolve
 *      it against the caller — if the caller's project root
 *      is absolute, `path.resolve(caller, ".")` returns the
 *      caller's absolute form, which then canonicalizes to
 *      the caller's realpath.
 *
 *   2. **Both are absolute but the stored form is not
 *      canonical** (e.g. `/var/folders/...` vs
 *      `/private/var/folders/...` on macOS). Both canonicalize
 *      to the same realpath.
 *
 * The combined check is the canonicalize-on-read contract.
 */
function resolveStoredAgainstCaller(stored: string, caller: string): string {
  const resolved = resolve(caller, stored); // if `stored` is absolute, returns `stored`; else joins with caller
  return canonicalizeProjectRoot(resolved);
}

/**
 * Generate a new session ID.
 * Format: YYYY-MM-DD-session-<6位hex>
 * Example: 2026-05-26-session-a3f8b1
 */
function generateSessionId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  const random = randomBytes(3).toString('hex'); // 6位hex
  return `${date}-session-${random}`;
}

/**
 * Get the path to the session file for a project. The canonical home is
 * `.peaks/_runtime/session.json`; the legacy `.peaks/.session.json` is
 * read-only fallback (see `readSessionFile`).
 */
function getSessionFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', SESSION_FILE);
}

/**
 * Read existing session info from disk.
 * Returns null if no session file exists or if it's invalid.
 *
 * Strict equality on `data.projectRoot === projectRoot` is
 * preserved here on purpose: many other modules (notably
 * `shared/change-id.ts` via `buildArtifactRelativePath`)
 * depend on the strict-equality semantics to test the
 * "no session bound" code path. Changing the read semantics
 * here would cascade into ~30 test failures in those
 * modules — out of scope for the progress rebind fix.
 *
 * The progress subcommands (which are the surface that
 * actually breaks on the rebind bug) use
 * `getSessionIdCanonical` instead, which does the
 * canonicalize-on-read resolution the bug fix needs.
 */
function readSessionFile(projectRoot: string): SessionInfo | null {
  const sessionFile = getSessionFilePath(projectRoot);
  const legacyFile = getLegacySessionFilePath(projectRoot);
  // Back-compat window: prefer the new canonical path; fall back to the
  // legacy `.peaks/.session.json` so older CLI versions or pre-migration
  // trees keep working. When both exist, the new path wins.
  const pathToRead = existsSync(sessionFile) ? sessionFile : legacyFile;
  if (!existsSync(pathToRead)) return null;

  try {
    const data = JSON.parse(readFileSync(pathToRead, 'utf8'));
    if (data.sessionId && data.projectRoot === projectRoot) {
      return data as SessionInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Same as `readSessionFile` but canonicalizes BOTH the
 * caller-passed and stored `projectRoot` before comparing.
 * See `resolveStoredAgainstCaller` for the rules.
 *
 * Exported as `readSessionFileCanonical` so the new
 * `getSessionIdCanonical` can use it; not part of the
 * public API otherwise.
 */
function readSessionFileCanonical(projectRoot: string): SessionInfo | null {
  const sessionFile = getSessionFilePath(projectRoot);
  const legacyFile = getLegacySessionFilePath(projectRoot);
  // Back-compat window: prefer the new canonical path; fall back to the
  // legacy `.peaks/.session.json` for one minor release.
  const pathToRead = existsSync(sessionFile) ? sessionFile : legacyFile;
  if (!existsSync(pathToRead)) return null;

  try {
    const data = JSON.parse(readFileSync(pathToRead, 'utf8'));
    const storedRaw = typeof data.projectRoot === 'string' ? data.projectRoot : null;
    if (
      data.sessionId &&
      storedRaw !== null &&
      resolveStoredAgainstCaller(storedRaw, projectRoot) === resolveStoredAgainstCaller(projectRoot, projectRoot)
    ) {
      return data as SessionInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write session info to disk at the canonical new path
 * `.peaks/_runtime/session.json`. The `.peaks/_runtime/` directory is
 * created on demand. The legacy `.peaks/.session.json` is NOT written by
 * this slice; it is only read for back-compat.
 */
function writeSessionFile(projectRoot: string, info: SessionInfo): void {
  const sessionFile = getSessionFilePath(projectRoot);
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(sessionFile, JSON.stringify(info, null, 2), 'utf8');
}

/**
 * Drop the project-level session binding at the canonical
 * `.peaks/_runtime/session.json` so the next `ensureSession()` call
 * auto-generates a fresh session id. The on-disk session directory
 * is left intact — rotating does NOT delete the user's data, it
 * just unbinds the project from that session. Also drops the legacy
 * `.peaks/.session.json` if present so a stale read from another
 * tool cannot re-bind the project after rotation.
 *
 * Returns the id of the session that was unbound, or `null` if
 * no binding was present. The caller is expected to do something
 * with that — at minimum surface it in the CLI response so the
 * user can find the directory again if they need to.
 */
export function rotateSessionBinding(projectRoot: string): string | null {
  const previous = readSessionFile(projectRoot);
  if (previous === null) {
    return null;
  }
  const sessionFile = getSessionFilePath(projectRoot);
  if (existsSync(sessionFile)) {
    unlinkSync(sessionFile);
  }
  const legacyFile = getLegacySessionFilePath(projectRoot);
  if (existsSync(legacyFile)) {
    try {
      unlinkSync(legacyFile);
    } catch {
      // best-effort: a stale legacy binding is not blocking
    }
  }
  return previous.sessionId;
}

/**
 * Bind the project's current session to the given session id by writing
 * `.peaks/.session.json`. The single-session binding is the source of truth
 * for `ensureSession()` and any other path that needs to discover the
 * active session without an explicit --session-id flag.
 *
 * This does NOT touch the per-session `session.json` inside `.peaks/<id>/`;
 * that file is owned by `setSessionMeta` and records session-scoped
 * metadata (title, skill, mode, gate, etc.).
 */
export function setCurrentSessionBinding(projectRoot: string, sessionId: string): SessionInfo {
  const info: SessionInfo = {
    sessionId,
    createdAt: new Date().toISOString(),
    projectRoot
  };
  writeSessionFile(projectRoot, info);
  return info;
}

function getMetaFilePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', sessionId, META_FILE);
}

function readSessionMeta(projectRoot: string, sessionId: string): SessionMeta | null {
  const metaPath = getMetaFilePath(projectRoot, sessionId);
  if (!existsSync(metaPath)) return null;

  try {
    const raw = readFileSync(metaPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.sessionId !== 'string' || parsed.sessionId.length === 0) {
      return null;
    }
    return parsed as SessionMeta;
  } catch {
    return null;
  }
}

function writeSessionMeta(projectRoot: string, sessionId: string, meta: SessionMeta): void {
  const metaPath = getMetaFilePath(projectRoot, sessionId);
  const metaDir = join(projectRoot, '.peaks', sessionId);
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Read metadata for a specific session directory.
 * Returns null if the session directory or its session.json does not exist.
 */
export function getSessionMeta(projectRoot: string, sessionId: string): SessionMeta | null {
  return readSessionMeta(projectRoot, sessionId);
}

/**
 * Write or update metadata for a session.  Fields besides sessionId and createdAt
 * are merged on top of the current meta (partial update).
 */
export function setSessionMeta(projectRoot: string, sessionId: string, partial: Partial<Omit<SessionMeta, 'sessionId' | 'createdAt' | 'projectRoot'>>): SessionMeta {
  const existing = readSessionMeta(projectRoot, sessionId);
  const now = new Date().toISOString();

  const meta: SessionMeta = existing
    ? { ...existing, ...partial, lastActivity: now }
    : {
        sessionId,
        projectRoot,
        createdAt: now,
        ...partial,
        lastActivity: now
      };

  writeSessionMeta(projectRoot, sessionId, meta);
  return meta;
}

/**
 * Set the display title for a session directory.
 */
export function setSessionTitle(projectRoot: string, sessionId: string, title: string): SessionMeta {
  return setSessionMeta(projectRoot, sessionId, { title });
}

/**
 * List all session directories under .peaks with their metadata.
 * Returns sessions sorted by sessionId descending (most recent first).
 */
export function listSessionMetas(projectRoot: string): SessionMeta[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];

  const entries = readdirSync(peaksRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/.test(entry.name))
    .map((entry) => {
      const meta = readSessionMeta(projectRoot, entry.name);
      return meta ?? {
        sessionId: entry.name,
        projectRoot,
        createdAt: ''
      };
    })
    .sort((a, b) => b.sessionId.localeCompare(a.sessionId));
}

/**
 * Get or create the current session for a project.
 * If a valid session already exists, returns it.
 * Otherwise, creates a new session with auto-generated ID.
 *
 * @param projectRoot - Root directory of the project
 * @returns Session ID (e.g., "2026-05-26-session-a3f8b1")
 */
function getCurrentOuterSessionId(): string | undefined {
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return undefined;
}

export async function ensureSession(projectRoot: string): Promise<string> {
  const existing = readSessionFile(projectRoot);
  if (existing) {
    return existing.sessionId;
  }

  const sessionId = generateSessionId();
  const now = new Date().toISOString();
  const info: SessionInfo = {
    sessionId,
    createdAt: now,
    projectRoot
  };

  writeSessionFile(projectRoot, info);

  await initWorkspace({ projectRoot, sessionId });

  // Initialize session metadata inside the session directory
  const outerSessionId = getCurrentOuterSessionId();
  writeSessionMeta(projectRoot, sessionId, {
    sessionId,
    projectRoot,
    createdAt: now,
    ...(outerSessionId !== undefined ? { outerSessionId } : {})
  });

  return sessionId;
}

/**
 * Get the current session ID without creating a new one.
 * Returns null if no session exists.
 *
 * @param projectRoot - Root directory of the project
 * @returns Session ID or null
 */
export function getSessionId(projectRoot: string): string | null {
  const info = readSessionFile(projectRoot);
  return info?.sessionId ?? null;
}

/**
 * Resolve the current session id with canonicalize-on-read
 * semantics. This is the variant the progress subcommands
 * (step / watch / start / close) use, because the legacy
 * `getSessionId` returns null any time the stored
 * `projectRoot` form differs from the caller-passed form
 * (e.g. stored is "." from inside the project dir; caller
 * is the absolute realpath). When `getSessionId` returns
 * null, callers like `ensureSession` create a brand-new
 * session and overwrite the binding — which is what the
 * user observed as the "mid-dogfood rebind" bug.
 *
 * The fix is to canonicalize both sides of the compare
 * (realpath, then optionally resolve relative stored
 * against the caller's project root). The two forms of
 * the same physical directory now compare equal, and the
 * existing binding is found instead of being overwritten.
 *
 * Use this instead of `getSessionId` only when the
 * caller is operating on a user-supplied `--project` flag
 * and the binding may have been written by a CLI invocation
 * that was running from inside the project dir (the common
 * peaks-solo / peaks-sop scenario). Other modules depend
 * on the strict-equality semantics of `getSessionId` (the
 * "no binding" fallback path is part of their contract),
 * so this variant is opt-in.
 */
export function getSessionIdCanonical(projectRoot: string): string | null {
  const info = readSessionFileCanonical(projectRoot);
  return info?.sessionId ?? null;
}

/**
 * Get the absolute path to the current session directory.
 * Creates the session if it doesn't exist.
 *
 * @param projectRoot - Root directory of the project
 * @returns Absolute path to session directory (e.g., "/path/to/project/.peaks/2026-05-26-session-a3f8b1")
 */
export async function getCurrentSessionDir(projectRoot: string): Promise<string> {
  const sessionId = await ensureSession(projectRoot);
  return join(projectRoot, '.peaks', sessionId);
}

/**
 * List all session directories in the .peaks folder.
 * Returns session IDs (directory names) sorted by date.
 *
 * @param projectRoot - Root directory of the project
 * @returns Array of session IDs
 */
export function listSessions(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];

  const { readdirSync } = require('node:fs');
  const entries = readdirSync(peaksRoot, { withFileTypes: true });

  return entries
    .filter((entry: any) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/.test(entry.name))
    .map((entry: any) => entry.name)
    .sort()
    .reverse(); // Most recent first
}

/**
 * Get the path to project-scan.md for the current session.
 * Creates the session if it doesn't exist.
 *
 * @param projectRoot - Root directory of the project
 * @returns Absolute path to project-scan.md
 */
export async function getProjectScanPath(projectRoot: string): Promise<string> {
  const sessionId = await ensureSession(projectRoot);
  // As of slice 2026-06-05-change-id-as-unit-of-work the session dir
  // is at the canonical runtime location (gitignored). The scan is a
  // session-local artifact; it lives alongside the rest of the
  // ephemeral state under `_runtime/`. The parent `rd/` subdir is
  // created on demand so the first scanner call has a place to land
  // (consistent with the legacy behavior pre-1.3.1).
  const scanPath = join(projectRoot, '.peaks', '_runtime', sessionId, 'rd', 'project-scan.md');
  await mkdirAsync(dirname(scanPath), { recursive: true });
  return scanPath;
}

/**
 * Check if project-scan.md exists for the current session.
 *
 * @param projectRoot - Root directory of the project
 * @returns true if project-scan.md exists
 */
export function hasProjectScan(projectRoot: string): boolean {
  const info = readSessionFile(projectRoot);
  if (!info) return false;

  // Canonical runtime location of the session dir (slice 2026-06-05).
  const scanPath = join(projectRoot, '.peaks', '_runtime', info.sessionId, 'rd', 'project-scan.md');
  return existsSync(scanPath);
}
