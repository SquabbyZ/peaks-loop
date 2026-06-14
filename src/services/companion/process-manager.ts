/**
 * Slice 2026-06-14-cc-connect-weixin (slice 2) — companion process
 * manager. Owns the cc-connect child-process lifecycle: spawn
 * (detached), write PID to `~/.peaks/companion/cc-connect.pid`,
 * check liveness, terminate with SIGTERM → 5s SIGKILL fallback.
 *
 * The PID file is the source of truth for "is cc-connect running".
 * We do NOT rely on the binary writing its own state — peaks-cli
 * owns the lifecycle. If the PID file is stale (process gone) we
 * transparently clean it up.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { companionHomeDir } from './binary-cache.js';
import type { CompanionChannel } from './companion-types.js';

export const COMPANION_PID_FILENAME = 'cc-connect.pid';
export const COMPANION_LOG_FILENAME = 'cc-connect.log';
export const COMPANION_KILL_TIMEOUT_MS = 5_000;

export type CompanionProcessRecord = {
  pid: number;
  binaryPath: string;
  channel: CompanionChannel;
  startedAt: string;
  argv: readonly string[];
};

export function companionPidFile(home: string = homedir()): string {
  return join(companionHomeDir(home), COMPANION_PID_FILENAME);
}

export function companionLogFile(home: string = homedir()): string {
  return join(companionHomeDir(home), COMPANION_LOG_FILENAME);
}

/** Serialize a record to a single line (pipe-separated). */
export function serializeProcessRecord(record: CompanionProcessRecord): string {
  return `${record.pid}|${record.binaryPath}|${record.channel}|${record.startedAt}|${record.argv.join(',')}`;
}

/** Deserialize a process record. Returns null when malformed. */
export function parseProcessRecord(raw: string): CompanionProcessRecord | null {
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (line === undefined) return null;
  const parts = line.split('|');
  if (parts.length < 5) return null;
  const [pidStr, binaryPath, channel, startedAt, ...rest] = parts as [string, string, string, string, ...string[]];
  const pid = Number.parseInt(pidStr, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (binaryPath.length === 0 || channel.length === 0 || startedAt.length === 0) return null;
  if (channel !== 'weixin') return null;
  const argvStr = rest.join('|');
  const argv = argvStr.length === 0 ? [] : argvStr.split(',');
  return { pid, binaryPath, channel, startedAt, argv };
}

/** Read the current process record. Returns null when the file is absent / malformed. */
export function readProcessRecord(home: string = homedir()): CompanionProcessRecord | null {
  const file = companionPidFile(home);
  if (!existsSync(file)) return null;
  try {
    return parseProcessRecord(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write the process record. Best-effort mkdir. */
export function writeProcessRecord(record: CompanionProcessRecord, home: string = homedir()): { ok: boolean; path: string; error: string | null } {
  const file = companionPidFile(home);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serializeProcessRecord(record) + '\n', 'utf8');
    return { ok: true, path: file, error: null };
  } catch (err) {
    return { ok: false, path: file, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Remove the PID file. */
export function clearProcessRecord(home: string = homedir()): { ok: boolean; removed: boolean } {
  const file = companionPidFile(home);
  if (!existsSync(file)) return { ok: true, removed: false };
  try {
    unlinkSync(file);
    return { ok: true, removed: true };
  } catch {
    return { ok: false, removed: false };
  }
}

/** Check whether the given pid is alive. Uses signal 0 (no-op probe). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // EPERM means the pid exists but we don't have permission to signal it.
    return true;
  }
}

/** Spawn the cc-connect binary detached. Returns the child process + the log fd. */
export function spawnCompanion(binaryPath: string, args: readonly string[]): { child: ChildProcess; logFd: number } {
  const logPath = companionLogFile();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  const child = spawn(binaryPath, [...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  // Allow the parent to exit independently of the child.
  child.unref();
  return { child, logFd };
}

/** Close a log fd opened via spawnCompanion. Best-effort. */
export function closeLogFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    /* best-effort */
  }
}
