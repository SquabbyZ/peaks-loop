/**
 * Service layer for `peaks log tail` and `peaks log ls` subcommands.
 *
 * Slice 2026-06-16-cli-logging (G4). Pure helpers that the
 * commander layer in `src/cli/commands/log-commands.ts` wraps.
 * Separated from `logger.ts` so the surface is small + testable
 * without spinning up a Commander program.
 *
 * Both helpers default to the on-disk log dir (`resolveLogDir()`)
 * but accept an `dirOverride` so tests can pin the home to a
 * tempdir without monkey-patching `os.homedir()`.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildLogFileName, readLogEntries, resolveLogDir, type LogEntry } from './logger.js';

const LOG_FILE_NAME_PATTERN = /^peaks-cli-\d{4}-\d{2}-\d{2}\.log$/;

/**
 * Return all `peaks-cli-*.log` files in the log dir, sorted by
 * date descending (newest first). Returns `[]` when the dir is
 * missing or unreadable. Non-matching entries (e.g. a stray
 * README) are filtered out.
 */
export function listLogFiles(opts: { dirOverride?: string } = {}): string[] {
  const logDir = opts.dirOverride ?? resolveLogDir();
  if (!existsSync(logDir)) return [];
  let names: string[];
  try {
    names = readdirSync(logDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => LOG_FILE_NAME_PATTERN.test(name))
    .filter((name) => {
      try {
        return statSync(join(logDir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
}

export type TailLogOptions = {
  /** Number of trailing lines to return. Defaults to 50. */
  lines?: number;
  /** Override the clock for deterministic tests. */
  now?: () => Date;
  /** Override the log dir (used by tests). */
  dirOverride?: string;
  /** Override the date (PRD AC2: PEAKS_LOG_DATE_OVERRIDE). */
  dateOverride?: string;
};

export type TailLogResult = {
  /** Absolute path to the file that was tailed, or null when no file exists. */
  file: string | null;
  /** The trailing entries (already trimmed to `lines`). */
  entries: LogEntry[];
  /** The total number of entries in the file (for header messaging). */
  total: number;
};

/**
 * Read today's log file and return the last `lines` entries. When
 * no file exists for the given date, returns `{ file: null, entries: [], total: 0 }`.
 */
export function tailLog(opts: TailLogOptions = {}): TailLogResult {
  const lines = opts.lines ?? 50;
  const logDir = opts.dirOverride ?? resolveLogDir();
  const now = opts.now ? opts.now() : new Date();
  const dateForFile = opts.dateOverride !== undefined
    ? new Date(`${opts.dateOverride}T00:00:00.000Z`)
    : now;
  const fileName = buildLogFileName(dateForFile);
  const fullPath = join(logDir, fileName);

  const entries = readLogEntries({
    now: () => now,
    ...(opts.dirOverride !== undefined ? { dirOverride: opts.dirOverride } : {}),
    ...(opts.dateOverride !== undefined ? { dateOverride: opts.dateOverride } : {})
  });
  const total = entries.length;
  if (total === 0) {
    return { file: null, entries: [], total: 0 };
  }
  const trailing = entries.slice(Math.max(0, total - lines));
  return { file: fullPath, entries: trailing, total };
}
