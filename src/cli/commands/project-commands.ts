import { Command } from 'commander';
import { loadProjectDashboard } from '../../services/dashboard/project-dashboard-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectDashboardOptions = {
  project: string;
  json?: boolean;
};

export function registerProjectCommands(program: Command, io: ProgramIO): void {
  const project = program.command('project').description('Aggregate Peaks state for a target project (read-only)');

  addJsonOption(
    project
      .command('dashboard')
      .description('One-call snapshot of doctor / MCP / OpenSpec / requests / Understand Anything / capabilities for a project')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: ProjectDashboardOptions) => {
    try {
      const dashboard = await loadProjectDashboard({ projectRoot: options.project });
      if (!dashboard.runbookHealth.ok) {
        const suggestions = [
          dashboard.runbookHealth.missingRunbook.length > 0
            ? `Add a ## Default runbook section to: ${dashboard.runbookHealth.missingRunbook.join(', ')}`
            : null,
          dashboard.runbookHealth.applyNoteFailed.length > 0
            ? `Add authorization/--dry-run notes next to destructive --apply lines in: ${dashboard.runbookHealth.applyNoteFailed.join(', ')}`
            : null
        ].filter((line): line is string => line !== null);
        printResult(
          io,
          fail(
            'project.dashboard',
            'PROJECT_DASHBOARD_RUNBOOK_UNHEALTHY',
            `Skill runbook health failing: ${dashboard.runbookHealth.healthy}/${dashboard.runbookHealth.required} healthy`,
            dashboard,
            suggestions
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (!dashboard.doctor.ok) {
        printResult(
          io,
          fail(
            'project.dashboard',
            'PROJECT_DASHBOARD_DOCTOR_FAILED',
            `Doctor reports ${dashboard.doctor.failed} failed check(s) (${dashboard.doctor.passed} passed)`,
            dashboard,
            ['Run `peaks doctor --json` and resolve the failing checks before re-running the dashboard']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('project.dashboard', dashboard), options.json);
    } catch (error) {
      printResult(
        io,
        fail('project.dashboard', 'PROJECT_DASHBOARD_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
