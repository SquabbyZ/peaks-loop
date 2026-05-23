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
