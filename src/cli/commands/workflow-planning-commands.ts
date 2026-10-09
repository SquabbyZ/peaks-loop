// `peaks refactor | tech * | tech-plan | tech-status | workflow route|autonomous |
// route | autonomous | workflow autonomous-resume init | autonomous-resume` — the
// planning entry points. Returns the `peaks workflow` parent it created, so the
// caller that registers siblings against it does not create a second one.
import type { Command } from 'commander';
import {
  addJsonOption,
  failUnsupportedNonDryRun,
  printResult,
  type ProgramIO
} from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  createRefactorDryRun,
  type RefactorMode
} from '../../services/refactor/refactor-service.js';
// `peaks tech status-change-id`). Additive; the existing session-axis
// `peaks tech plan` / `peaks tech status` registrations are untouched.
import { registerTechCommands } from './tech-commands.js';
import {
  addTechPlanOptions,
  addTechStatusOptions,
  addWorkflowRouteOptions,
  runAutonomousWorkflow,
  runTechPlan,
  runTechStatus,
  runWorkflowRoute
} from './workflow-tech-actions.js';
import {
  addAutonomousResumeInitOptions,
  runAutonomousResumeInit
} from './workflow-swarm-actions.js';
import type {
  AutonomousResumeInitOptions,
  TechPlanOptions,
  TechStatusOptions,
  WorkflowRouteOptions
} from './workflow-plan-helpers.js';

/** The `peaks refactor` registration, lifted verbatim out of the planning registrar. */
function registerRefactorCommand(program: Command, io: ProgramIO): void {
  const refactor = program
    .command('refactor')
    .description('Plan a Peaks refactor run without modifying code');
  addJsonOption(
    refactor
      .option('--code', 'use peaks-code orchestration mode')
      .option('--rd', 'use peaks-rd direct mode')
      .option('--dry-run', 'print gates and required artifacts', true)
      .option('--no-dry-run', 'unsupported: do not modify code from this command')
  ).action((options: { code?: boolean; rd?: boolean; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'refactor', options.json);
      return;
    }

    if (options.code && options.rd) {
      printResult(
        io,
        fail(
          'refactor',
          'CONFLICTING_REFACTOR_MODE',
          'Choose either --code or --rd, not both',
          {},
          ['Run peaks refactor --code --dry-run']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    const mode: RefactorMode = options.rd ? 'rd' : 'code';
    printResult(
      io,
      ok('refactor', createRefactorDryRun(mode), [], ['This dry run never edits code']),
      options.json
    );
  });
}

export function registerWorkflowPlanningCommands(program: Command, io: ProgramIO): Command {
  registerRefactorCommand(program, io);

  const tech = program.command('tech').description('Plan and inspect technical dry-run gates');
  addTechPlanOptions(tech.command('plan')).action((options: TechPlanOptions) =>
    runTechPlan(io, options)
  );
  addTechStatusOptions(tech.command('status')).action((options: TechStatusOptions) =>
    runTechStatus(io, options)
  );
  addTechPlanOptions(program.command('tech-plan')).action((options: TechPlanOptions) =>
    runTechPlan(io, options)
  );
  addTechStatusOptions(program.command('tech-status')).action((options: TechStatusOptions) =>
    runTechStatus(io, options)
  );
  // (`peaks tech plan-change-id` / `peaks tech status-change-id`).
  // Additive; the session-axis registrations above are byte-for-byte untouched.
  registerTechCommands(program, io);

  const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
  addWorkflowRouteOptions(
    workflow.command('route'),
    'Plan a workflow routing dry-run summary'
  ).action((options: WorkflowRouteOptions) => runWorkflowRoute(io, options));
  addWorkflowRouteOptions(
    program.command('route'),
    'Plan a workflow routing dry-run summary'
  ).action((options: WorkflowRouteOptions) => runWorkflowRoute(io, options));
  addWorkflowRouteOptions(
    workflow.command('autonomous'),
    'Plan an autonomous workflow handoff summary'
  ).action((options: WorkflowRouteOptions) => runAutonomousWorkflow(io, options));
  addWorkflowRouteOptions(
    program.command('autonomous'),
    'Plan an autonomous workflow handoff summary'
  ).action((options: WorkflowRouteOptions) => runAutonomousWorkflow(io, options));

  const autonomousResume = workflow
    .command('autonomous-resume')
    .description('Manage autonomous workflow resume artifacts');
  addAutonomousResumeInitOptions(autonomousResume.command('init')).action(
    (options: AutonomousResumeInitOptions) => runAutonomousResumeInit(io, options)
  );
  const autonomousResumeAlias = program
    .command('autonomous-resume')
    .description('Manage autonomous workflow resume artifacts');
  addAutonomousResumeInitOptions(autonomousResumeAlias.command('init')).action(
    (options: AutonomousResumeInitOptions) => runAutonomousResumeInit(io, options)
  );

  return workflow;
}
