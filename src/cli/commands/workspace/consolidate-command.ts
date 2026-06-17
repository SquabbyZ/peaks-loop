/**
 * `peaks workspace consolidate` — slice 011.
 *
 * Extends the workspace command group with the cross-date consolidation
 * primitive. Mirror of `archive-command.ts` and `clean-command.ts`.
 * Default dry-run; pass `--apply` to commit. Idempotent per-session
 * with atomic rollback on manifest-write failure.
 */

import type { Command } from 'commander';
import {
  CONSOLIDATE_CONSTANTS,
  executeConsolidate,
} from '../../../services/workspace/workspace-consolidate-service.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../../cli-helpers.js';

type WorkspaceConsolidateOptions = {
  apply?: boolean;
  keep?: string[];
  olderThan?: string;
  project: string;
  today?: string;
  json?: boolean;
};

function defaultTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerWorkspaceConsolidateCommand(workspace: Command, _io: ProgramIO): void {
  workspace
    .command('consolidate')
    .description(
      'Consolidate cross-date sessions: move _runtime/<sessionId>/ to ' +
        '_archive/retrospective-<YYYY-MM-DD>/<sessionId>/ with a manifest.json. ' +
        'Dry-run by default; pass --apply to commit. Sessions listed in --keep ' +
        `are never moved. Sessions within the --older-than window are skipped. ` +
        `Default --older-than is ${CONSOLIDATE_CONSTANTS.DEFAULT_OLDER_THAN_DAYS} day(s) (i.e. cross-date). ` +
        'Designed for skill-level invocation, not direct user calls.'
    )
    .option('--apply', 'actually move the sessions (default is dry-run)')
    .option('--keep <sessionId>', 'session id to keep (repeatable)', (value: string, prev: string[]) => {
      const arr = Array.isArray(prev) ? prev : [];
      arr.push(value);
      return arr;
    })
    .option('--older-than <days>', `age threshold in days (default ${CONSOLIDATE_CONSTANTS.DEFAULT_OLDER_THAN_DAYS})`, (value: string) => value)
    .option('--today <YYYY-MM-DD>', 'override the current date (test injection)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (opts: WorkspaceConsolidateOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project);
        const olderThanRaw = opts.olderThan ?? String(CONSOLIDATE_CONSTANTS.DEFAULT_OLDER_THAN_DAYS);
        const olderThanDays = Number.parseFloat(olderThanRaw);
        if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({
              ok: false,
              error: `INVALID_OLDER_THAN: --older-than must be a positive number of days (got "${olderThanRaw}")`
            }) + '\n');
          } else {
            process.stderr.write(`INVALID_OLDER_THAN: --older-than must be a positive number of days (got "${olderThanRaw}")\n`);
          }
          process.exitCode = 1;
          return;
        }
        const keep = new Set<string>(opts.keep ?? []);
        const today = opts.today ?? defaultTodayIso();
        const result = await executeConsolidate(projectRoot, {
          apply: opts.apply === true,
          keep,
          olderThanDays,
          today
        });
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({
            ok: true,
            data: {
              dryRun: result.plan.dryRun,
              today: result.plan.today,
              olderThanDays: result.plan.olderThanDays,
              keep: result.plan.keep,
              moved: result.moved,
              skipped: result.plan.skipped,
              rolledBack: result.rolledBack,
              errors: result.errors
            }
          }) + '\n');
        } else if (result.plan.dryRun) {
          const moveLines = result.plan.moves.map((m) => `  MOVE ${m.sourcePath} -> ${m.targetPath}`).join('\n');
          const skipLines = result.plan.skipped.map((s) => `  SKIP ${s.sessionId} (${s.reason})`).join('\n');
          process.stdout.write(
            `[dry-run] today=${result.plan.today} olderThan=${result.plan.olderThanDays}d keep=[${result.plan.keep.join(',')}]\n` +
            (moveLines.length > 0 ? `Would move:\n${moveLines}\n` : 'Would move: (none)\n') +
            (skipLines.length > 0 ? `Skipped:\n${skipLines}\n` : '')
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