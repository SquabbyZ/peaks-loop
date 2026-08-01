/**
 * `peaks sub-agent shutdown register|unregister|list` CLI verbs.
 *
 * Slice 2026-08-01-subagent-merge-and-e2e (Task 6). The sub-agent
 * dispatches a long-lived local process (vite dev, mock API, docker
 * proxy, etc.). Before it exits, it MUST register the process with
 * `peaks sub-agent shutdown register --pid <pid> --name <label>`. The
 * parent session reads the resulting `service-registrations.json`
 * before the merge-back step and best-effort-kills each entry via
 * killRegisteredServices (src/services/dispatch/service-shutdown.ts).
 *
 * The CLI is intentionally tiny: it appends / removes entries from a
 * JSON file at `.peaks/_runtime/<sid>/dispatch/<dispatchId>/service-registrations.json`.
 * The file is the contract between the sub-agent (writer) and the
 * merge-back-runner (reader). No locking is needed — the sub-agent
 * writes at most once before exit, and the parent reads after the
 * sub-agent's process is gone.
 *
 * Skill-first / CLI-auxiliary red line: the user does not invoke
 * these commands directly. They are invoked by the sub-agent (or its
 * own scripts) at teardown.
 */
import type { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';

/** Re-exported shape — kept here so the CLI owns the on-disk contract. */
export type ServiceRegistration = {
  readonly pid: number;
  readonly name: string;
  readonly url?: string;
};

const REGISTRATIONS_FILE = 'service-registrations.json';

function registrationsPath(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchId: string;
}): string {
  return join(
    input.projectRoot,
    '.peaks',
    '_runtime',
    input.sessionId,
    'dispatch',
    input.dispatchId,
    REGISTRATIONS_FILE,
  );
}

function readAll(file: string): ReadonlyArray<ServiceRegistration> {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ReadonlyArray<ServiceRegistration>;
  } catch {
    return [];
  }
}

function writeAll(file: string, regs: ReadonlyArray<ServiceRegistration>): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(regs, null, 2), 'utf8');
}

function resolveDispatchId(input: { readonly dispatchId?: string }): string {
  if (typeof input.dispatchId === 'string' && input.dispatchId.length > 0) return input.dispatchId;
  return process.env.PEAKS_DISPATCH_ID ?? 'current';
}

export function registerSubAgentShutdownCommands(program: Command, io: ProgramIO): void {
  // The existing `sub-agent-commands.ts` already creates the `sub-agent`
  // parent; this file attaches the `shutdown` subcommand to the same
  // parent via `findCommand` so we do not double-register. Fall back
  // to a standalone `peaks sub-agent-shutdown` parent if the parent
  // is not yet registered (e.g. when this file is loaded in isolation).
  const existing = (program.commands as ReadonlyArray<Command>).find(
    (c) => c.name() === 'sub-agent',
  );
  const root: Command = existing ?? program.command('sub-agent-shutdown')
    .description('Sub-agent shutdown registration (forensic hook)');
  const shutdown = root
    .command('shutdown')
    .description('Register local services for the parent to kill before merge-back');
  const sessionRoot = process.cwd();

  shutdown
    .command('register')
    .requiredOption('--pid <pid>', 'process id')
    .requiredOption('--name <label>', 'human-readable label (vite / mock-api / etc.)')
    .option('--url <url>', 'optional URL the service exposes')
    .option('--dispatch-id <id>', 'dispatch id; default = PEAKS_DISPATCH_ID env or "current"')
    .action(
      (options: { pid: string; name: string; url?: string; dispatchId?: string; json?: boolean }) => {
        try {
          const sid = getCurrentSessionId(sessionRoot) ?? 'unknown-sid';
          const file = registrationsPath({
            projectRoot: sessionRoot,
            sessionId: sid,
            dispatchId: resolveDispatchId(options),
          });
          const all = readAll(file);
          const reg: ServiceRegistration = {
            pid: Number(options.pid),
            name: options.name,
            ...(options.url !== undefined ? { url: options.url } : {}),
          };
          writeAll(file, [...all, reg]);
          printResult(io, ok('sub-agent.shutdown.register', { file, reg }), options.json);
        } catch (error) {
          printResult(
            io,
            fail(
              'sub-agent.shutdown.register',
              'REGISTER_FAILED',
              getErrorMessage(error),
              {},
              [getErrorMessage(error)],
            ),
            options.json,
          );
          process.exitCode = 1;
        }
      },
    );

  shutdown
    .command('unregister')
    .requiredOption('--pid <pid>', 'process id to remove from the registration list')
    .option('--dispatch-id <id>', 'dispatch id; default = PEAKS_DISPATCH_ID env or "current"')
    .action(
      (options: { pid: string; dispatchId?: string; json?: boolean }) => {
        try {
          const sid = getCurrentSessionId(sessionRoot) ?? 'unknown-sid';
          const file = registrationsPath({
            projectRoot: sessionRoot,
            sessionId: sid,
            dispatchId: resolveDispatchId(options),
          });
          const filtered = readAll(file).filter((r) => r.pid !== Number(options.pid));
          writeAll(file, filtered);
          printResult(io, ok('sub-agent.shutdown.unregister', { file, removed: options.pid }), options.json);
        } catch (error) {
          printResult(
            io,
            fail(
              'sub-agent.shutdown.unregister',
              'UNREGISTER_FAILED',
              getErrorMessage(error),
              {},
              [getErrorMessage(error)],
            ),
            options.json,
          );
          process.exitCode = 1;
        }
      },
    );

  shutdown
    .command('list')
    .option('--dispatch-id <id>', 'dispatch id; default = PEAKS_DISPATCH_ID env or "current"')
    .option('--json', 'emit JSON envelope')
    .action((options: { dispatchId?: string; json?: boolean }) => {
      try {
        const sid = getCurrentSessionId(sessionRoot) ?? 'unknown-sid';
        const file = registrationsPath({
          projectRoot: sessionRoot,
          sessionId: sid,
          dispatchId: resolveDispatchId(options),
        });
        printResult(
          io,
          ok('sub-agent.shutdown.list', { file, registrations: readAll(file) }),
          options.json,
        );
      } catch (error) {
        printResult(
          io,
          fail(
            'sub-agent.shutdown.list',
            'LIST_FAILED',
            getErrorMessage(error),
            {},
            [getErrorMessage(error)],
          ),
          options.json,
        );
        process.exitCode = 1;
      }
    });
}