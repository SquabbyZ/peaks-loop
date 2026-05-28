import { Command } from 'commander';
import { loadProjectDashboard } from '../../services/dashboard/project-dashboard-service.js';
import { generateProjectContext, loadOntology, readProjectContext, upsertConvention, upsertDecision, upsertModule } from '../../services/memory/project-context-service.js';
import type { Decision, Module } from '../../services/memory/project-context-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

function defined<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result as T;
}

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

  // --- Ontology commands (structured project memory for LLM consumption) ---
  const ontology = project.command('ontology').description('Query structured project memory (modules, decisions, conventions)');

  addJsonOption(
    ontology
      .command('show')
      .description('Read the full ontology JSON for LLM consumption')
      .requiredOption('--project <path>', 'target project root')
  ).action((options: { project: string; json?: boolean }) => {
    try {
      const onto = loadOntology(options.project);
      if (onto === null) {
        // Auto-generate if missing
        const result = generateProjectContext(options.project);
        printResult(io, ok('project.ontology', result.ontology), options.json);
        return;
      }
      printResult(io, ok('project.ontology', onto), options.json);
    } catch (error) {
      printResult(io, fail('project.ontology', 'ONTOLOGY_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    ontology
      .command('module')
      .description('Record or query a project module')
      .requiredOption('--project <path>', 'target project root')
      .option('--id <id>', 'module id (kebab-case)')
      .option('--path <path>', 'file path for the module')
      .option('--risk <level>', 'risk level: low, medium, high')
      .option('--summary <text>', 'brief module description')
      .option('--session <id>', 'session id')
      .option('--put', 'write/update the module entry')
  ).action((options: { project: string; id?: string; path?: string; risk?: string; summary?: string; session?: string; put?: boolean; json?: boolean }) => {
    try {
      if (options.put) {
        if (!options.id || !options.path || !options.session) {
          printResult(io, fail('project.ontology.module', 'MISSING_FIELDS', '--id, --path, --session required with --put', {}, ['Provide all required fields']), options.json);
          process.exitCode = 1;
          return;
        }
        const risk = (options.risk === 'low' || options.risk === 'medium' || options.risk === 'high') ? options.risk : undefined;
        const result = upsertModule(options.project, defined({
          id: options.id,
          path: options.path,
          session: options.session,
          risk,
          summary: options.summary
        }) as Omit<Module, 'sessions'> & { session: string });
        printResult(io, ok('project.ontology.module', { modules: result.modules }), options.json);
        return;
      }
      const onto = loadOntology(options.project) ?? generateProjectContext(options.project).ontology;
      if (options.id) {
        const mod = onto.modules.find((m) => m.id === options.id);
        printResult(io, ok('project.ontology.module', mod ?? { notFound: true, id: options.id }), options.json);
        return;
      }
      printResult(io, ok('project.ontology.module', { modules: onto.modules }), options.json);
    } catch (error) {
      printResult(io, fail('project.ontology.module', 'ONTOLOGY_MODULE_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    ontology
      .command('decision')
      .description('Record or query architectural decisions')
      .requiredOption('--project <path>', 'target project root')
      .option('--id <id>', 'decision id')
      .option('--what <text>', 'what was decided')
      .option('--why <text>', 'rationale behind the decision')
      .option('--scope <modules>', 'comma-separated module ids')
      .option('--session <id>', 'session id')
      .option('--date <date>', 'decision date')
      .option('--put', 'write/update the decision')
  ).action((options: { project: string; id?: string; what?: string; why?: string; scope?: string; session?: string; date?: string; put?: boolean; json?: boolean }) => {
    try {
      if (options.put) {
        if (!options.id || !options.what || !options.session || !options.date) {
          printResult(io, fail('project.ontology.decision', 'MISSING_FIELDS', '--id, --what, --session, --date required with --put', {}, []), options.json);
          process.exitCode = 1;
          return;
        }
        const result = upsertDecision(options.project, defined({
          id: options.id, what: options.what, why: options.why,
          scope: options.scope ? options.scope.split(',').map((s) => s.trim()).filter(Boolean) : [],
          session: options.session, date: options.date
        }) as Decision);
        printResult(io, ok('project.ontology.decision', { decisions: result.decisions }), options.json);
        return;
      }
      const onto = loadOntology(options.project) ?? generateProjectContext(options.project).ontology;
      if (options.id) {
        const dec = onto.decisions.find((d) => d.id === options.id);
        printResult(io, ok('project.ontology.decision', dec ?? { notFound: true, id: options.id }), options.json);
        return;
      }
      printResult(io, ok('project.ontology.decision', { decisions: onto.decisions }), options.json);
    } catch (error) {
      printResult(io, fail('project.ontology.decision', 'ONTOLOGY_DECISION_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });
}
