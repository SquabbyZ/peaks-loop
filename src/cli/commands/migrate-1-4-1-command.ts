/**
 * `peaks workspace migrate-1-4-1` — R004 subcommand.
 *
 * Cleanup helper for projects upgraded from 1.4.1 → 1.4.2. Moves per-session
 * files from the legacy `.peaks/_runtime/<sid>/<role>/<file>.md` path into the canonical
 * `.peaks/_runtime/<sid>/<role>/<file>.md` path. Default is dry-run; pass
 * `--apply` to actually `rename` the files and remove emptied legacy dirs.
 */

import type { Command } from 'commander';

import { ok, fail, type ResultEnvelope } from 'peaks-loop-shared/result';

import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { planMigrate1_4_1, applyMigrate1_4_1 } from '../../services/workspace/migrate-1-4-1-service.js';

export function registerMigrate1_4_1Command(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('migrate-1-4-1')
      .description(
        'R004: Move per-session files from the legacy `.peaks/_runtime/<sid>/<role>/<file>.md` path into the canonical `.peaks/_runtime/<sid>/<role>/<file>.md` path. ' +
          'Default: dry-run. Pass --apply to actually `rename` the files and remove emptied legacy dirs. ' +
          'Reads each file once, computes sha256, compares to canonical. Identical-content duplicates are removed from legacy. Content-mismatch files are reported and NOT deleted (manual review).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually rename the files and remove empty legacy dirs (destructive); without it, dry-run only', false)
  ).action(async (options: { project: string; apply?: boolean; json?: boolean }) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const apply = options.apply === true;
      const result = apply ? applyMigrate1_4_1(projectRoot) : planMigrate1_4_1(projectRoot);
      const envelope: ResultEnvelope<typeof result> = ok('workspace.migrate-1-4-1', result);
      io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
    } catch (err) {
      const envelope = fail('workspace.migrate-1-4-1', 'MIGRATE_FAILED', (err as Error).message, null, ['Run with --apply to attempt the move (default is dry-run only)']);
      io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
      process.exitCode = 1;
    }
  });
}
