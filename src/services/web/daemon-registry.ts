/**
 * File + lock IO for the `peaks web` daemon (slice S1, file 7).
 *
 * Isolated from the HTTP client so each is testable alone (tech-doc §2). Every
 * WRITE goes through `assertUnder` first — the slice-wide guard against an
 * artifact escaping `<root>/.peaks/_runtime/<sid>/web/` (AC1).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  assertUnder,
  webDaemonDir,
  webDaemonInfoPath,
  webSpawnLockPath
} from './web-artifact-paths.js';
import { parseDaemonInfo, type WebDaemonInfo } from './web-protocol.js';

/** A spawn lock older than this is reclaimed even if its owner pid is alive. */
const SPAWN_LOCK_STALE_MS = 120_000;

/**
 * `daemon.json` holds the 64-hex bearer token that is the ONLY lock on the
 * loopback port — 127.0.0.1 is reachable by every local user, so the file mode
 * is the boundary. 0644 would let any local account read the token and drive
 * the browser (`open`/`text`/`snap`/`shot`) with it. The repo's other
 * secret-bearing writers already use `0o600`
 * (`src/services/ide/shared/atomic-json.ts`, `logger.ts`, `config-safety.ts`).
 */
const DAEMON_FILE_MODE = 0o600;

/** The token's directory: readable only by its owner, same reasoning as above. */
export const DAEMON_DIR_MODE = 0o700;

interface SpawnLockBody {
  readonly pid: number;
  readonly startedAt: string;
}

export function writeDaemonInfo(projectRoot: string, sessionId: string, info: WebDaemonInfo): void {
  const target = webDaemonInfoPath(projectRoot, sessionId);
  assertUnder(target, webDaemonDir(projectRoot, sessionId));
  mkdirSync(dirname(target), { recursive: true, mode: DAEMON_DIR_MODE });
  writeFileSync(target, JSON.stringify(info, null, 2), { encoding: 'utf8', mode: DAEMON_FILE_MODE });
}

/**
 * Read + validate `daemon.json`. `null` when absent, malformed, a stale
 * protocol, or — R6 — when the file claims to describe a DIFFERENT
 * `(projectRoot, sessionId)` than the caller's.
 *
 * The ownership comparison belongs here rather than in `parseDaemonInfo`,
 * because only the caller knows what the record is supposed to describe. A
 * planted `daemon.json` naming someone else's session would otherwise redirect
 * every op (page URL, selectors, bearer token) to a port of the attacker's
 * choosing, and — via `stopDaemon` — aim `process.kill` at an unrelated pid.
 */
export function readDaemonInfo(projectRoot: string, sessionId: string): WebDaemonInfo | null {
  const target = webDaemonInfoPath(projectRoot, sessionId);
  if (!existsSync(target)) {
    return null;
  }
  try {
    const info = parseDaemonInfo(readFileSync(target, 'utf8'));
    if (info === null || info.projectRoot !== projectRoot || info.sessionId !== sessionId) {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

/** Remove `daemon.json`. Idempotent: a missing file is not an error. */
export function removeDaemonInfo(projectRoot: string, sessionId: string): void {
  const target = webDaemonInfoPath(projectRoot, sessionId);
  if (!existsSync(target)) {
    return;
  }
  try {
    unlinkSync(target);
  } catch {
    // Another process removed it between the probe and the unlink.
  }
}

/**
 * `process.kill(pid, 0)` is the cross-platform existence probe: it throws
 * `ESRCH` when no such process exists and `EPERM` when one exists but belongs
 * to another user and so may not be signalled. Only `ESRCH` means dead — an
 * alive-but-unsignalable pid must not be reported as dead, or `stopDaemon`
 * skips the kill and `acquireSpawnLock` reclaims a lock whose owner still
 * holds it.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Take the cold-start lock (O_EXCL create). Returns `false` when another
 * process holds a live lock, and reclaims a STALE one — owner pid dead, or
 * older than `SPAWN_LOCK_STALE_MS` — before retrying once (tech-doc §1.4).
 */
export function acquireSpawnLock(projectRoot: string, sessionId: string): boolean {
  const target = webSpawnLockPath(projectRoot, sessionId);
  assertUnder(target, webDaemonDir(projectRoot, sessionId));
  mkdirSync(dirname(target), { recursive: true, mode: DAEMON_DIR_MODE });
  if (tryCreateSpawnLock(target)) {
    return true;
  }
  const existing = readSpawnLock(target);
  const ageMs = existing === null ? Number.NaN : Date.now() - Date.parse(existing.startedAt);
  if (existing !== null && isProcessAlive(existing.pid) && ageMs <= SPAWN_LOCK_STALE_MS) {
    return false;
  }
  try {
    unlinkSync(target);
  } catch {
    // Racers: whoever wins the unlink still has to win the O_EXCL create below.
  }
  return tryCreateSpawnLock(target);
}

/** Release the spawn lock, but only when this process is its owner. */
export function releaseSpawnLock(projectRoot: string, sessionId: string): void {
  const target = webSpawnLockPath(projectRoot, sessionId);
  const existing = readSpawnLock(target);
  if (existing !== null && existing.pid !== process.pid) {
    return;
  }
  try {
    unlinkSync(target);
  } catch {
    // Already released (or never held).
  }
}

/**
 * The daemon instances for a session. There is one daemon per
 * `(projectRoot, sessionId)` (design §10.2), so this list holds at most one
 * entry; it is an array because the S2 status report folds it together with the
 * lock and `/health` classification of each instance.
 */
export function listSessionDaemons(projectRoot: string, sessionId: string): WebDaemonInfo[] {
  const info = readDaemonInfo(projectRoot, sessionId);
  return info === null ? [] : [info];
}

function tryCreateSpawnLock(target: string): boolean {
  const body: SpawnLockBody = { pid: process.pid, startedAt: new Date().toISOString() };
  try {
    writeFileSync(target, JSON.stringify(body), { flag: 'wx', encoding: 'utf8' });
    return true;
  } catch {
    // `EEXIST` (held) and any other write failure both mean "not acquired".
    // The caller either waits for the holder or surfaces a readiness timeout.
    return false;
  }
}

function readSpawnLock(target: string): SpawnLockBody | null {
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const { pid, startedAt } = parsed;
    if (typeof pid !== 'number' || typeof startedAt !== 'string') {
      return null;
    }
    return { pid, startedAt };
  } catch {
    return null;
  }
}
