/**
 * `peaks workspace migrate` — slice 003 (--to-runtime).
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 2026-06-16-workspace-commands-split) to keep that entry file under the
 * 800-line Karpathy cap. Migrates legacy `.peaks/<sid>/<role>/<file>`
 * into the new `.peaks/retrospective/<change-id>/<role>/<file>` layout.
 */

import type { Command } from 'commander';
import { migrateWorkspace } from '../../../services/workspace/migrate-service.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

type WorkspaceMigrateOptions = {
  project: string;
  apply?: boolean;
  toRuntime?: boolean;
  json?: boolean;
};

export function registerWorkspaceMigrateCommand(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('migrate')
      .description(
        'Migrate legacy `.peaks/<session-id>/<role>/<file>` content into the new layout: ' +
          '`.peaks/retrospective/<change-id>/<role>/<file>`. Each file is routed by a 4-tier ' +
          'change-id resolver (filename regex → content H1 → body frontmatter → per-session fallback ' +
          'to the most recent rd/requests entry). Cross-cutting files (project-scan, perf-baseline) ' +
          'and transient runtime files (session.json, system/) are skipped with reasons in the ' +
          'response. By default the command is a dry-run: it reports the planned moves + conflicts ' +
          'and the session dirs that WOULD be deleted. Pass --apply to actually `git mv` the files ' +
          'and `rm -rf` the emptied session dirs. Idempotent: re-running on an already-migrated tree ' +
          'is a no-op (all files report conflicts with identical content).' +
          '\n\nSlice 003 (--to-runtime): moves every top-level `.peaks/<sid>/` to `.peaks/_runtime/<sid>/` ' +
          'for projects still on the pre-runtime-layer layout. Idempotent: re-running on a tree ' +
          'that is already canonical is a no-op. F15 carve-out: top-level `rd/project-scan.md` is ' +
          'never overwritten when the runtime copy already exists with different content.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually `git mv` the files and delete the emptied session dirs (destructive); without it, dry-run only', false)
      .option(
        '--to-runtime',
        'slice 003: also consolidate every top-level .peaks/<sid>/ dir into .peaks/_runtime/<sid>/. Idempotent; conflicts are logged but never overwrite.',
        false
      )
  ).action(async (options: WorkspaceMigrateOptions) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const apply = options.apply === true;
      const toRuntime = options.toRuntime === true;
      const result = await migrateWorkspace({ projectRoot, apply, toRuntime });

      const warnings: string[] = [];
      if (result.sessions.length === 0 && (result.toRuntimePlans?.length ?? 0) === 0) {
        warnings.push('No legacy session directories found under .peaks/. Nothing to migrate.');
      } else if (result.wouldMove.length === 0 && (result.toRuntimePlans?.length ?? 0) === 0) {
        warnings.push('Legacy session dirs found but no reviewable content to migrate (all files were cross-cutting or transient).');
      }

      const nextActions: string[] = [];
      if (!apply && result.wouldMove.length > 0) {
        nextActions.push(`Re-run with --apply to perform ${result.wouldMove.length} move(s) and delete ${result.wouldDeleteSessions.length} session dir(s).`);
      }
      if (result.conflicts.length > 0) {
        nextActions.push(`${result.conflicts.length} file(s) already exist at the target path; review before --apply (or re-run after a partial migrate).`);
      }
      if (toRuntime) {
        const plans = result.toRuntimePlans ?? [];
        if (apply) {
          if ((result.toRuntimeMoved?.length ?? 0) > 0) {
            nextActions.push(`Moved ${result.toRuntimeMoved?.length} top-level session dir(s) to .peaks/_runtime/ (slice 003 --to-runtime).`);
          }
          if ((result.toRuntimeConflicts?.length ?? 0) > 0) {
            nextActions.push(`${result.toRuntimeConflicts?.length} --to-runtime conflict(s) — see response. ${plans.filter((p) => p.action === 'f15-conflict-project-scan').length} are F15 carve-outs (deferred to a separate slice).`);
          }
        } else {
          const wouldMoveCount = plans.filter((p) => p.action === 'moved').length;
          const wouldSkipCount = plans.filter((p) => p.action === 'skipped-already-canonical').length;
          if (wouldMoveCount > 0) {
            nextActions.push(`Re-run with --apply to move ${wouldMoveCount} top-level session dir(s) to .peaks/_runtime/; ${wouldSkipCount} already canonical.`);
          } else if (wouldSkipCount > 0) {
            nextActions.push(`All ${wouldSkipCount} top-level session dir(s) are already canonical — no moves needed.`);
          }
          const f15Count = plans.filter((p) => p.action === 'f15-conflict-project-scan').length;
          if (f15Count > 0) {
            nextActions.push(`${f15Count} F15 carve-out conflict(s) (rd/project-scan.md differs from runtime copy) — see response.`);
          }
        }
      }
      if (apply) {
        if (result.moved.length > 0) {
          nextActions.push(`Migrated ${result.moved.length} file(s) into .peaks/retrospective/.`);
        }
        if (result.deletedSessions.length > 0) {
          nextActions.push(`Deleted ${result.deletedSessions.length} emptied session dir(s).`);
        }
      }

      printResult(io, ok('workspace.migrate', result, warnings, nextActions), options.json ?? false);
    } catch (error) {
      printResult(io, fail('workspace.migrate', 'WORKSPACE_MIGRATE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']), options.json ?? false);
      process.exitCode = 1;
    }
  });
}
