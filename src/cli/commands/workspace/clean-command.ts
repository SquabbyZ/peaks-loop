/**
 * `peaks workspace clean` — slice 0.5 Task 9 (runtime-only after
 * slice 2026-06-27-archive-feature-removal).
 *
 * Prunes _runtime/<sid>/ directories older than --older-than hours.
 * Dry-run by default; pass --apply to commit. The previous
 * The legacy sub-agents / bare-sid cleanup axis (which moved bare
 * sids to a forensic dir) was removed when the archive dir was
 * retired; bare sids are now blocked at write time. sids
 * are now blocked at write time by `sid-naming-guard.ts`.
 */

import type { Command } from 'commander';
import { executeRuntimeCleanup } from '../../../services/workspace/workspace-clean-service.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../../cli-helpers.js';

type WorkspaceCleanOptions = {
  olderThan: string;
  graceHours: string;
  apply?: boolean;
  project: string;
  json?: boolean;
};

export function registerWorkspaceCleanCommand(workspace: Command, _io: ProgramIO): void {
  workspace
    .command('clean')
    .description(
      'Clean stale workspace artifacts (dry-run by default; pass --apply to commit). ' +
        'Prunes _runtime/<sid>/ directories older than --older-than hours ' +
        '(with --grace-hours safety window).'
    )
    .option('--older-than <hours>', 'age threshold in hours (default 168 = 7d)', '168')
    .option('--grace-hours <hours>', 'safety grace period in hours added to --older-than (default 24)', '24')
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action((opts: WorkspaceCleanOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project);
        const apply = opts.apply === true;
        const result = executeRuntimeCleanup(projectRoot, {
          olderThanHours: Number.parseInt(opts.olderThan, 10),
          graceHours: Number.parseInt(opts.graceHours, 10),
          apply
        });
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: { dryRun: !apply, deleted: result.deleted, skipped: result.skipped } }) + '\n');
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
