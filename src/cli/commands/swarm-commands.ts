import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { getWorkspaceConfigForPath } from '../../services/config/config-service.js';
import { getLocalArtifactPath } from '../../services/artifacts/workspace-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { planRdSwarmGraph, type RdSwarmPlanRequest } from '../../services/rd-swarm/rd-swarm-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { mapServiceError } from './_cli-error-envelope.js';

export type SwarmPlanOptions = {
  skill?: string;
  changeId?: string;
  goal: string;
  maxWorkers?: string;
  dryRun?: boolean;
  codeMode?: string;
  json?: boolean;
};

function projectContext(): { workspaceRoot: string; workspace?: RdSwarmPlanRequest['workspace'] } {
  const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
  const workspace = getWorkspaceConfigForPath(projectRoot);
  return {
    workspaceRoot: workspace ? getLocalArtifactPath(workspace) : projectRoot,
    ...(workspace ? { workspace } : {}),
  };
}

export async function runSwarmPlan(io: ProgramIO, options: SwarmPlanOptions): Promise<void> {
  if ((options.skill ?? 'rd') !== 'rd') {
    printResult(io, fail('swarm.plan', 'UNSUPPORTED_SWARM_SKILL', `Unsupported skill ${options.skill}`, {}, ['Use --skill rd']), options.json);
    process.exitCode = 1;
    return;
  }
  if (options.dryRun === false) {
    printResult(io, fail('swarm.plan', 'UNSUPPORTED_NON_DRY_RUN', 'Only dry-run planning is supported', {}, ['Rerun with --dry-run or omit --no-dry-run']), options.json);
    process.exitCode = 1;
    return;
  }
  if (options.codeMode !== undefined && !['full-auto', 'guided', 'rnd'].includes(options.codeMode)) {
    printResult(io, fail('swarm.plan', 'UNSUPPORTED_CODE_MODE', `Unsupported code mode ${options.codeMode}`, {}, ['Use --code-mode full-auto, guided, or rnd']), options.json);
    process.exitCode = 1;
    return;
  }
  const maxWorkers = Number(options.maxWorkers ?? '25');
  const changeId = options.changeId ?? 'ad-hoc-swarm';
  try {
    const context = projectContext();
    const request: RdSwarmPlanRequest = {
      skill: 'rd',
      changeId,
      goal: options.goal,
      maxWorkers,
      dryRun: true,
      workspaceRoot: context.workspaceRoot,
      ...(context.workspace ? { workspace: context.workspace } : {}),
      requiresTechApproval: false,
    };
    const plan = planRdSwarmGraph(request);
    if (!plan.available) {
      const code = plan.blockedReasons[0] ?? 'SWARM_PLAN_BLOCKED';
      printResult(io, fail('swarm.plan', code, 'RD swarm planning is blocked', plan, plan.nextActions), options.json);
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('swarm.plan', plan), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    printResult(io, fail('swarm.plan', mapping.code, getErrorMessage(error), {}, [...mapping.nextActions]), options.json);
    process.exitCode = 1;
  }
}

function addSwarmPlanChangeIdOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Plan a change-id-keyed RD swarm dry-run graph (slice rid-013).')
      .requiredOption('--change-id <id>', 'change id matching [A-Za-z0-9][A-Za-z0-9._-]*')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--max-workers <count>', 'maximum worker count', '25')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute RD planning from this CLI')
      .option('--code-mode <mode>', 'code mode: full-auto, guided, or rnd')
  );
}

export function registerSwarmCommands(program: Command, io: ProgramIO): void {
  const swarm = program.commands.find((candidate) => candidate.name() === 'swarm');
  if (swarm) {
    addSwarmPlanChangeIdOptions(swarm.command('plan-change-id')).action((options: SwarmPlanOptions) => runSwarmPlan(io, options));
  }
  addSwarmPlanChangeIdOptions(program.command('swarm-plan-change-id')).action((options: SwarmPlanOptions) => runSwarmPlan(io, options));
}
