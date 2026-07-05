/**
 * Slice 2 of the peaks-solo → peaks-code rename plan.
 *
 * `peaks session migrate-skill-name --from <old> --to <new> [--apply]
 * [--project <path>] [--json]` — idempotent string-rewrite across
 * `.peaks/_runtime/**`. Dry-run by default; pass `--apply` to write
 * through. Skip-paths (`.peaks/memory/**`,
 * `.peaks/skills/.system/bees/<old>/`) are recorded in `skipped`
 * and never opened, so older memory capsules and the bee manifest
 * for the old skill stay untouched.
 *
 * JSON envelope shape is owned by `MigrateResultSchema` in
 * `src/services/migrate-skill-name/schema.ts`. Plain-text mode is
 * a one-screen counter summary; `--json` mode is for tools.
 */
import type { Command } from 'commander';
import { resolve } from 'node:path';
import { migrateSkillName } from '../../services/migrate-skill-name/migrate.js';
import { getErrorMessage } from '../cli-helpers.js';

type SessionMigrateSkillNameOptions = {
  from: string;
  to: string;
  apply?: boolean;
  project?: string;
  json?: boolean;
};

export function registerSessionMigrateSkillNameCommand(session: Command): void {
  session
    .command('migrate-skill-name')
    .description(
      'Rewrite skill-name strings under .peaks/_runtime/** (idempotent, dry-run by default). ' +
      'Use --apply to write through. Skips .peaks/memory/** and .peaks/skills/.system/bees/.',
    )
    .requiredOption('--from <old>', 'old skill name (e.g. peaks-solo)')
    .requiredOption('--to <new>', 'new skill name (e.g. peaks-code)')
    .option('--apply', 'write through (default is dry-run)', false)
    .option('--project <path>', 'project root (defaults to current directory)', '.')
    .option('--json', 'emit a JSON envelope to stdout', false)
    .action((opts: SessionMigrateSkillNameOptions) => {
      try {
        const projectRoot = resolve(process.cwd(), opts.project ?? '.');
        const result = migrateSkillName({
          projectRoot,
          from: opts.from,
          to: opts.to,
          apply: opts.apply === true,
        });
        if (opts.json === true) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          process.stdout.write(
            `Scanned: ${result.scannedFiles}\n` +
            `Modified: ${result.modifiedFiles}\n` +
            `Key-value replacements: ${result.keyValueReplacements}\n` +
            `String replacements: ${result.stringReplacements}\n` +
            `Skipped: ${result.skipped.length} path(s)\n` +
            `Errors: ${result.errors.length}\n`,
          );
        }
        process.exitCode = result.ok ? 0 : 1;
      } catch (error) {
        process.stderr.write(getErrorMessage(error) + '\n');
        process.exitCode = 1;
      }
    });
}
