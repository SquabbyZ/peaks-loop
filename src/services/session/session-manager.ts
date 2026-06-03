/**
 * Session management service for Peaks artifact storage.
 * Manages session lifecycle: creation, retrieval, and directory initialization.
 *
 * Sessions are automatically created when any skill is invoked.
 * Each session gets a unique directory under .peaks/ with incrementing numbered files.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

const SESSION_FILE = '.session.json';
const META_FILE = 'session.json';

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
 * Get the path to the session file for a project.
 */
function getSessionFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', SESSION_FILE);
}

/**
 * Read existing session info from disk.
 * Returns null if no session file exists or if it's invalid.
 */
function readSessionFile(projectRoot: string): SessionInfo | null {
  const sessionFile = getSessionFilePath(projectRoot);
  if (!existsSync(sessionFile)) return null;

  try {
    const data = JSON.parse(readFileSync(sessionFile, 'utf8'));
    if (data.sessionId && data.projectRoot === projectRoot) {
      return data as SessionInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write session info to disk.
 */
function writeSessionFile(projectRoot: string, info: SessionInfo): void {
  const sessionFile = getSessionFilePath(projectRoot);
  const dir = join(projectRoot, '.peaks');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(sessionFile, JSON.stringify(info, null, 2), 'utf8');
}

/**
 * Drop the project-level session binding (`.peaks/.session.json`)
 * so the next `ensureSession()` call auto-generates a fresh
 * session id. The on-disk session directory is left intact —
 * rotating does NOT delete the user's data, it just unbinds the
 * project from that session.
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
  return join(projectRoot, '.peaks', sessionId, 'rd', 'project-scan.md');
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

  const scanPath = join(projectRoot, '.peaks', info.sessionId, 'rd', 'project-scan.md');
  return existsSync(scanPath);
}
