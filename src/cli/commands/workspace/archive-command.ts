/**
 * `peaks workspace archive` — slice 0.5 Task 9.
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 2026-06-16-workspace-commands-split). Moves a session from
 * `_runtime/<sid>/` to `_archive/<yyyy-mm>/<sid>/`. The yyyy-mm
 * prefix is derived from the sid. Dry-run by default.
 */

import type { Command } from 'commander';
import { archiveSession } from '../../../services/workspace/workspace-archive-service.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../../cli-helpers.js';

type WorkspaceArchiveOptions = {
  session: string;
  apply?: boolean;
  project: string;
  json?: boolean;
};

export function registerWorkspaceArchiveCommand(workspace: Command, _io: ProgramIO): void {
  workspace
    .command('archive')
    .description(
      'Archive a session from _runtime/<sid>/ to _archive/<yyyy-mm>/<sid>/ ' +
        'where <yyyy-mm> is derived from the sid prefix. Dry-run by default; ' +
        'pass --apply to commit. The --session sid must match the canonical ' +
        'YYYY-MM-DD-... format enforced by the SID naming guard.'
    )
    .requiredOption('--session <sid>', 'session id in YYYY-MM-DD-<slug> form')
    .option('--apply', 'actually move the session (default is dry-run)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action((opts: WorkspaceArchiveOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project);
        const apply = opts.apply === true;
        const result = archiveSession(projectRoot, { sid: opts.session, apply });
        if (opts.json === true) {
          process.stdout.write(
            JSON.stringify({
              ok: true,
              data: { dryRun: !apply, moved: result.moved, skipped: result.skipped }
            }) + '\n'
          );
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
