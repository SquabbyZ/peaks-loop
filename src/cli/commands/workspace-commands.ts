import { Command } from 'commander';
import { initWorkspace, InvalidSessionIdError, ConflictingSessionError } from '../../services/workspace/workspace-service.js';
import { ensureSession } from '../../services/session/session-manager.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type WorkspaceInitOptions = {
  project: string;
  sessionId?: string;
  json?: boolean;
  allowSessionRebind?: boolean;
};

export function registerWorkspaceCommands(program: Command, io: ProgramIO): void {
  const workspace = program.command('workspace').description('Manage the Peaks per-session artifact workspace (.peaks/<session-id>/)');

  addJsonOption(
    workspace
      .command('init')
      .description('Create the .peaks/<session-id>/ directory structure (prd, ui, rd, qa, sc, txt, system) and bind the session as the project current one. Pass --session-id to use a specific id, or omit it to auto-generate one (and adopt an existing binding if present).')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <id>', 'optional session id in YYYY-MM-DD-<kebab-slug> format. When omitted, the CLI is the single source of truth: an existing binding is reused, otherwise a fresh id is auto-generated.')
      .option('--allow-session-rebind', 'overwrite an existing session binding when the requested session id differs from the project current one', false)
  ).action(async (options: WorkspaceInitOptions) => {
    try {
      // Resolve the session id. Two paths:
      //   - explicit --session-id: use it as the requested binding target
      //     (ConflictingSessionError fires if it conflicts with an in-flight
      //     session, unless --allow-session-rebind is set)
      //   - omitted: defer to ensureSession(), which reuses an existing
      //     binding or auto-generates a fresh one. The init then writes
      //     .session.json so the binding sticks.
      let sessionId: string;
      if (options.sessionId !== undefined && options.sessionId.length > 0) {
        sessionId = options.sessionId;
      } else {
        sessionId = await ensureSession(options.project);
      }

      const report = await initWorkspace({
        projectRoot: options.project,
        sessionId,
        allowSessionRebind: options.allowSessionRebind === true
      });
      const nextActions: string[] = [];
      if (report.previousSessionId !== null && report.bound) {
        nextActions.push(`Replaced prior session binding "${report.previousSessionId}" with "${report.sessionId}".`);
      }
      if (report.created.length === 0) {
        nextActions.push('Workspace already initialized — proceed to project scan.');
      } else {
        nextActions.push('Run `peaks scan archetype --project <path> --json` next to populate rd/project-scan.md.');
      }
      printResult(io, ok('workspace.init', report, [], nextActions), options.json);
    } catch (error) {
      if (error instanceof InvalidSessionIdError) {
        printResult(
          io,
          fail('workspace.init', error.code, error.message, { sessionId: options.sessionId }, ['Use a date-prefixed kebab slug like 2026-05-25-add-user-auth']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof ConflictingSessionError) {
        printResult(
          io,
          fail('workspace.init', error.code, error.message, {
            existingSessionId: error.existingSessionId,
            requestedSessionId: error.requestedSessionId
          }, [
            `Finish or abandon session "${error.existingSessionId}" first, then re-run workspace init.`,
            'Or pass --allow-session-rebind to override the binding (overwrites the prior binding).'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(
        io,
        fail('workspace.init', 'WORKSPACE_INIT_FAILED', getErrorMessage(error), { projectRoot: options.project, sessionId: options.sessionId }, ['Verify the project path exists and is writable']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
