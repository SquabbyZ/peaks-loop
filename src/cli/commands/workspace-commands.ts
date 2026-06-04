import { Command } from 'commander';
import { initWorkspace, InvalidSessionIdError, ConflictingSessionError } from '../../services/workspace/workspace-service.js';
import { reconcileWorkspace } from '../../services/workspace/reconcile-service.js';
import { ensureSession } from '../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type WorkspaceInitOptions = {
  project: string;
  sessionId?: string;
  json?: boolean;
  allowSessionRebind?: boolean;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RECONCILE_AGE_DAYS = 7;

type WorkspaceReconcileOptions = {
  project: string;
  json?: boolean;
  apply?: boolean;
  olderThan?: number;
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
      //     .peaks/_runtime/session.json so the binding sticks.
      //
      // Before that: canonicalise the project root. If the user (or the
      // LLM via "$(pwd)") passed a sub-directory of a real git repo
      // (e.g. prompt-project/prompt-project/ inside the outer
      // prompt-project/.git), promote the path to the git root. Without
      // this, peaks would build a parallel .peaks/ tree under the
      // nested sub-folder and silently break the project-binding model
      // (the same regression that produced prompt-project/.peaks/ in
      // the 5/27-5/29 sessions). When startPath is not inside any
      // git repo, the helper falls through to the cwd verbatim.
      const projectRoot = resolveCanonicalProjectRoot(options.project);

      let sessionId: string;
      if (options.sessionId !== undefined && options.sessionId.length > 0) {
        sessionId = options.sessionId;
      } else {
        sessionId = await ensureSession(projectRoot);
      }

      const report = await initWorkspace({
        projectRoot,
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

  addJsonOption(
    workspace
      .command('reconcile')
      .description(
        'Scan .peaks/2026-MM-DD-session-*/ directories and re-point .peaks/_runtime/session.json ' +
          'to the canonical session (4-tier heuristic: active-skill binding -> latest session.json mtime -> ' +
          'latest any-file mtime -> dir-name sort). Also migrates any legacy .peaks/.session.json / ' +
          '.peaks/.active-skill.json / .peaks/sop-state/ into .peaks/_runtime/ (idempotent; no-op on a ' +
          'tree that is already on the new layout). By default the command is a dry-run: it reports empty / abandoned ' +
          `session dirs older than ${DEFAULT_RECONCILE_AGE_DAYS} days as deletion candidates but does not delete them. ` +
          'Pass --apply to actually remove the listed candidate dirs (destructive). ' +
          'Override the age threshold with --older-than <days>.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually delete the deletion candidates (destructive); without it, dry-run only', false)
      .option('--older-than <days>', `age threshold in days for deletion candidates (default: ${DEFAULT_RECONCILE_AGE_DAYS})`, (value: string) => Number.parseFloat(value))
  ).action((options: WorkspaceReconcileOptions) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const olderThanDays = options.olderThan ?? DEFAULT_RECONCILE_AGE_DAYS;
      if (typeof olderThanDays !== 'number' || !Number.isFinite(olderThanDays) || olderThanDays <= 0) {
        printResult(
          io,
          fail('workspace.reconcile', 'INVALID_AGE_THRESHOLD', `--older-than must be a positive number of days`, { provided: options.olderThan }, ['Use --older-than 7 (or omit it to accept the 7-day default)']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const olderThanMs = olderThanDays * MS_PER_DAY;
      const apply = options.apply === true;

      const result = reconcileWorkspace({
        projectRoot,
        apply,
        olderThanMs
      });

      const warnings: string[] = [];
      if (result.sessions.length === 0) {
        warnings.push('No session directories found under .peaks/. Run peaks workspace init first.');
      }
      if (apply && result.deleted.length > 0) {
        warnings.push(`Deleted ${result.deleted.length} session dir(s) older than ${olderThanDays} day(s).`);
      }

      const nextActions: string[] = [];
      if (result.migratedFiles.length > 0) {
        nextActions.push(`Migrated ${result.migratedFiles.length} legacy runtime file(s) into .peaks/_runtime/: ${result.migratedFiles.join(', ')}.`);
      }
      if (result.repointed) {
        nextActions.push(`Re-pointed .peaks/_runtime/session.json from ${result.repointedFrom ?? '<unbound>'} to ${result.repointedTo}.`);
      }
      if (!apply && result.wouldDelete.length > 0) {
        nextActions.push(`Re-run with --apply to delete ${result.wouldDelete.length} candidate dir(s).`);
      }

      printResult(io, ok('workspace.reconcile', result, warnings, nextActions), options.json);

      if (result.errors.length > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('workspace.reconcile', 'WORKSPACE_RECONCILE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
