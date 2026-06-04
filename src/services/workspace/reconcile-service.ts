/**
 * Reconcile service for `.peaks/2026-MM-DD-session-<6hex>/` directories.
 *
 * Reconcile scans the project root's `.peaks/` directory, identifies a
 * canonical session via a 4-tier heuristic, re-points
 * `.peaks/.session.json`, and (optionally, with apply === true)
 * deletes empty / abandoned session dirs older than olderThanMs.
 *
 * Pure hand-rolled; uses only node:fs, node:path, and the existing
 * session-manager helper for writing the binding. No new dependencies.
 */

import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getSessionIdCanonical, setCurrentSessionBinding } from '../session/session-manager.js';
import type {
  ReconcileOptions,
  ReconcileResult,
  SessionEntry
} from './reconcile-types.js';

const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/;
const META_FILE = 'session.json';

/**
 * Walk the project root's `.peaks/` directory and return an entry per
 * session dir matching the standard naming pattern, sorted by name
 * ascending (the most recent is last by sort order, since the date
 * prefix dominates the lexicographic order).
 *
 * Each entry's `lastActivity` is the mtime of the inner `session.json`
 * file, or null if that file is missing. `artifactCount` is the count
 * of files under the dir excluding `session.json` itself.
 */
export function discoverSessions(projectRoot: string): SessionEntry[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];

  let names: string[];
  try {
    names = readdirSync(peaksRoot);
  } catch {
    return [];
  }

  const entries: SessionEntry[] = [];
  for (const name of names) {
    if (!SESSION_ID_PATTERN.test(name)) continue;
    const dir = join(peaksRoot, name);
    let stat;
    try {
      // lstatSync: false for symlinks (prevents rm -rf from following a
      // malicious symlink that points outside the project root).
      stat = lstatSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const metaPath = join(dir, META_FILE);
    let lastActivity: number | null = null;
    if (existsSync(metaPath)) {
      try {
        lastActivity = statSync(metaPath).mtimeMs;
      } catch {
        lastActivity = null;
      }
    }

    let childNames: string[];
    try {
      childNames = readdirSync(dir);
    } catch {
      childNames = [];
    }
    let artifactCount = 0;
    for (const child of childNames) {
      if (child === META_FILE) continue;
      artifactCount += 1;
    }

    entries.push({ sessionId: name, path: dir, lastActivity, artifactCount });
  }

  entries.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return entries;
}

/**
 * 4-tier canonical selection. Tiers evaluated in order; first one that
 * yields a session id wins.
 *
 *   1. active-skill sessionId, if it matches a real entry
 *   2. entry with the most recent `session.json` mtime
 *   3. entry with the most recent mtime of any file inside it
 *   4. entry whose dir name sorts last lexicographically
 */
export function pickCanonicalSession(
  entries: SessionEntry[],
  activeSkillSessionId: string | null
): { sessionId: string; source: ReconcileResult['canonicalSource'] } | null {
  if (entries.length === 0) return null;

  // Tier 1
  if (activeSkillSessionId !== null) {
    const hit = entries.find((e) => e.sessionId === activeSkillSessionId);
    if (hit !== undefined) {
      return { sessionId: hit.sessionId, source: 'active-skill' };
    }
  }

  // Tier 2
  let tier2Best: { sessionId: string; lastActivity: number } | null = null;
  for (const e of entries) {
    if (e.lastActivity === null) continue;
    if (tier2Best === null || e.lastActivity > tier2Best.lastActivity) {
      tier2Best = { sessionId: e.sessionId, lastActivity: e.lastActivity };
    }
  }
  if (tier2Best !== null) {
    return { sessionId: tier2Best.sessionId, source: 'latest-session-json-mtime' };
  }

  // Tier 3
  let tier3Best: { sessionId: string; path: string } | null = null;
  let tier3Mtime = -Infinity;
  for (const e of entries) {
    const mtime = newestMtimeRecursive(e.path);
    if (mtime === null) continue;
    if (mtime > tier3Mtime) {
      tier3Mtime = mtime;
      tier3Best = { sessionId: e.sessionId, path: e.path };
    }
  }
  if (tier3Best !== null) {
    return { sessionId: tier3Best.sessionId, source: 'latest-any-file-mtime' };
  }

  // Tier 4
  const sortedAsc = [...entries].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const last = sortedAsc[sortedAsc.length - 1];
  if (last !== undefined) {
    return { sessionId: last.sessionId, source: 'dir-name-sort' };
  }

  return null;
}

function newestMtimeRecursive(dirPath: string): number | null {
  let best: number | null = null;
  let stack: string[] = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const childPath = join(current, name);
      let stat;
      try {
        stat = statSync(childPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(childPath);
        continue;
      }
      if (stat.mtimeMs > (best ?? -Infinity)) {
        best = stat.mtimeMs;
      }
    }
  }
  return best;
}

/**
 * Write `.peaks/.session.json` to bind the project to `canonicalSessionId`.
 * Preserves the projectRoot. The previous binding is returned so the CLI
 * can surface the re-point delta.
 */
export function repointSessionJson(
  projectRoot: string,
  canonicalSessionId: string,
  repointedFrom: string | null
): { repointedFrom: string | null; repointedTo: string } {
  setCurrentSessionBinding(projectRoot, canonicalSessionId);
  return { repointedFrom, repointedTo: canonicalSessionId };
}

/**
 * Identify deletion candidates. A session is a candidate when:
 *   - the resolved `lastActivity` is older than `ageThresholdMs`, AND
 *   - the dir is "empty or auto-only" (artifactCount === 0, OR the
 *     only file is `session.json` which is auto-generated).
 *
 * If `lastActivity` is null (no `session.json` inside), the session's
 * own dir mtime is used as a fallback so empty dirs without inner
 * metadata are still fair-game.
 */
export function findDeletionCandidates(
  entries: SessionEntry[],
  ageThresholdMs: number
): SessionEntry[] {
  const now = Date.now();
  const candidates: SessionEntry[] = [];
  for (const e of entries) {
    const isEmptyOrAutoOnly = e.artifactCount === 0;
    if (!isEmptyOrAutoOnly) continue;
    const mtime =
      e.lastActivity !== null
        ? e.lastActivity
        : readDirMtime(e.path);
    if (mtime === null) continue;
    if (now - mtime < ageThresholdMs) continue;
    candidates.push(e);
  }
  return candidates;
}

function readDirMtime(dirPath: string): number | null {
  try {
    return statSync(dirPath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Apply or report deletion of the given candidates. When `apply` is
 * false, just return `wouldDelete` and do not touch disk. When `apply`
 * is true, actually `rm -rf` each dir and accumulate any per-dir
 * errors in the result.
 */
export function applyDeletions(
  candidates: SessionEntry[],
  apply: boolean
): { deleted: string[]; wouldDelete: string[]; errors: Array<{ sessionId: string; message: string }> } {
  if (!apply) {
    return {
      deleted: [],
      wouldDelete: candidates.map((c) => c.sessionId),
      errors: []
    };
  }

  const deleted: string[] = [];
  const errors: Array<{ sessionId: string; message: string }> = [];
  for (const c of candidates) {
    try {
      rmSync(c.path, { recursive: true, force: true });
      deleted.push(c.sessionId);
    } catch (error) {
      errors.push({
        sessionId: c.sessionId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { deleted, wouldDelete: [], errors };
}

/**
 * Read `.peaks/.active-skill.json` to extract the orchestrator's
 * session id. Returns null when the file is missing or malformed.
 */
function readActiveSkillSessionId(projectRoot: string): string | null {
  const path = join(projectRoot, '.peaks', '.active-skill.json');
  if (!existsSync(path)) return null;
  try {
    // Sync read: tiny file, no I/O benefit from async
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0) {
      return parsed.sessionId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Top-level orchestrator. Wires discovery, canonical pick, re-point,
 * deletion-candidate selection, and deletion into a single result.
 */
export function reconcileWorkspace(options: ReconcileOptions): ReconcileResult {
  const projectRoot = resolve(options.projectRoot);
  const apply = options.apply === true;
  const ageThresholdMs = options.olderThanMs;

  const sessions = discoverSessions(projectRoot);
  const activeSkillSessionId = readActiveSkillSessionId(projectRoot);
  const canonical = pickCanonicalSession(sessions, activeSkillSessionId);

  const previousBinding = getSessionIdCanonical(projectRoot);
  let repointedFrom: string | null = previousBinding;
  let repointedTo: string | null = null;
  let repointed = false;

  if (canonical !== null) {
    if (previousBinding !== canonical.sessionId) {
      const repoint = repointSessionJson(projectRoot, canonical.sessionId, previousBinding);
      repointedFrom = repoint.repointedFrom;
      repointedTo = repoint.repointedTo;
      repointed = true;
    } else {
      // No-op: re-point the same binding so lastActivity is refreshed
      const repoint = repointSessionJson(projectRoot, canonical.sessionId, previousBinding);
      repointedFrom = repoint.repointedFrom;
      repointedTo = repoint.repointedTo;
    }
  }

  const deletionCandidates = findDeletionCandidates(sessions, ageThresholdMs);
  const deletionResult = applyDeletions(deletionCandidates, apply);

  return {
    projectRoot,
    sessions,
    canonicalSessionId: canonical === null ? null : canonical.sessionId,
    canonicalSource: canonical === null ? null : canonical.source,
    repointedFrom,
    repointedTo,
    deletionCandidates,
    deleted: deletionResult.deleted,
    wouldDelete: deletionResult.wouldDelete,
    ageThresholdMs,
    apply,
    repointed,
    errors: deletionResult.errors
  };
}
