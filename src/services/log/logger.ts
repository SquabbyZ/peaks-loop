/**
 * JSONL file logger for peaks-cli.
 *
 * Slice 2026-06-16-cli-logging (G1, G2, G5, G6, G7).
 *
 * Default-on file logging: every peaks-cli invocation writes a
 * structured log entry to `<homedir>/.peaks/logs/peaks-cli-YYYY-MM-DD.log`
 * (UTC date stamp). One JSON object per line.
 *
 * Hard contracts enforced here:
 *  - stdout is NEVER touched by the logger (G7). Use the returned
 *    `LogLine` string and pipe it to the file only.
 *  - The log dir is created lazily on first write (G1).
 *  - File mode is 0o600 on POSIX (R3). Windows uses ACLs and the
 *    0o600 bit is a no-op there; the call is best-effort.
 *  - All write paths go through `redact` so a leaked secret can
 *    never reach disk (G6).
 *  - The log level can be overridden via `PEAKS_LOG_LEVEL` (G3) and
 *    `PEAKS_LOG_DATE_OVERRIDE` (AC2) for deterministic tests.
 *
 * No third-party deps (R1): `fs.appendFileSync` + `JSON.stringify`
 * is enough; pino/winston are NOT pulled in.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { isSecretKey, redactLine, redactValue } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  ts: string;
  level: LogLevel;
  command: string;
  msg: string;
  sessionId?: string;
  version?: string;
  // Slice 2026-06-23-audit-4th #B2: batchId is a cross-run
  // correlation key. Sub-agents dispatching under the same batchId
  // write log lines with this field; `peaks log tail --batch <id>`
  // filters by it. Without this, a user post-hoc cannot group the
  // log lines for one batch (they interleave in the JSONL file).
  batchId?: string;
  // Catch-all for command-specific structured metadata.
  // The logger redacts any field whose key matches a secret pattern.
  data?: Record<string, unknown>;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

/**
 * Returns the canonical log directory. On Windows, `homedir()` is
 * `%USERPROFILE%`; on macOS / Linux, `$HOME`. The path is the
 * user-global `~/.peaks/logs/` — never inside a project tree (NG6).
 */
export function resolveLogDir(): string {
  return join(homedir(), '.peaks', 'logs');
}

/**
 * Returns the UTC date-stamped file name. `date` is injectable so
 * tests can pin the date without monkey-patching `Date`.
 */
export function buildLogFileName(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `peaks-loop-${yyyy}-${mm}-${dd}.log`;
}

/**
 * Walk a structured payload and redact any field whose key matches
 * the secret pattern. Returns a NEW object (immutable). Used by
 * `writeLogEntry` so a `data` payload containing `apiKey` is never
 * serialized verbatim.
 */
function redactPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => redactPayload(item));
  }
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        out[k] = '<redacted>';
      } else if (typeof v === 'string') {
        out[k] = redactValue(v);
      } else {
        out[k] = redactPayload(v);
      }
    }
    return out;
  }
  if (typeof payload === 'string') return redactValue(payload);
  return payload;
}

function resolveLogLevel(): LogLevel {
  const env = process.env.PEAKS_LOG_LEVEL?.toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  return 'info';
}

function shouldEmit(level: LogLevel): boolean {
  const threshold = resolveLogLevel();
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[threshold];
}

export type WriteLogOptions = {
  /** Override the clock for deterministic tests. Defaults to `new Date()`. */
  now?: () => Date;
  /**
   * Override the log dir for tests. Defaults to `resolveLogDir()`.
   * Allows the test harness to redirect to a temp dir without
   * monkey-patching `os.homedir()`.
   */
  dirOverride?: string;
  /**
   * Override the date used for the file name + entry `ts`. The PRD
   * AC2 contract is `PEAKS_LOG_DATE_OVERRIDE=YYYY-MM-DD`; the
   * program-level flag plumbing in `program.ts` reads it and passes
   * it down. The `now` option still drives the `ts` field, so the
   * caller MUST pass a matching `Date` for the AC2 invariant.
   */
  dateOverride?: string;
};

/**
 * Write a single JSONL log entry. Returns the absolute file path
 * the entry was written to, or `null` when the entry was filtered
 * out by the current log level.
 *
 * Failures inside the logger (mkdir, appendFile, chmod) are caught
 * and swallowed: a logger that takes down the CLI is worse than a
 * logger that drops a line. The swallow is intentional per the PRD
 * non-goals (NG1: no remote ship; the user only ever sees a file
 * they read directly).
 */
export function writeLogEntry(entry: LogEntry, opts: WriteLogOptions = {}): string | null {
  if (!shouldEmit(entry.level)) return null;

  const now = opts.now ? opts.now() : new Date();
  const dateForFile = opts.dateOverride !== undefined
    ? new Date(`${opts.dateOverride}T00:00:00.000Z`)
    : now;
  const logDir = opts.dirOverride ?? resolveLogDir();
  const fileName = buildLogFileName(dateForFile);
  const fullPath = join(logDir, fileName);

  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }

  // Build a redacted copy of the entry. We never mutate the caller's
  // object (immutability rule from coding-style.md).
  const redactedEntry: LogEntry = {
    ...entry,
    ts: entry.ts ?? now.toISOString(),
    msg: redactLine(entry.msg),
    ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    ...(entry.batchId !== undefined ? { batchId: entry.batchId } : {}),
    ...(entry.data !== undefined ? { data: redactPayload(entry.data) as Record<string, unknown> } : {})
  };

  let line: string;
  try {
    line = JSON.stringify(redactedEntry);
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }

  try {
    appendFileSync(fullPath, line + '\n', { mode: 0o600 });
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }

  // `appendFileSync({mode})` only sets the mode when the file is
  // created. On subsequent writes the mode would not be re-applied
  // (Node's documented behavior). chmod is a no-op when the mode
  // is already correct; safe to call.
  if (process.platform !== 'win32') {
    try {
      const stat = statSync(fullPath);
      if ((stat.mode & 0o777) !== 0o600) {
        chmodSync(fullPath, 0o600);
      }
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      /* best-effort */
    }
  }

  return fullPath;
}

export type ReadLogOptions = {
  now?: () => Date;
  dirOverride?: string;
  dateOverride?: string;
};

/**
 * Read the current day's log file and return all parseable JSON
 * entries. Malformed lines are skipped (the on-disk file is JSONL,
 * but a crash mid-write can leave a partial line; we don't want
 * that to break `peaks log tail`).
 */
export function readLogEntries(opts: ReadLogOptions = {}): LogEntry[] {
  const now = opts.now ? opts.now() : new Date();
  const dateForFile = opts.dateOverride !== undefined
    ? new Date(`${opts.dateOverride}T00:00:00.000Z`)
    : now;
  const logDir = opts.dirOverride ?? resolveLogDir();
  const fileName = buildLogFileName(dateForFile);
  const fullPath = join(logDir, fileName);

  if (!existsSync(fullPath)) return [];

  let body: string;
  try {
    body = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }

  const out: LogEntry[] = [];
  for (const line of body.split('\n')) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line) as LogEntry);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // skip malformed
    }
  }
  return out;
}

/**
 * Print a log line to stderr IF the current process is in verbose
 * mode (`--verbose` / `-v` / `PEAKS_LOG_LEVEL=debug`). This is the
 * G3 opt-in channel: by default, stderr stays clean so the CLI's
 * `--json` envelope is not contaminated.
 *
 * Returns `true` when the line was written; `false` otherwise. The
 * caller can use the boolean to detect silent-failure patterns (a
 * `peaks log tail` that prints nothing when the user expected a
 * verbose stream).
 */
export function maybeWriteStderr(entry: LogEntry, opts: { verbose: boolean }): boolean {
  if (!opts.verbose) return false;
  if (entry.level !== 'debug' && entry.level !== 'info') return false;
  try {
    process.stderr.write(JSON.stringify(entry) + '\n');
    return true;
  } catch {
    return false;
  }
}

export { dirname };
