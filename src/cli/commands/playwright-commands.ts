/**
 * `peaks playwright start | ls | stop` — slice 2.5.0 sub-fix C (Prob 3).
 *
 * Multi-terminal resolution for the Playwright MCP. When two or more
 * terminals / IDE sessions each spawn a `playwright` MCP server, they
 * fight over the same default port (8931) and the same user data
 * dir. This command:
 *
 *   1. `peaks playwright start [--port N] [--browser <chromium|firefox|webkit>]`
 *      Allocates a unique port (default 8931; walks 8931→8949 if busy),
 *      spawns `npx playwright-mcp@latest` with the chosen port, and
 *      writes a session file at
 *      `<projectRoot>/.peaks/_runtime/playwright-sessions/<terminal-id>.json`
 *      with `{ port, userDataDir, startedAt, pid }`.
 *
 *   2. `peaks playwright ls` — lists all running sessions (reads
 *      `.peaks/_runtime/playwright-sessions/*.json`).
 *
 *   3. `peaks playwright stop [--terminal <id>]` — best-effort kills
 *      the server process and removes the session file.
 *
 * Terminal ID derivation (R4):
 *   1. process.env.TERM_SESSION_ID (macOS Terminal / iTerm2)
 *   2. process.env.WT_SESSION (Windows Terminal)
 *   3. hash(process.ppid + process.env.SSH_TTY || 'no-tty')
 *
 * The CLI does NOT bundle `playwright-mcp`; it shells out to
 * `npx playwright-mcp@latest` (G22 / NG3). peaks-cli is the lifecycle
 * orchestrator, not the install medium.
 */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import { join, dirname } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

export const DEFAULT_PORT = 8931;
export const MAX_PORT = 8949;
const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
type Browser = typeof BROWSERS[number];

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
  return join(playwrightSessionsDir(projectRoot), `${terminalId}.json`);
}

/**
 * Derive a stable terminal id from the process environment. Prefers
 * the platform's own terminal-session id (macOS Terminal, Windows
 * Terminal) and falls back to a hash of (ppid, tty).
 */
export function deriveTerminalId(env: NodeJS.ProcessEnv = process.env, ppid: number = process.ppid): string {
  const termSession = env.TERM_SESSION_ID;
  if (termSession && termSession.length > 0) {
    return sanitizeTerminalId(termSession);
  }
  const wtSession = env.WT_SESSION;
  if (wtSession && wtSession.length > 0) {
    return sanitizeTerminalId(`wt-${wtSession}`);
  }
  const tty = env.SSH_TTY ?? 'no-tty';
  const hash = createHash('sha256').update(`${ppid}-${tty}`).digest('hex').slice(0, 16);
  return `tty-${hash}`;
}

function sanitizeTerminalId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
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
    const net = require('node:net') as typeof import('node:net');
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
    ['playwright-mcp@latest', `--port=${port}`, `--browser=${browser}`, `--user-data-dir=${userDataDir}`],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: 'ignore',
      detached: true
    }
  );
  return { pid: child.pid, child };
}

export function registerPlaywrightCommands(program: Command, _io: ProgramIO): void {
  const playwright = program
    .command('playwright')
    .description(
      'Multi-terminal Playwright MCP lifecycle. `peaks playwright start` allocates a unique port ' +
      '(8931→8949) and writes a session file; `ls` lists running sessions; `stop` tears them down. ' +
      'Does NOT bundle the playwright-mcp binary (uses `npx playwright-mcp@latest`). ' +
      '(slice 2.5.0 sub-fix C)'
    );

  playwright
    .command('start')
    .description('Start a Playwright MCP server on a free port; write a session record.')
    .option('--port <n>', 'preferred port (default 8931; walks 8931→8949 if busy)', (v: string) => Number(v))
    .option('--browser <name>', `browser engine: ${BROWSERS.join(', ')} (default chromium)`, 'chromium')
    .option('--user-data-dir <path>', 'browser user-data directory (default: <projectRoot>/.peaks/_runtime/playwright-userdata/<terminal-id>)')
    .option('--reuse', 'if a session is already running for this terminal, return its port instead of erroring')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (opts: {
      port?: number;
      browser?: string;
      userDataDir?: string;
      reuse?: boolean;
      project?: string;
      json?: boolean;
    }) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        const browser: Browser = BROWSERS.includes(opts.browser as Browser)
          ? (opts.browser as Browser)
          : 'chromium';
        const terminalId = deriveTerminalId();

        // Existing session for this terminal?
        const existing = readSession(projectRoot, terminalId);
        if (existing) {
          if (opts.reuse) {
            if (opts.json === true) {
              process.stdout.write(JSON.stringify({
                ok: true,
                data: { reused: true, session: existing }
              }) + '\n');
            } else {
              process.stdout.write(`reusing existing playwright session on port ${existing.port} (terminal ${terminalId})\n`);
            }
            return;
          }
          // Conflict: G21 / AC18
          const msg = `CONFLICT: another playwright MCP is already running on port ${existing.port} (terminal ${terminalId}). Reuse it (--reuse) or pick a new port (--port <n>).`;
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg, code: 'CONFLICT' }) + '\n');
          } else {
            process.stderr.write(msg + '\n');
          }
          process.exitCode = 1;
          return;
        }

        // Port allocation
        const startPort = typeof opts.port === 'number' && Number.isFinite(opts.port) ? opts.port : DEFAULT_PORT;
        if (startPort < 1024 || startPort > 65535) {
          const msg = `INVALID_PORT: --port must be between 1024 and 65535 (got ${startPort})`;
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
          } else {
            process.stderr.write(msg + '\n');
          }
          process.exitCode = 1;
          return;
        }
        const port = await findFreePort(startPort, MAX_PORT);
        if (port === null) {
          const msg = `PORT_EXHAUSTED: no free port in ${startPort}..${MAX_PORT} range`;
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg, code: 'PORT_EXHAUSTED' }) + '\n');
          } else {
            process.stderr.write(msg + '\n');
          }
          process.exitCode = 1;
          return;
        }

        // userDataDir default
        const userDataDir = opts.userDataDir
          ? opts.userDataDir
          : join(projectRoot, '.peaks', '_runtime', 'playwright-userdata', terminalId);

        // Spawn the MCP via npx. Detached so it survives our exit.
        const { pid, child } = spawnPlaywrightMcp(port, browser, userDataDir, projectRoot);
        // Detach: do not wait for it.
        child.unref();

        const session: PlaywrightSession = {
          terminalId,
          port,
          browser,
          userDataDir,
          startedAt: new Date().toISOString(),
          ...(pid !== undefined ? { pid } : {})
        };
        writeSession(projectRoot, session);

        if (opts.json === true) {
          process.stdout.write(JSON.stringify({
            ok: true,
            data: { session, sessionFile: sessionFilePath(projectRoot, terminalId) }
          }) + '\n');
        } else {
          process.stdout.write(`playwright MCP started on port ${port} (browser=${browser}, terminal=${terminalId})\n`);
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });

  playwright
    .command('ls')
    .description('List running Playwright MCP sessions from .peaks/_runtime/playwright-sessions/*.json')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data: { sessions } }')
    .action(async (opts: { project?: string; json?: boolean }) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        const sessions = listSessions(projectRoot);
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: { sessions } }) + '\n');
        } else if (sessions.length === 0) {
          process.stdout.write('no playwright sessions running\n');
        } else {
          for (const s of sessions) {
            process.stdout.write(`port=${s.port}\tbrowser=${s.browser}\tterminal=${s.terminalId}\tpid=${s.pid ?? '?'}\tstarted=${s.startedAt}\n`);
          }
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });

  playwright
    .command('stop')
    .description('Stop a running Playwright MCP session (best-effort kill + remove session file).')
    .option('--terminal <id>', 'terminal id to stop (default: this shell\'s derived terminal id)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data }')
    .action(async (opts: { terminal?: string; project?: string; json?: boolean }) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        const terminalId = opts.terminal ?? deriveTerminalId();
        const session = readSession(projectRoot, terminalId);
        if (!session) {
          const msg = `NO_SESSION: no playwright session for terminal ${terminalId}`;
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
          } else {
            process.stderr.write(msg + '\n');
          }
          process.exitCode = 1;
          return;
        }
        // Best-effort kill
        if (session.pid !== undefined && session.pid !== null) {
          try {
            process.kill(session.pid, 'SIGTERM');
          } catch {
            /* process may have already exited */
          }
        }
        removeSession(projectRoot, terminalId);
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: { stopped: session } }) + '\n');
        } else {
          process.stdout.write(`stopped playwright session on port ${session.port} (terminal ${terminalId})\n`);
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });
}
