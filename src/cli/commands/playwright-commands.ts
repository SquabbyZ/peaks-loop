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
 * `npx playwright-mcp@latest` (G22 / NG3). peaks-loop is the lifecycle
 * orchestrator, not the install medium.
 *
 * The verb implementations live beside this file: `playwright-session-store.ts`
 * (port range, terminal-id derivation, session records, spawn),
 * `playwright-ls-stop-commands.ts` (`ls` / `stop`) and
 * `playwright-browser-command.ts` (`peaks browser action`). Every symbol this
 * path used to export is still exported from it, so importers are unaffected.
 */

import type { Command } from 'commander';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  BROWSERS,
  DEFAULT_PORT,
  MAX_PORT,
  MAX_TCP_PORT,
  MIN_PORT,
  deriveTerminalId,
  findFreePort,
  readSession,
  resolveUserDataDir,
  sessionFilePath,
  spawnPlaywrightMcp,
  writeSession,
  type Browser,
  type PlaywrightSession
} from './playwright-session-store.js';
import { registerBrowserActionCommand } from './playwright-browser-command.js';
import {
  registerPlaywrightLsCommand,
  registerPlaywrightStopCommand
} from './playwright-ls-stop-commands.js';
import { emitFailure, emitSuccess } from './playwright-envelope.js';

// Re-exported so the split is invisible to importers of THIS path.
export {
  DEFAULT_PORT,
  MAX_PORT,
  PLAYWRIGHT_SESSIONS_DIR,
  playwrightSessionsDir,
  sessionFilePath,
  deriveTerminalId,
  findFreePort,
  listSessions,
  readSession,
  writeSession,
  removeSession,
  spawnPlaywrightMcp,
  resolveUserDataDir
} from './playwright-session-store.js';
export type { PlaywrightSession } from './playwright-session-store.js';
export { registerBrowserActionCommand } from './playwright-browser-command.js';

type StartOptions = {
  port?: number;
  browser?: string;
  userDataDir?: string;
  reuse?: boolean;
  project?: string;
  json?: boolean;
};

/** The per-terminal default `--user-data-dir` under the runtime tree. */
function defaultUserDataDir(projectRoot: string, terminalId: string): string {
  return join(projectRoot, '.peaks', '_runtime', 'playwright-userdata', terminalId);
}

/**
 * Report an already-running session for this terminal. True when the caller
 * must stop: either the reuse arm returned the existing port, or the conflict
 * arm refused. Conflict: G21 / AC18.
 */
function reportExistingSession(
  json: boolean | undefined,
  reuse: boolean | undefined,
  existing: PlaywrightSession,
  terminalId: string
): boolean {
  if (reuse) {
    emitSuccess(
      json,
      { reused: true, session: existing },
      `reusing existing playwright session on port ${existing.port} (terminal ${terminalId})`
    );
    return true;
  }
  emitFailure(
    json,
    `CONFLICT: another playwright MCP is already running on port ${existing.port} (terminal ${terminalId}). Reuse it (--reuse) or pick a new port (--port <n>).`,
    'CONFLICT'
  );
  return true;
}

/** Resolve the starting port; null (+ envelope) when `--port` is out of range. */
function resolveStartPort(json: boolean | undefined, raw: number | undefined): number | null {
  const startPort = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_PORT;
  if (startPort < MIN_PORT || startPort > MAX_TCP_PORT) {
    emitFailure(
      json,
      `INVALID_PORT: --port must be between ${MIN_PORT} and ${MAX_TCP_PORT} (got ${startPort})`
    );
    return null;
  }
  return startPort;
}

async function runPlaywrightStart(opts: StartOptions): Promise<void> {
  try {
    const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
    const browser: Browser = BROWSERS.includes(opts.browser as Browser)
      ? (opts.browser as Browser)
      : 'chromium';
    const terminalId = deriveTerminalId();

    const existing = readSession(projectRoot, terminalId);
    if (existing && reportExistingSession(opts.json, opts.reuse, existing, terminalId)) return;

    const startPort = resolveStartPort(opts.json, opts.port);
    if (startPort === null) return;
    const port = await findFreePort(startPort, MAX_PORT);
    if (port === null) {
      emitFailure(
        opts.json,
        `PORT_EXHAUSTED: no free port in ${startPort}..${MAX_PORT} range`,
        'PORT_EXHAUSTED'
      );
      return;
    }

    const userDataDir = opts.userDataDir
      ? resolveUserDataDir(opts.userDataDir, projectRoot)
      : defaultUserDataDir(projectRoot, terminalId);

    // Spawn the MCP via npx. Detached so it survives our exit.
    const { pid, child } = spawnPlaywrightMcp(port, browser, userDataDir, projectRoot);
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

    emitSuccess(
      opts.json,
      { session, sessionFile: sessionFilePath(projectRoot, terminalId) },
      `playwright MCP started on port ${port} (browser=${browser}, terminal=${terminalId})`
    );
  } catch (error) {
    emitFailure(opts.json, getErrorMessage(error));
  }
}

function registerPlaywrightStartCommand(playwright: Command): void {
  playwright
    .command('start')
    .description('Start a Playwright MCP server on a free port; write a session record.')
    .option('--port <n>', 'preferred port (default 8931; walks 8931→8949 if busy)', (v: string) =>
      Number(v)
    )
    .option(
      '--browser <name>',
      `browser engine: ${BROWSERS.join(', ')} (default chromium)`,
      'chromium'
    )
    .option(
      '--user-data-dir <path>',
      'browser user-data directory (default: <projectRoot>/.peaks/_runtime/playwright-userdata/<terminal-id>)'
    )
    .option(
      '--reuse',
      'if a session is already running for this terminal, return its port instead of erroring'
    )
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action((opts: StartOptions) => runPlaywrightStart(opts));
}

export function registerPlaywrightCommands(program: Command, io: ProgramIO): void {
  const playwright = program
    .command('playwright')
    .description(
      'Multi-terminal Playwright MCP lifecycle. `peaks playwright start` allocates a unique port ' +
        '(8931→8949) and writes a session file; `ls` lists running sessions; `stop` tears them down. ' +
        'Does NOT bundle the playwright-mcp binary (uses `npx playwright-mcp@latest`). ' +
        '(slice 2.5.0 sub-fix C)'
    );

  registerPlaywrightStartCommand(playwright);
  registerPlaywrightLsCommand(playwright, io);
  registerPlaywrightStopCommand(playwright, io);

  // Slice 3: `peaks browser action <intent> [args...]` — thin wrapper
  // around 5 Playwright MCP intents. One MCP call per invocation; no
  // auto-snapshot between intents. See src/services/qa/browser-wrapper-service.ts.
  registerBrowserActionCommand(program);
}
