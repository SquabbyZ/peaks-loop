/**
 * `peaks workspace reconcile` — slice 006 + slice 0.5.
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 2026-06-16-workspace-commands-split) to keep that entry file under the
 * 800-line Karpathy cap. Scans the legacy 2026-MM-DD-session dirs and
 * consolidates the runtime state.
 *
 * Migration (1), repoint (2), and marker sync (3) always run regardless
 * of `--apply`. Deletion of old session dirs is dry-run by default.
 */

import type { Command } from 'commander';
import { reconcileWorkspace } from '../../../services/workspace/reconcile-service.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

// Inlined from the original 925-line workspace-commands.ts; the import
// path '../../../shared/duration.js' did not exist and the constants
// were used as bare identifiers in the legacy file. Future refactor:
// move to a shared module.
const DEFAULT_RECONCILE_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type WorkspaceReconcileOptions = {
  project: string;
  json?: boolean;
  apply?: boolean;
  olderThan?: number;
};

export function registerWorkspaceReconcileCommand(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('reconcile')
      .description(
        'Scan .peaks/2026-MM-DD-session-*/ directories and consolidate the runtime state. ' +
          'By default (no --apply) the command performs four actions:\n' +
          '  1. Migrates legacy runtime files into .peaks/_runtime/: ' +
          '.peaks/.session.json -> .peaks/_runtime/session.json, ' +
          '.peaks/.active-skill.json -> .peaks/_runtime/active-skill.json, ' +
          '.peaks/sop-state/ -> .peaks/_runtime/sop-state/ ' +
          '(idempotent; no-op if already on the new layout).\n' +
          '  2. Re-points .peaks/_runtime/session.json to the canonical session ' +
          'using a 4-tier heuristic: active-skill binding -> latest session.json mtime -> ' +
          'latest any-file mtime -> dir-name sort.\n' +
          '  3. (slice 006) Syncs the single change/<sid>/ live marker under ' +
          '.peaks/_runtime/change/. The marker is an empty directory; every other ' +
          'entry under change/ is removed. Also cleans up the F3-introduced ' +
          '.peaks/_runtime/<sid>/system/ subdir (no-op if already absent).\n' +
          '  4. REPORTS (but does not delete) session dirs older than --older-than <days> ' +
          `(default ${DEFAULT_RECONCILE_AGE_DAYS}) as deletion candidates; this is the only step that is dry-run by default.\n` +
          'Pass --apply to additionally REMOVE the listed candidate dirs (destructive). ' +
          'Migration (1), repoint (2), and marker sync (3) always run regardless of --apply.'
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
      if (result.changeMarker.created !== null) {
        nextActions.push(`Synced change/<${result.changeMarker.created}>/ live marker.`);
      } else if (result.canonicalSessionId !== null) {
        nextActions.push(`change/<${result.canonicalSessionId}>/ live marker already in place.`);
      }
      if (result.changeMarker.removed.length > 0) {
        nextActions.push(`Removed ${result.changeMarker.removed.length} stale change/<oldSid>/ marker(s).`);
      }
      if (result.systemCleaned.length > 0) {
        nextActions.push(`Removed ${result.systemCleaned.length} F3 system/ subdir(s).`);
      }
      if (result.subAgentStateMigrated > 0) {
        nextActions.push(`Migrated ${result.subAgentStateMigrated} legacy sub-agent state file(s) into .peaks/_sub_agents/.`);
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
