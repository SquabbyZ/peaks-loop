// src/cli/commands/playwright-ls-stop-commands.ts
//
// `peaks playwright ls` and `peaks playwright stop`. Split out of
// `playwright-commands.ts`; the registered names, descriptions, options and
// envelopes are unchanged.

import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  deriveTerminalId,
  listSessions,
  readSession,
  removeSession
} from './playwright-session-store.js';
import { emitFailure, emitSuccess } from './playwright-envelope.js';

type ProjectOptions = { project?: string; json?: boolean };

export function registerPlaywrightLsCommand(playwright: Command, io: ProgramIO): void {
  // These two verbs write straight to the process streams — a caller-supplied
  // `io` must not intercept a session listing. `io` stays in the signature for
  // the two-argument registrar contract `_register.ts` selects on.
  void io;
  playwright
    .command('ls')
    .description(
      'List running Playwright MCP sessions from .peaks/_runtime/playwright-sessions/*.json'
    )
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data: { sessions } }')
    .action((opts: ProjectOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        const sessions = listSessions(projectRoot);
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: { sessions } }) + '\n');
        } else if (sessions.length === 0) {
          process.stdout.write('no playwright sessions running\n');
        } else {
          for (const s of sessions) {
            process.stdout.write(
              `port=${s.port}\tbrowser=${s.browser}\tterminal=${s.terminalId}\tpid=${s.pid ?? '?'}\tstarted=${s.startedAt}\n`
            );
          }
        }
      } catch (error) {
        emitFailure(opts.json, getErrorMessage(error));
      }
    });
}

export function registerPlaywrightStopCommand(playwright: Command, io: ProgramIO): void {
  void io;
  playwright
    .command('stop')
    .description('Stop a running Playwright MCP session (best-effort kill + remove session file).')
    .option('--terminal <id>', "terminal id to stop (default: this shell's derived terminal id)")
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data }')
    .action((opts: ProjectOptions & { terminal?: string }) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        const terminalId = opts.terminal ?? deriveTerminalId();
        const session = readSession(projectRoot, terminalId);
        if (!session) {
          emitFailure(opts.json, `NO_SESSION: no playwright session for terminal ${terminalId}`);
          return;
        }
        if (session.pid !== undefined && session.pid !== null) {
          try {
            process.kill(session.pid, 'SIGTERM');
          } catch {
            // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
            /* process may have already exited */
          }
        }
        removeSession(projectRoot, terminalId);
        emitSuccess(
          opts.json,
          { stopped: session },
          `stopped playwright session on port ${session.port} (terminal ${terminalId})`
        );
      } catch (error) {
        emitFailure(opts.json, getErrorMessage(error));
      }
    });
}
