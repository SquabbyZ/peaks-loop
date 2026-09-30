/**
 * `peaks workflow plan <read|refresh|detect-trigger>` — slice 025 CLI.
 *
 * Three subcommands under the existing `peaks workflow` verb:
 * - `read <security|perf> --project <repo> --json`
 * - `refresh <security|perf> --project <repo> [--apply] --json`
 * - `detect-trigger --project <repo> --rid <rid> [--refresh] --json`
 *
 * CLI justification (per dev-preference rules):
 * - `read`           (2) JSON-gated — slice workflow reads plan hash.
 * - `refresh`        (3) destructive write needs explicit `--apply`.
 * - `detect-trigger` (2) JSON-gated — slice workflow needs the verdict.
 *
 * strict-remediation c1 split: the action handlers and session/project
 * resolution moved to `workflow-plan-commands-actions.ts` and
 * `workflow-plan-commands-session.ts`. This module keeps only the commander
 * registration and re-exports the action entry points, so the public surface —
 * `registerWorkflowPlanCommands` plus the underscore test hooks `_runPlanRead` /
 * `_runPlanRefresh` / `_runPlanDetectTrigger` — is byte-for-byte the same that
 * `_register.ts` and the integration suite already import.
 */
import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import {
  runPlanDetectTrigger,
  runPlanRead,
  runPlanRefresh,
  type PlanDetectTriggerOptions,
  type PlanReadOptions,
  type PlanRefreshOptions
} from './workflow-plan-commands-actions.js';

/** Options shared by all three plan subcommands (registered on the command). */
function withPlanCommonOptions(command: Command): Command {
  return command
    .option('--project <path>', 'project root', process.cwd())
    .option('--session-id <sid>', 'session id (defaults to the active session)');
}

export function registerWorkflowPlanCommands(program: Command, io: ProgramIO): void {
  const workflowCmd =
    program.commands.find((c) => c.name() === 'workflow') ??
    program.command('workflow').description('Plan workflow routing dry-run graphs');
  const plan = workflowCmd
    .command('plan')
    .description('Read, refresh, or detect-trigger for security / perf plans (slice 025)');

  addJsonOption(
    withPlanCommonOptions(
      plan
        .command('read')
        .description('Read the project-level plan envelope (exists, path, hash, refreshedAt)')
        .requiredOption('--type <type>', 'plan type: security or perf')
    )
  ).action((options: PlanReadOptions) => {
    runPlanRead(io, options);
  });

  addJsonOption(
    withPlanCommonOptions(
      plan
        .command('refresh')
        .description('Regenerate the plan (deterministic, idempotent; --apply to write)')
        .requiredOption('--type <type>', 'plan type: security or perf')
    ).option('--apply', 'write the plan to disk (default is dry-run preview)')
  ).action((options: PlanRefreshOptions) => {
    runPlanRefresh(io, options);
  });

  addJsonOption(
    withPlanCommonOptions(
      plan
        .command('detect-trigger')
        .description('Detect whether a plan refresh is warranted for the slice diff')
        .requiredOption('--rid <rid>', 'request identifier')
    ).option('--refresh', 'force triggered=true (manual override)')
  ).action((options: PlanDetectTriggerOptions) => {
    runPlanDetectTrigger(io, options);
  });
}

// Re-export for tests that need a programmatic entry point.
export { runPlanRead as _runPlanRead };
export { runPlanRefresh as _runPlanRefresh };
export { runPlanDetectTrigger as _runPlanDetectTrigger };
