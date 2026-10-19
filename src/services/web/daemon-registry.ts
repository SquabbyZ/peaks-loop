/**
 *
 * Isolated from the HTTP client so each is testable alone (tech-doc §2). Every
 * WRITE goes through `assertUnder` first — the slice-wide guard against an
 * artifact escaping `<root>/.peaks/_runtime/<sid>/web/` (AC1).
 */
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';

import {
  assertUnder,
  webDaemonDir,
  webDaemonInfoPath,
  webSpawnLockPath
} from './web-artifact-paths.js';
import { parseDaemonInfo, type WebDaemonInfo } from './web-protocol.js';

/**
 * Canonicalize through symlinks so two paths that name the same directory through
 * different prefixes compare equal — the macOS `/var` <-> `/private/var` quirk
 * makes `mkdtempSync(...)` return `/var/folders/...` while `process.cwd()` after
 * `chdir` returns `/private/var/folders/...`. They are the same directory on
 * disk; without `realpathSync` the ownership check below silently rejects a
 * legitimate record and the CLI cold-starts a real daemon instead of reusing
 * the stub. Falls back to `resolve()` when the path is absent: a planted
 * record naming a directory that does not exist still has to fail the
 * containment test, and a `realpathSync` on it would throw.
 */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

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
  writeFileSync(target, JSON.stringify(info, null, 2), {
    encoding: 'utf8',
    mode: DAEMON_FILE_MODE
  });
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
    if (info === null || info.sessionId !== sessionId) {
      return null;
    }
    // Canonicalize both sides — a record written from one prefix (say
    // `/var/folders/...`) and read from the canonical one (`/private/var/...`)
    // describes the same project on macOS.
    if (safeRealpath(info.projectRoot) !== safeRealpath(projectRoot)) {
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

const SPAWN_LOCK_ATTEMPTS = 3;

/**
 * Take the cold-start lock. Returns `false` when another process holds a live
 * lock; reclaims a STALE one by renaming it to a per-call quarantine. Unlink-
 * then-create is not atomic (two callers could both return true), so the
 * replacement is created and identity-verified, and a moved fresh lock is
 * restored rather than replaced.
 */
export function acquireSpawnLock(projectRoot: string, sessionId: string): boolean {
  const target = webSpawnLockPath(projectRoot, sessionId);
  assertUnder(target, webDaemonDir(projectRoot, sessionId));
  mkdirSync(dirname(target), { recursive: true, mode: DAEMON_DIR_MODE });
  let mine: SpawnLockBody | null = null;
  for (let attempt = 0; attempt < SPAWN_LOCK_ATTEMPTS; attempt += 1) {
    const created = tryCreateSpawnLock(target);
    if (created !== null) {
      mine = created;
      if (ownsLockFile(target, created)) return true;
      continue;
    }
    const existing = readSpawnLock(target);
    if (isOwnLock(existing, mine)) return true;
    if (isSpawnLockHeld(target, existing)) return false;
    return reclaimSpawnLock(target, existing);
  }
  return false;
}

function isOwnLock(existing: SpawnLockBody | null, mine: SpawnLockBody | null): boolean {
  return (
    existing !== null &&
    mine !== null &&
    existing.pid === mine.pid &&
    existing.startedAt === mine.startedAt
  );
}

/** Unreadable is held while young; readable is held while its owner is alive and young. */
function isSpawnLockHeld(target: string, existing: SpawnLockBody | null): boolean {
  if (existing === null) {
    return lockFileAgeMs(target) <= SPAWN_LOCK_STALE_MS;
  }
  return (
    isProcessAlive(existing.pid) &&
    Date.now() - Date.parse(existing.startedAt) <= SPAWN_LOCK_STALE_MS
  );
}

/** True only when `target` still holds the exact body this call created. */
function ownsLockFile(target: string, created: SpawnLockBody): boolean {
  const now = readSpawnLock(target);
  return now !== null && now.pid === created.pid && now.startedAt === created.startedAt;
}

let reclaimSerial = 0; // one quarantine per call, so reclaimers never share a path

/**
 * Take a stale lock by renaming it to this call's quarantine; true only when
 * the verified replacement was created.
 */
function reclaimSpawnLock(target: string, existing: SpawnLockBody | null): boolean {
  reclaimSerial += 1;
  const quarantine = `${target}.reclaim-${String(process.pid)}-${String(reclaimSerial)}`;
  try {
    renameSync(target, quarantine);
  } catch {
    return false;
  }
  const moved = readSpawnLock(quarantine);
  const movedIsStale =
    existing === null
      ? moved === null && lockFileAgeMs(quarantine) > SPAWN_LOCK_STALE_MS
      : moved !== null && moved.pid === existing.pid && moved.startedAt === existing.startedAt;
  if (!movedIsStale) {
    restoreQuarantinedLock(quarantine, target);
    return false;
  }
  rmSync(quarantine, { force: true });
  const created = tryCreateSpawnLock(target);
  return created !== null && ownsLockFile(target, created);
}

/** Put a freshly-moved lock back without ever replacing a lock that now owns the path. */
function restoreQuarantinedLock(quarantine: string, target: string): void {
  try {
    copyFileSync(quarantine, target, constants.COPYFILE_EXCL);
    rmSync(quarantine, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    rmSync(quarantine, { force: true });
  }
}

/** File age, used only when the body cannot be read; `Infinity` when it vanished. */
function lockFileAgeMs(target: string): number {
  try {
    return Date.now() - statSync(target).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Release the spawn lock, but only when this process provably owns it. */
export function releaseSpawnLock(projectRoot: string, sessionId: string): void {
  const target = webSpawnLockPath(projectRoot, sessionId);
  const existing = readSpawnLock(target);
  if (existing !== null && existing.pid !== process.pid) return;
  // A young unreadable body may be a live creator mid-write; do not unlink it.
  if (existing === null && lockFileAgeMs(target) <= SPAWN_LOCK_STALE_MS) return;
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

function tryCreateSpawnLock(target: string): SpawnLockBody | null {
  const body: SpawnLockBody = { pid: process.pid, startedAt: new Date().toISOString() };
  let created: boolean;
  try {
    writeFileSync(target, JSON.stringify(body), { flag: 'wx', encoding: 'utf8' });
    created = true;
  } catch {
    // `EEXIST` (held) and any other write failure both mean "not acquired".
    // The caller either waits for the holder or surfaces a readiness timeout.
    created = false;
  }
  return created ? body : null;
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
