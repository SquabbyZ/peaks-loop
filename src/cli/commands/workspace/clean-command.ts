/**
 * `peaks workspace clean` — slice 0.5 Task 9.
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 2026-06-16-workspace-commands-split). Combines two cleanup axes:
 * --runtime prunes _runtime/<sid>/ older than --older-than hours; and
 * --sub-agents --invalid moves bare/invalid sids from _sub_agents/ to
 * _archive/invalid-sids/. Dry-run by default; pass --apply to commit.
 */

import type { Command } from 'commander';
import {
  executeRuntimeCleanup,
  executeSubAgentClean,
} from '../../../services/workspace/workspace-clean-service.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../../cli-helpers.js';

type WorkspaceCleanOptions = {
  runtime?: boolean;
  subAgents?: boolean;
  invalid?: boolean;
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
      'Clean stale or invalid workspace artifacts (dry-run by default; pass --apply to commit). ' +
        'Combines two cleanup axes: --runtime prunes _runtime/<sid>/ directories older than ' +
        '--older-than hours (with --grace-hours safety window); --sub-agents --invalid moves ' +
        'bare/invalid sids from _sub_agents/ to _archive/invalid-sids/.'
    )
    .option('--runtime', 'clean _runtime/ sessions older than --older-than')
    .option('--sub-agents', 'clean _sub_agents/ entries')
    .option('--invalid', 'with --sub-agents: only move bare/invalid sids to _archive/invalid-sids/')
    .option('--older-than <hours>', 'age threshold in hours (default 168 = 7d)', '168')
    .option('--grace-hours <hours>', 'safety grace period in hours added to --older-than (default 24)', '24')
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action((opts: WorkspaceCleanOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project);
        const apply = opts.apply === true;
        const envelopes: unknown[] = [];
        if (opts.runtime === true) {
          const result = executeRuntimeCleanup(projectRoot, {
            olderThanHours: Number.parseInt(opts.olderThan, 10),
            graceHours: Number.parseInt(opts.graceHours, 10),
            apply
          });
          envelopes.push({ dryRun: !apply, deleted: result.deleted, skipped: result.skipped });
        }
        if (opts.subAgents === true && opts.invalid === true) {
          const result = executeSubAgentClean(projectRoot, { apply });
          envelopes.push({ dryRun: !apply, moved: result.moved, skipped: result.skipped });
        }
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: envelopes }) + '\n');
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
