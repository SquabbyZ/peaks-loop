// `peaks workflow run|graph|lint` — the workflow primitive's read/validate surface.
// Split out of the loop-eval registrar so each command family owns its own file; the
// option/argument surface is unchanged.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  resolveWorkflow,
  planWorkflow,
  planWorkflowRun
} from '../../services/workflow/workflow-loader.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { workflowCommandParent } from './loop-eval-parents.js';

interface WorkflowCommandOptions {
  session: string;
  project?: string;
  json?: boolean;
}

export function registerWorkflowEvalWorkflowCommands(program: Command, io: ProgramIO): void {
  const workflow = workflowCommandParent(program);

  // peaks workflow run <id>
  addJsonOption(
    workflow
      .command('run')
      .description(
        'Slice A.3: replay a captured workflow (.peaks/workflows/<id>.yaml) deterministically. Returns the run-plan order + per-phase status without re-deriving the phase plan.'
      )
      .argument('<id>', 'workflow id (matches .peaks/workflows/<id>.yaml)')
      .requiredOption('--session <sid>', 'session id (from peaks workspace init)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((id: string, options: WorkflowCommandOptions) => runWorkflowRun(id, options, io));

  // peaks workflow graph <id>  (dry-run graph render)
  // Renamed from `plan` to `graph` to avoid collision with the existing
  // `peaks workflow plan <read|refresh|detect-trigger>` family registered
  // Reuse the existing `graph` parent if `registerWorkflowLifecycleCommand`
  // already created one (it owns `peaks workflow graph show|list`).
  const existingGraph = workflow.commands.find((c) => c.name() === 'graph');
  const graphParent =
    existingGraph ??
    workflow
      .command('graph')
      .description('workflow graph read commands (slice A.3 dry-run + slice 4.0.8 lifecycle)');
  addJsonOption(
    graphParent
      .description(
        'Slice A.3 dry-run: render the workflow graph (phases + parallel groups + evaluators + budget). No phase is executed.'
      )
      .argument('<id>', 'workflow id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((id: string, options: WorkflowCommandOptions) => runWorkflowGraph(id, options, io));

  // peaks workflow lint <id>
  addJsonOption(
    workflow
      .command('lint')
      .description(
        'Slice A.3: validate a workflow spec (phases / gates / evaluators / parallel groups / budget).'
      )
      .argument('<id>', 'workflow id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((id: string, options: WorkflowCommandOptions) => runWorkflowLint(id, options, io));
}

function reportWorkflowRunFailure(
  io: ProgramIO,
  error: unknown,
  sessionId: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('workflow.run', 'WORKFLOW_RUN_FAILED', getErrorMessage(error), { sessionId }, [
      'Verify the workflow id and session binding.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function reportWorkflowGraphFailure(
  io: ProgramIO,
  error: unknown,
  sessionId: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('workflow.graph', 'WORKFLOW_GRAPH_FAILED', getErrorMessage(error), { sessionId }, [
      'Verify the workflow id and session binding.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function reportWorkflowLintFailure(
  io: ProgramIO,
  error: unknown,
  sessionId: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('workflow.lint', 'WORKFLOW_LINT_FAILED', getErrorMessage(error), { sessionId }, [
      'Verify the workflow file syntax.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function workflowRunData(
  sessionId: string,
  resolved: ReturnType<typeof resolveWorkflow>,
  runPlan: ReturnType<typeof planWorkflowRun>
): Record<string, unknown> {
  return {
    sessionId,
    workflow: { id: resolved.spec.id, label: resolved.spec.label, source: resolved.source },
    runPlan,
    lintWarnings: resolved.lint.warnings
  };
}

function workflowGraphData(
  sessionId: string,
  graph: ReturnType<typeof planWorkflow>,
  resolved: ReturnType<typeof resolveWorkflow>
): Record<string, unknown> {
  return {
    sessionId,
    graph,
    lintWarnings: resolved.lint.warnings
  };
}

function runWorkflowRun(id: string, options: WorkflowCommandOptions, io: ProgramIO): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const resolved = resolveWorkflow(projectRoot, id);
    if (resolved.source.kind === 'missing') {
      printResult(
        io,
        fail(
          'workflow.run',
          'WORKFLOW_NOT_FOUND',
          `workflow "${id}" not found`,
          { sessionId: options.session },
          [`peaks workflow lint ${id} --session ${options.session} --json`]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    if (!resolved.lint.ok) {
      printResult(
        io,
        fail(
          'workflow.run',
          'WORKFLOW_LINT_FAILED',
          `workflow "${id}" has ${resolved.lint.errors.length} lint error(s): ${resolved.lint.errors.join('; ')}`,
          resolved.lint,
          [`peaks workflow lint ${id} --session ${options.session} --json`]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const runPlan = planWorkflowRun(resolved.spec);
    const data = workflowRunData(options.session, resolved, runPlan);
    const actions = [
      `Run \`peaks workflow plan ${id} --session ${options.session} --json\` to preview the graph.`
    ];
    printResult(io, ok('workflow.run', data, [], actions), options.json);
  } catch (error) {
    reportWorkflowRunFailure(io, error, options.session, options.json);
  }
}

function runWorkflowGraph(id: string, options: WorkflowCommandOptions, io: ProgramIO): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const resolved = resolveWorkflow(projectRoot, id);
    if (resolved.source.kind === 'missing') {
      printResult(
        io,
        fail(
          'workflow.graph',
          'WORKFLOW_NOT_FOUND',
          `workflow "${id}" not found`,
          { sessionId: options.session },
          [`Create .peaks/workflows/${id}.yaml or use the bundled default-fullauto-md.`]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    if (!resolved.lint.ok) {
      printResult(
        io,
        fail(
          'workflow.graph',
          'WORKFLOW_LINT_FAILED',
          `workflow "${id}" has ${resolved.lint.errors.length} lint error(s): ${resolved.lint.errors.join('; ')}`,
          resolved.lint,
          [`peaks workflow lint ${id} --session ${options.session} --json`]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const graph = planWorkflow(resolved.spec, resolved.source);
    const data = workflowGraphData(options.session, graph, resolved);
    const actions = [
      `Run \`peaks workflow run ${id} --session ${options.session} --json\` to materialize the run-plan order.`
    ];
    printResult(io, ok('workflow.graph', data, [], actions), options.json);
  } catch (error) {
    reportWorkflowGraphFailure(io, error, options.session, options.json);
  }
}

function runWorkflowLint(id: string, options: WorkflowCommandOptions, io: ProgramIO): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const resolved = resolveWorkflow(projectRoot, id);
    if (resolved.source.kind === 'missing') {
      printResult(
        io,
        fail(
          'workflow.lint',
          'WORKFLOW_NOT_FOUND',
          `workflow "${id}" not found`,
          { sessionId: options.session },
          [`Create .peaks/workflows/${id}.yaml`]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok(
        'workflow.lint',
        {
          sessionId: options.session,
          source: resolved.source,
          lint: resolved.lint
        },
        [],
        []
      ),
      options.json
    );
    if (!resolved.lint.ok) process.exitCode = 1;
  } catch (error) {
    reportWorkflowLintFailure(io, error, options.session, options.json);
  }
}
