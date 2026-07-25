import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { getWorkspaceConfigForPath } from '../../services/config/config-service.js';
import { getLocalArtifactPath } from '../../services/artifacts/workspace-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  planAutonomousRdSwarm,
  buildAutonomousGoalPackage,
  buildResumeInstructions,
  type PlanAutonomousRdSwarmInput,
  type AutonomousMode,
} from '../../services/autonomous-swarm/autonomous-swarm-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { mapServiceError } from './_cli-error-envelope.js';

export type AutonomousPlanOptions = {
  mode: string;
  changeId: string;
  goal: string;
  maxWorkers?: string;
  dryRun?: boolean;
  json?: boolean;
};

const SUPPORTED_AUTONOMOUS_MODES: readonly AutonomousMode[] = ['code', 'team'] as const;

function isAutonomousMode(value: string): value is AutonomousMode {
  return (SUPPORTED_AUTONOMOUS_MODES as readonly string[]).includes(value);
}

function projectContext(): { workspaceRoot: string; workspace?: PlanAutonomousRdSwarmInput['workspace' & never] } {
  const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
  const workspace = getWorkspaceConfigForPath(projectRoot);
  return {
    workspaceRoot: workspace ? getLocalArtifactPath(workspace) : projectRoot,
  };
}

function autonomousWorkspaceRoot(): string {
  return projectContext().workspaceRoot;
}

export function runAutonomousSwarmPlan(io: ProgramIO, options: AutonomousPlanOptions): void {
  if (options.dryRun === false) {
    printResult(io, fail('workflow.autonomous', 'NON_DRY_RUN_UNSUPPORTED', 'Only dry-run planning is supported', {}, ['Rerun with --dry-run or omit --no-dry-run']), options.json);
    process.exitCode = 1;
    return;
  }
  if (!isAutonomousMode(options.mode)) {
    printResult(io, fail('workflow.autonomous', 'UNSUPPORTED_AUTONOMOUS_MODE', `Unsupported autonomous mode ${options.mode}`, {}, ['Use --mode code or --mode team']), options.json);
    process.exitCode = 1;
    return;
  }
  const maxWorkers = Number(options.maxWorkers ?? '40');
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    printResult(io, fail('workflow.autonomous', 'INVALID_MAX_WORKERS', 'max-workers must be a positive integer', {}, ['Use --max-workers with a positive integer value']), options.json);
    process.exitCode = 1;
    return;
  }
  const workspaceRoot = autonomousWorkspaceRoot();
  try {
    // Validate inputs that the service enforces as throws so we surface
    // them as typed envelope codes rather than generic INTERNAL_ERROR.
    if (!options.goal.trim()) {
      throw new Error('Goal must be non-empty');
    }
    const goalPackage = buildAutonomousGoalPackage({
      changeId: options.changeId,
      goal: options.goal,
      mode: options.mode,
      maxWorkers,
      dryRun: true,
      workspaceRoot,
    });
    const plan = planAutonomousRdSwarm({
      changeId: options.changeId,
      goal: options.goal,
      mode: options.mode,
      maxWorkers,
      dryRun: true,
      workspaceRoot,
      requiresTechApproval: false,
    });
    const resumeInstructions = buildResumeInstructions(plan);
    printResult(io, ok('workflow.autonomous', {
      goalPackage,
      capabilityReuse: plan.capabilityReuse,
      checkpoints: plan.checkpoints,
      workerQueue: plan.workerQueue,
      evidence: plan.evidence,
      artifactRoot: plan.artifactRoot,
      gateStatus: plan.gateStatus,
      blockedReasons: plan.blockedReasons,
      nextActions: plan.nextActions,
      resumeInstructions,
      autonomyMode: plan.autonomyMode,
      available: plan.available,
    }), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    // Re-label change-id validation errors so the envelope code matches
    // the typed `code` we want to surface to the user (rather than the
    // generic INTERNAL_ERROR fallback).
    if (error instanceof Error && /changeId|change-id/.test(error.message)) {
      if (error.message.includes('empty')) {
        printResult(io, fail('workflow.autonomous', 'change-id-empty', error.message, {}, ['Provide a change-id matching [A-Za-z0-9][A-Za-z0-9._-]*']), options.json);
      } else {
        printResult(io, fail('workflow.autonomous', 'change-id-format', error.message, {}, ['Provide a change-id matching [A-Za-z0-9][A-Za-z0-9._-]*']), options.json);
      }
      process.exitCode = 1;
      return;
    }
    printResult(io, fail('workflow.autonomous', mapping.code, getErrorMessage(error), {}, [...mapping.nextActions]), options.json);
    process.exitCode = 1;
  }
}

function addAutonomousPlanOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Plan an autonomous RD swarm dry-run (slice rid-014).')
      .requiredOption('--mode <mode>', 'autonomous mode: code or team')
      .requiredOption('--change-id <id>', 'change id matching [A-Za-z0-9][A-Za-z0-9._-]*')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--max-workers <count>', 'maximum worker count', '40')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute autonomous planning from this CLI')
  );
}

export function registerAutonomousSwarmCommands(program: Command, io: ProgramIO): void {
  // Register the new rid-014 dry-run planner under
  // `peaks workflow autonomous-swarm` (the existing `peaks workflow
  // autonomous` registration owns the bare `autonomous` name and is
  // untouched). The legacy `registerSwarmCommands` and
  // `registerTechCommands` calls in `workflow-commands.ts` are
  // byte-for-byte untouched.
  const workflow = program.commands.find((candidate) => candidate.name() === 'workflow');
  if (workflow) {
    addAutonomousPlanOptions(workflow.command('autonomous-swarm')).action((options: AutonomousPlanOptions) => runAutonomousSwarmPlan(io, options));
  }
  addAutonomousPlanOptions(program.command('autonomous-swarm')).action((options: AutonomousPlanOptions) => runAutonomousSwarmPlan(io, options));
}
