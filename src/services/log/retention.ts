/**
 * 7-day log rotation for peaks-loop.
 *
 * Slice 2026-06-16-cli-logging (G2). Cheapest possible rotation:
 * daily files are named by UTC date, so a "new day" automatically
 * means a new file. The retention sweep runs at the start of every
 * peaks-loop invocation and removes any `peaks-loop-*.log` whose
 * UTC date is more than `retentionDays` days behind today.
 *
 * No external dep — `fs.readdirSync` + `statSync.mtimeMs` (or, for
 * the name-derived path, parse the YYYY-MM-DD from the file name).
 * We prefer the file NAME (not mtime) so a user who copies an old
 * log back into the directory does not have it re-deleted on the
 * next sweep.
 */

import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLogDir } from './logger.js';
import { cleanupStaleCache } from '../agent/ecc-cache-service.js';

const LOG_FILE_NAME_PATTERN = /^peaks-loop-(\d{4}-\d{2}-\d{2})\.log$/;

function dayDiffUtc(nowUtcMidnightMs: number, fileDateUtcMs: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((nowUtcMidnightMs - fileDateUtcMs) / dayMs);
}

function utcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export type ApplyRetentionOptions = {
  /** Number of days to keep. Defaults to 7. */
  retentionDays?: number;
  /** Wall-clock for tests. Defaults to `Date.now()`. */
  nowMs?: number;
  /** Override log dir (used by tests). */
  dirOverride?: string;
};

/**
 * Delete any `peaks-loop-YYYY-MM-DD.log` file in the log dir whose
 * UTC date is more than `retentionDays` days older than today.
 * Returns the absolute paths of the deleted files (for tests +
 * observability).
 *
 * The function is best-effort: a per-file unlink failure is
 * silently swallowed (the file may have been removed by another
 * process between the `readdir` and the `unlink`).
 */
export function applyRetention(opts: ApplyRetentionOptions = {}): string[] {
  const retentionDays = opts.retentionDays ?? 7;
  const now = opts.nowMs ?? Date.now();
  const logDir = opts.dirOverride ?? resolveLogDir();

  if (!existsSync(logDir)) return [];

  let names: string[];
  try {
    names = readdirSync(logDir);
  } catch {
    return [];
  }

  const nowUtcMidnight = utcMidnightMs(new Date(now));
  const removed: string[] = [];

  for (const name of names) {
    const match = LOG_FILE_NAME_PATTERN.exec(name);
    if (match === null) continue;
    const dateStr = match[1];
    if (dateStr === undefined) continue;
    const fileDateUtcMs = Date.parse(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(fileDateUtcMs)) continue;

    const diff = dayDiffUtc(nowUtcMidnight, fileDateUtcMs);
    if (diff > retentionDays) {
      const fullPath = join(logDir, name);
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) continue;
        unlinkSync(fullPath);
        removed.push(fullPath);
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
        /* best-effort: file removed by another process or perms denied */
      }
    }
  }

  return removed;
}

/**
 * Slice 3 (on-demand-ecc) — 7-day TTL sweep over `~/.peaks/cache/ecc-<sha>/`
 * directories. Delegates to `cleanupStaleCache` in the ECC cache
 * service so the retention policy lives next to the cache it
 * governs.
 *
 * Mirrors the `applyRetention` signature for symmetry: tests pass
 * `nowMs` + `dirOverride`; production callers leave both unset.
 */
export function cleanupEccCache(options: {
  retentionDays: number;
  nowMs?: number;
  dirOverride?: string;
}): { removed: string[] } {
  return cleanupStaleCache({
    retentionDays: options.retentionDays,
    nowMs: options.nowMs ?? Date.now(),
    ...(options.dirOverride !== undefined ? { dirOverride: options.dirOverride } : {}),
  });
}
