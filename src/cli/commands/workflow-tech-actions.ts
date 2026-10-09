// The `peaks tech *`, `peaks workflow route|autonomous` and `peaks route` handlers,
// plus the option sets the registrars attach. No command is registered here.
import type { Command } from 'commander';
import { createTechPlan, getTechStatus } from '../../services/tech/tech-service.js';
import {
  createWorkflowRouterPlan,
  isWorkflowMode
} from '../../services/workflow/workflow-router-service.js';
import { createAutonomousWorkflowPlan } from '../../services/workflow/workflow-autonomous-service.js';
import { readConfig } from '../../services/config/config-service.js';
import {
  addJsonOption,
  failUnsupportedNonDryRun,
  getErrorMessage,
  printResult,
  type ProgramIO
} from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
// catch sites below (tech.plan / workflow.route / workflow.autonomous /
// swarm.plan) so provider-config errors surface as `INVALID_PROVIDERS`
// instead of being silently re-labelled `INVALID_GOAL`.
import { mapServiceError } from './_cli-error-envelope.js';
import {
  getCurrentWorkspaceContext,
  getWorkflowWorkspaceContext,
  parseCodeMode,
  parseMaxWorkers,
  validatePlanningInput,
  type TechPlanOptions,
  type TechStatusOptions,
  type WorkflowRouteOptions
} from './workflow-plan-helpers.js';

export function runTechPlan(io: ProgramIO, options: TechPlanOptions): void {
  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, 'tech.plan', options.json);
    return;
  }

  try {
    validatePlanningInput(options.goal);
    const workspaceContext = getCurrentWorkspaceContext();
    // gone. The planner derives scope from the active session; the
    // legacy `sessionId` field is passed as empty string for back-compat
    // with the existing service signature.
    const plan = createTechPlan({
      sessionId: '',
      goal: options.goal,
      swarm: options.swarm ?? false,
      dryRun: true,
      ...workspaceContext
    });
    printResult(io, ok('tech.plan', plan), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    printResult(
      io,
      fail('tech.plan', mapping.code, getErrorMessage(error), {}, [...mapping.nextActions]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function runTechStatus(io: ProgramIO, options: TechStatusOptions): void {
  try {
    const workspaceContext = getCurrentWorkspaceContext();
    printResult(
      io,
      ok('tech.status', getTechStatus({ sessionId: '', ...workspaceContext })),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail('tech.status', 'TECH_STATUS_FAILED', getErrorMessage(error), {}, [
        'Verify the project setup'
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * The dry-run / mode / maxWorkers / codeMode preamble the two workflow planners
 * share. Lifted from their common prefix verbatim, parameterised only by the
 * command label both already spelled out; it runs at the same point in the
 * sequence and returns `null` where the original returned early.
 */
function resolveWorkflowPlanInputs(io: ProgramIO, label: string, options: WorkflowRouteOptions) {
  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, label, options.json);
    return null;
  }

  if (!isWorkflowMode(options.mode)) {
    printResult(
      io,
      fail(label, 'UNSUPPORTED_WORKFLOW_MODE', `Unsupported workflow mode ${options.mode}`, {}, [
        'Use --mode code or --mode team'
      ]),
      options.json
    );
    process.exitCode = 1;
    return null;
  }

  const maxWorkers = parseMaxWorkers(io, label, options.maxWorkers, options.json);
  if (maxWorkers === null) return null;

  const codeMode = parseCodeMode(io, label, options.mode, options.codeMode, options.json);
  if (codeMode === null) return null;

  // `options.mode` is narrowed to `WorkflowMode` by the `isWorkflowMode` guard
  // above; carrying it out with the pair keeps the call sites free of a cast.
  return { maxWorkers, codeMode, mode: options.mode };
}

export function runWorkflowRoute(io: ProgramIO, options: WorkflowRouteOptions): void {
  const inputs = resolveWorkflowPlanInputs(io, 'workflow.route', options);
  if (inputs === null) return;

  try {
    validatePlanningInput(options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const plan = createWorkflowRouterPlan({
      sessionId: '',
      goal: options.goal,
      mode: inputs.mode,
      ...(inputs.codeMode ? { codeMode: inputs.codeMode } : {}),
      maxWorkers: inputs.maxWorkers,
      dryRun: true,
      config: readConfig(),
      ...workspaceContext
    });
    printResult(io, ok('workflow.route', plan), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    printResult(
      io,
      fail('workflow.route', mapping.code, getErrorMessage(error), {}, [...mapping.nextActions]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function runAutonomousWorkflow(io: ProgramIO, options: WorkflowRouteOptions): void {
  const inputs = resolveWorkflowPlanInputs(io, 'workflow.autonomous', options);
  if (inputs === null) return;

  try {
    validatePlanningInput(options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const plan = createAutonomousWorkflowPlan({
      sessionId: '',
      goal: options.goal,
      mode: inputs.mode,
      ...(inputs.codeMode ? { codeMode: inputs.codeMode } : {}),
      maxWorkers: inputs.maxWorkers,
      dryRun: true,
      config: readConfig(),
      ...workspaceContext
    });
    printResult(io, ok('workflow.autonomous', plan), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    printResult(
      io,
      fail('workflow.autonomous', mapping.code, getErrorMessage(error), {}, [
        ...mapping.nextActions
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function addTechPlanOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Generate a technical dry-run graph')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--swarm', 'opt into swarm-oriented planning')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute tech planning from this CLI')
  );
}

export function addTechStatusOptions(command: Command): Command {
  return addJsonOption(command.description('Inspect technical approval status'));
}

export function addWorkflowRouteOptions(command: Command, description: string): Command {
  return addJsonOption(
    command
      .description(description)
      .requiredOption('--mode <mode>', 'workflow mode: code or team')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--code-mode <mode>', 'code mode: full-auto, guided, or rnd')
      .option('--max-workers <count>', 'maximum worker count', '40')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute workflow planning from this CLI')
  );
}
