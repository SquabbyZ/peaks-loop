// src/cli/commands/project-dashboard-command.ts
//
// `peaks project dashboard` — one-call snapshot of doctor / MCP / OpenSpec /
// requests / capabilities for a project. Split out of `project-commands.ts`;
// the verb name, its options, the gate order and the envelope shape are
// unchanged.

import type { Command } from 'commander';
import {
  loadProjectDashboard,
  type ProjectDashboard,
  type ProjectDashboardRunbookHealth
} from '../../services/dashboard/project-dashboard-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectDashboardOptions = {
  project: string;
  json?: boolean;
  strict?: boolean;
};

/** The runbook repairs the envelope names — only the ones that apply. */
function runbookSuggestions(health: ProjectDashboardRunbookHealth): string[] {
  return [
    health.missingRunbook.length > 0
      ? `Add a ## Default runbook section to: ${health.missingRunbook.join(', ')}`
      : null,
    health.applyNoteFailed.length > 0
      ? `Add authorization/--dry-run notes next to destructive --apply lines in: ${health.applyNoteFailed.join(', ')}`
      : null
  ].filter((line): line is string => line !== null);
}

/** Runbook health — the first gate. */
function runbookRefusal(dashboard: ProjectDashboard): ReturnType<typeof fail> | null {
  const health = dashboard.runbookHealth;
  if (health.ok) return null;
  return fail(
    'project.dashboard',
    'PROJECT_DASHBOARD_RUNBOOK_UNHEALTHY',
    `Skill runbook health failing: ${health.healthy}/${health.required} healthy`,
    dashboard,
    runbookSuggestions(health)
  );
}

/** A stale active skill presence — the second gate. */
function skillPresenceRefusal(dashboard: ProjectDashboard): ReturnType<typeof fail> | null {
  const presence = dashboard.skillPresence;
  if (!presence.active || presence.fresh) return null;
  return fail(
    'project.dashboard',
    'PROJECT_DASHBOARD_STALE_SKILL_PRESENCE',
    `Active Peaks skill presence ${presence.skill ?? '<unknown>'} is stale (set ${presence.setAt ?? '<unknown>'})`,
    dashboard,
    [
      'Run `peaks skill presence:clear` if the role has ended, or `peaks skill presence:set <skill>` to refresh it'
    ]
  );
}

/** The doctor aggregate under `--strict` — the third gate. */
function doctorRefusal(
  dashboard: ProjectDashboard,
  strict: boolean
): ReturnType<typeof fail> | null {
  if (dashboard.doctor.ok || !strict) return null;
  return fail(
    'project.dashboard',
    'PROJECT_DASHBOARD_DOCTOR_STRICT_FAIL',
    `Doctor reports ${dashboard.doctor.failed} failed check(s) (${dashboard.doctor.passed} passed) — --strict mode requires the doctor aggregate to pass`,
    dashboard,
    [
      'Run `peaks doctor --json` and resolve the failing checks, or drop --strict to use the workspace-only policy'
    ]
  );
}

/** The first gate that refuses, in the declared order: runbook → presence → doctor. */
function dashboardRefusal(
  dashboard: ProjectDashboard,
  strict: boolean
): ReturnType<typeof fail> | null {
  return (
    runbookRefusal(dashboard) ?? skillPresenceRefusal(dashboard) ?? doctorRefusal(dashboard, strict)
  );
}

async function runProjectDashboard(io: ProgramIO, options: ProjectDashboardOptions): Promise<void> {
  try {
    const dashboard = await loadProjectDashboard({
      projectRoot: options.project,
      okPolicy: options.strict === true ? 'strict' : 'workspace-only'
    });
    const refusal = dashboardRefusal(dashboard, options.strict === true);
    if (refusal !== null) {
      printResult(io, refusal, options.json);
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('project.dashboard', dashboard), options.json);
  } catch (error) {
    printResult(
      io,
      fail(
        'project.dashboard',
        'PROJECT_DASHBOARD_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Check the project path before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerProjectDashboardCommand(project: Command, io: ProgramIO): void {
  addJsonOption(
    project
      .command('dashboard')
      .description(
        'One-call snapshot of doctor / MCP / OpenSpec / requests / capabilities for a project'
      )
      .requiredOption('--project <path>', 'target project root')
      .option(
        '--strict',
        'ok follows the doctor aggregate (legacy semantics). Default: workspace-only (ok tracks the runbook health)',
        false
      )
  ).action((options: ProjectDashboardOptions) => runProjectDashboard(io, options));
}
