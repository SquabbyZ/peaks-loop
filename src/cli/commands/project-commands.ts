import { Command } from 'commander';
import { loadProjectDashboard } from '../../services/dashboard/project-dashboard-service.js';
import { generateProjectContext, readProjectContext } from '../../services/memory/project-context-service.js';
import { readProjectMemories } from '../../services/memory/project-memory-service.js';
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
      if (dashboard.skillPresence.active && !dashboard.skillPresence.fresh) {
        printResult(
          io,
          fail(
            'project.dashboard',
            'PROJECT_DASHBOARD_STALE_SKILL_PRESENCE',
            `Active Peaks skill presence ${dashboard.skillPresence.skill ?? '<unknown>'} is stale (set ${dashboard.skillPresence.setAt ?? '<unknown>'})`,
            dashboard,
            ['Run `peaks skill presence:clear` if the role has ended, or `peaks skill presence:set <skill>` to refresh it']
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

  addJsonOption(
    project
      .command('context')
      .description('Generate or read persistent project context for cross-session Peaks understanding')
      .requiredOption('--project <path>', 'target project root')
      .option('--read', 'read existing PROJECT.md without regenerating')
  ).action((options: { project: string; read?: boolean; json?: boolean }) => {
    try {
      if (options.read) {
        const content = readProjectContext(options.project);
        if (content === null) {
          printResult(io, ok('project.context', { exists: false, path: `${options.project}/.peaks/PROJECT.md` }), options.json);
          return;
        }
        printResult(io, ok('project.context', { exists: true, path: `${options.project}/.peaks/PROJECT.md`, content }), options.json);
        return;
      }
      const result = generateProjectContext(options.project);
      printResult(io, ok('project.context', {
        path: result.path,
        sessionCount: result.sessionCount,
        content: result.content
      }), options.json);
    } catch (error) {
      printResult(io, fail('project.context', 'PROJECT_CONTEXT_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .peaks directory']), options.json);
      process.exitCode = 1;
    }
  });

  // --- Structured project memory (durable, LLM-authored, stored under .peaks/memory) ---
  addJsonOption(
    project
      .command('memories')
      .description('Read durable project memories (decisions, conventions, modules, rules) from .peaks/memory for LLM consumption')
      .requiredOption('--project <path>', 'target project root')
      .option('--kind <kind>', 'filter by kind: project, rule, decision, reference, feedback, convention, module')
  ).action((options: { project: string; kind?: string; json?: boolean }) => {
    try {
      const result = readProjectMemories(options.project);
      if (options.kind) {
        const memories = result.memories.filter((memory) => memory.kind === options.kind);
        printResult(io, ok('project.memories', {
          memoryDir: result.memoryDir,
          kind: options.kind,
          total: memories.length,
          memories
        }), options.json);
        return;
      }
      printResult(io, ok('project.memories', {
        memoryDir: result.memoryDir,
        total: result.total,
        byKind: result.byKind,
        memories: result.memories
      }), options.json);
    } catch (error) {
      printResult(io, fail('project.memories', 'PROJECT_MEMORIES_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .peaks/memory directory']), options.json);
      process.exitCode = 1;
    }
  });
}
