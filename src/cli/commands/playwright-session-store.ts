// src/cli/commands/playwright-session-store.ts
//
// The Playwright MCP session store: port range, terminal-id derivation, the
// session-record file layout, the port probe and the process spawn. Split out
// of `playwright-commands.ts`, which re-exports every symbol below so its
// public surface is unchanged.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync
} from 'node:fs';
import net from 'node:net';
import { join, dirname, resolve } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';

export const DEFAULT_PORT = 8931;
export const MAX_PORT = 8949;
/** The lowest TCP port the `--port` flag accepts. */
export const MIN_PORT = 1024;
/** The highest TCP port the `--port` flag accepts. */
export const MAX_TCP_PORT = 65535;
/** Hex characters kept from the sha256 of (ppid, tty) when deriving a terminal id. */
const TERMINAL_HASH_CHARS = 16;
/** Longest id `sanitizeTerminalId` will emit. */
const TERMINAL_ID_MAX_CHARS = 64;
export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type Browser = (typeof BROWSERS)[number];

export interface PlaywrightSession {
  terminalId: string;
  port: number;
  browser: Browser;
  userDataDir: string;
  startedAt: string;
  pid?: number;
}

export const PLAYWRIGHT_SESSIONS_DIR = 'playwright-sessions';

export function playwrightSessionsDir(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', PLAYWRIGHT_SESSIONS_DIR);
}

export function sessionFilePath(projectRoot: string, terminalId: string): string {
  // Terminal-id axis. The derived id is already sanitised (`deriveTerminalId`),
  // but `--terminal` is caller-supplied and reaches this join unsanitised.
  // Measured (repair cycle 1, item 1): `playwright stop --terminal ../../../../X`
  // read a session record planted OUTSIDE the project root, sent SIGTERM to the
  // pid it named, unlinked that file, and returned `ok: true` — arbitrary
  // process termination plus an arbitrary file delete, one flag away. This is
  // the join every reader/writer of a session record goes through, so this is
  // where the invariant lives.
  if (isUnsafePathInput(terminalId)) {
    throw new Error(`Invalid terminal id: ${terminalId} (must be a single path segment)`);
  }
  return join(playwrightSessionsDir(projectRoot), `${terminalId}.json`);
}

/**
 * The per-terminal default `--user-data-dir` under the runtime tree. Guarded here,
 * beside the join, for the same reason `sessionFilePath` above is: rule D keys the
 * guard to the FILE, and the caller (`peaks playwright start`) reaches this only
 * through `readSession` — so a guard that leaned on that call order would be the
 * file-scoped hole the rule exists to keep visible.
 */
export function defaultUserDataDir(projectRoot: string, terminalId: string): string {
  if (isUnsafePathInput(terminalId)) {
    throw new Error(`Invalid terminal id: ${terminalId} (must be a single path segment)`);
  }
  return join(projectRoot, '.peaks', '_runtime', 'playwright-userdata', terminalId);
}

/**
 * Derive a stable terminal id from the process environment. Prefers
 * the platform's own terminal-session id (macOS Terminal, Windows
 * Terminal) and falls back to a hash of (ppid, tty).
 */
export function deriveTerminalId(
  env: NodeJS.ProcessEnv = process.env,
  ppid: number = process.ppid
): string {
  const termSession = env.TERM_SESSION_ID;
  if (termSession && termSession.length > 0) {
    return sanitizeTerminalId(termSession);
  }
  const wtSession = env.WT_SESSION;
  if (wtSession && wtSession.length > 0) {
    return sanitizeTerminalId(`wt-${wtSession}`);
  }
  const tty = env.SSH_TTY ?? 'no-tty';
  const hash = createHash('sha256')
    .update(`${ppid}-${tty}`)
    .digest('hex')
    .slice(0, TERMINAL_HASH_CHARS);
  return `tty-${hash}`;
}

function sanitizeTerminalId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, TERMINAL_ID_MAX_CHARS);
}

/**
 * Walk port range starting at `start` and return the first port
 * that is NOT bound. Defaults: 8931 → 8949. If the range is exhausted,
 * returns null.
 */
export async function findFreePort(
  start: number = DEFAULT_PORT,
  max: number = MAX_PORT,
  probe: (port: number) => Promise<boolean> = defaultPortProbe
): Promise<number | null> {
  for (let p = start; p <= max; p += 1) {
    if (await probe(p)) return p;
  }
  return null;
}

async function defaultPortProbe(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const server = net.createServer();
    server.once('error', () => resolveProbe(false));
    server.once('listening', () => {
      server.close(() => resolveProbe(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

export function listSessions(projectRoot: string): PlaywrightSession[] {
  const dir = playwrightSessionsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const out: PlaywrightSession[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(dir, entry), 'utf8');
      const session = JSON.parse(raw) as PlaywrightSession;
      out.push(session);
    } catch {
      // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // skip malformed session file
    }
  }
  return out;
}

export function readSession(projectRoot: string, terminalId: string): PlaywrightSession | null {
  const path = sessionFilePath(projectRoot, terminalId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PlaywrightSession;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

export function writeSession(projectRoot: string, session: PlaywrightSession): void {
  const path = sessionFilePath(projectRoot, session.terminalId);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(session, null, 2) + '\n', 'utf8');
}

export function removeSession(projectRoot: string, terminalId: string): boolean {
  const path = sessionFilePath(projectRoot, terminalId);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Spawn the playwright MCP via npx. We do NOT bundle the binary;
 * we just orchestrate the lifecycle. Returns the child PID so the
 * session file can record it.
 */
export function spawnPlaywrightMcp(
  port: number,
  browser: Browser,
  userDataDir: string,
  projectRoot: string
): { pid: number | undefined; child: ReturnType<typeof spawn> } {
  const child = spawn(
    'npx',
    [
      'playwright-mcp@latest',
      `--port=${port}`,
      `--browser=${browser}`,
      `--user-data-dir=${userDataDir}`
    ],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    }
  );
  return { pid: child.pid, child };
}

/**
 * Resolve and validate a caller-supplied `--user-data-dir`. The dir must
 * live under `projectRoot` so a malicious `--user-data-dir /etc/foo`
 * cannot coerce the playwright-mcp browser into writing state to an
 *
 * Resolves `..` segments before checking, so a path like
 * `<projectRoot>/../escape` is correctly normalized and rejected.
 *
 * Throws `Error('INVALID_USER_DATA_DIR: ...')` on validation failure;
 * the action handler catches and emits the JSON envelope.
 */
export function resolveUserDataDir(raw: string, projectRoot: string): string {
  const resolved = resolve(projectRoot, raw);
  const rootResolved =
    resolve(projectRoot) + (projectRoot.endsWith('/') || projectRoot.endsWith('\\') ? '' : '/');
  // Use the projectRoot + sep as the prefix; require either an exact
  // match or a child path. The `+ '/'` guard prevents sibling-prefix
  // collisions (e.g. /home/A/proj2 passes the check for /home/A/proj).
  if (resolved !== resolve(projectRoot) && !resolved.startsWith(rootResolved)) {
    throw new Error(
      `INVALID_USER_DATA_DIR: --user-data-dir must resolve to a path under project root ${projectRoot} (got ${resolved})`
    );
  }
  return resolved;
}
