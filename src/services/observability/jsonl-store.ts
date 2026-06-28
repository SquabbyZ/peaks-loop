/**
 * JSONL append-only store for observability events.
 *
 * Slice A of v2.11.1 (slice topology observability). Pure file I/O —
 * no schema knowledge lives here. Schema/validation lives in
 * `observability-service.ts`.
 *
 * Layout: `.peaks/_runtime/<sessionId>/metrics/slices.jsonl` — one file
 * per session, append-only. Mtime-based cross-session prune keeps at
 * most `MAX_METRICS_FILES` files in the repo (mirrors the
 * `peaks session checkpoint` contract).
 *
 * Write path is fire-and-forget: errors (disk full, permission
 * denied, ENOENT mid-write) are swallowed silently per PRD Q4
 * (full-auto must never fail-loud on observability).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getSessionDir } from '../session/getSessionDir.js';

export const METRICS_DIR = 'metrics';
export const METRICS_FILENAME = 'slices.jsonl';
export const MAX_METRICS_FILES = 10;

/** Absolute path to a session's metrics JSONL file. */
export function metricsFilePath(projectRoot: string, sessionId: string): string {
  return join(getSessionDir(projectRoot, sessionId), METRICS_DIR, METRICS_FILENAME);
}

/** Absolute path to a session's metrics directory. */
export function metricsDirPath(projectRoot: string, sessionId: string): string {
  return join(getSessionDir(projectRoot, sessionId), METRICS_DIR);
}

/**
 * Append one line to the session's metrics JSONL file. Creates the
 * directory tree on demand. Returns true on success, false on any
 * error (the caller MUST treat false as "drop silently" per Q4).
 */
export function appendMetricLine(projectRoot: string, sessionId: string, line: string): boolean {
  try {
    const dir = metricsDirPath(projectRoot, sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(metricsFilePath(projectRoot, sessionId), line + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all non-empty lines from a session's metrics JSONL file.
 * Returns [] when the file does not exist. Does NOT parse — callers
 * decide what counts as valid (see `observability-service.ts`
 * `readObservabilityEvents` for the schema-aware reader).
 */
export function readMetricLines(projectRoot: string, sessionId: string): string[] {
  const path = metricsFilePath(projectRoot, sessionId);
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, 'utf8');
  return raw.split(/\r?\n/).filter((line) => line.length > 0);
}

export type SessionMetricsEntry = {
  sessionId: string;
  mtimeMs: number;
  path: string;
};

/**
 * List every session that currently has a metrics JSONL on disk,
 * paired with its mtime. Ordered by sessionId for determinism; the
 * caller decides mtime ordering (see `pruneMetricsFiles`).
 */
export function listSessionDirsWithMetrics(projectRoot: string): SessionMetricsEntry[] {
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime');
  if (!existsSync(runtimeRoot)) {
    return [];
  }
  const out: SessionMetricsEntry[] = [];
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = metricsFilePath(projectRoot, entry.name);
    if (!existsSync(path)) {
      continue;
    }
    out.push({
      sessionId: entry.name,
      mtimeMs: statSync(path).mtimeMs,
      path
    });
  }
  out.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return out;
}

/**
 * Prune the metrics files across all sessions, retaining at most
 * `MAX_METRICS_FILES` by mtime (newest kept). Returns the list of
 * removed absolute paths. Best-effort: a failed removal is silently
 * skipped (matches Q4 fire-and-forget contract).
 */
export function pruneMetricsFiles(projectRoot: string): string[] {
  const all = listSessionDirsWithMetrics(projectRoot);
  if (all.length <= MAX_METRICS_FILES) {
    return [];
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toRemove = all.slice(MAX_METRICS_FILES);
  const removed: string[] = [];
  for (const { path } of toRemove) {
    try {
      rmSync(path, { force: true });
      removed.push(path);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // best-effort: do not throw out of prune
    }
  }
  return removed;
}

export const JSONL_STORE_CONSTANTS = {
  METRICS_DIR,
  METRICS_FILENAME,
  MAX_METRICS_FILES
} as const;