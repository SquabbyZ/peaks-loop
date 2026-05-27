/**
 * Session management service for Peaks artifact storage.
 * Manages session lifecycle: creation, retrieval, and directory initialization.
 *
 * Sessions are automatically created when any skill is invoked.
 * Each session gets a unique directory under .peaks/ with incrementing numbered files.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { initWorkspace } from '../workspace/workspace-service.js';

export type SessionInfo = {
  sessionId: string;
  createdAt: string;
  projectRoot: string;
};

const SESSION_FILE = '.session.json';

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
 * Get or create the current session for a project.
 * If a valid session already exists, returns it.
 * Otherwise, creates a new session with auto-generated ID.
 *
 * @param projectRoot - Root directory of the project
 * @returns Session ID (e.g., "2026-05-26-session-a3f8b1")
 */
export async function ensureSession(projectRoot: string): Promise<string> {
  const existing = readSessionFile(projectRoot);
  if (existing) {
    return existing.sessionId;
  }

  const sessionId = generateSessionId();
  const info: SessionInfo = {
    sessionId,
    createdAt: new Date().toISOString(),
    projectRoot
  };

  writeSessionFile(projectRoot, info);

  await initWorkspace({ projectRoot, sessionId });

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
