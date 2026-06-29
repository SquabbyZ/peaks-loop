import type { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { loadBindingStatus, formatTable, formatJson, type BindingStatusFormat } from '../../../services/session/binding-status-service.js';
import { fail, ok } from '../../../shared/result.js';

// v2.18.2 PATCH scope (follow-up issues #2). Read-only introspection
// CLI. Surface is intentionally minimal: one subcommand
// (`peaks binding status`), two output modes (table + json), one
// project-root override (`--project`). The `--stale` warning is
// non-fatal: it prints to stderr and is also surfaced as a `stale`
// field in the JSON envelope, so downstream automation can act on it
// without parsing CLI prose.
export function registerBindingCommands(program: Command, io: ProgramIO): void {
  const binding = program.command('binding').description('Inspect and manage the project-level binding store (v2.18.2)');

  addJsonOption(
    binding
      .command('status')
      .description('Print the current binding-store contents (sids, callerIds, pids, lastHeartbeat, roles). Read-only.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--format <format>', 'output format: table (default for non-TTY) | json', 'table')
  ).action((options: { json?: boolean; project?: string; format?: string }) => {
    const projectRoot = options.project ?? (findProjectRoot(process.cwd()) ?? process.cwd());
    const view = loadBindingStatus(projectRoot);

    // Mode resolution priority: --json flag beats --format. The
    // double-flag form is intentional: `--json` keeps back-compat
    // with the v2.18.0 doctor envelope shape, `--format json` is the
    // explicit opt-in for users who want the table-by-default
    // behaviour but script-friendly output.
    const useJson = options.json === true || options.format === 'json';
    const format: BindingStatusFormat = useJson ? 'json' : 'table';

    if (useJson) {
      const payload = formatJson(view);
      const result = view.binding === null
        ? ok('binding.status', { ...payload, note: 'no binding found; run `peaks workspace init --project <repo>` to create one' })
        : ok('binding.status', payload);
      printResult(io, result, true);
    } else {
      if (view.binding === null) {
        const result = fail('binding.status', 'NO_BINDING', 'no binding found for the project', { projectRoot }, [
          `Run \`peaks workspace init --project <repo>\` to create one`
        ]);
        printResult(io, result, false);
        process.exitCode = 1;
        return;
      }
      const table = formatTable(view);
      if (table === '') {
        io.stdout('  (binding has no instances)');
      } else {
        io.stdout(table);
      }
      io.stdout(`\n  source: ${view.source}`);
      io.stdout(`  instances: ${Object.keys(view.binding.instances).length}`);
      if (view.stale) {
        io.stderr(`\n  warning: current outer-session-id (${view.outerSessionId}) does not match any binding callerId; this binding is stale (v2.15.0 sticky-mode contract)`);
      }
    }
  });
}
