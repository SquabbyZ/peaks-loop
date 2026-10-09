// The `peaks swarm plan | swarm-plan` and `peaks workflow autonomous-resume init`
// handlers, plus the option sets the registrars attach. No command is registered here.
import type { Command } from 'commander';
import { createRdSwarmPlan } from '../../services/rd/rd-service.js';
import { writeAutonomousResumeArtifacts } from '../../services/workflow/autonomous-resume-writer.js';
import { readConfig } from '../../services/config/config-service.js';
import { getEconomyAwareExecutionModelId } from '../../services/config/model-routing.js';
import { getSessionId } from '../../services/session/session-manager.js';
import {
  addJsonOption,
  failUnsupportedNonDryRun,
  getErrorMessage,
  printResult,
  type ProgramIO
} from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
// catch site below (swarm.plan) so provider-config errors surface as
// `INVALID_PROVIDERS` instead of being silently re-labelled `INVALID_GOAL`.
import { mapServiceError } from './_cli-error-envelope.js';
import {
  ensureContextForRd,
  getWorkflowWorkspaceContext,
  parseMaxWorkers,
  validatePlanningInput,
  type AutonomousResumeInitOptions,
  type SwarmPlanOptions
} from './workflow-plan-helpers.js';

export async function runSwarmPlan(io: ProgramIO, options: SwarmPlanOptions): Promise<void> {
  if ((options.skill ?? 'rd') !== 'rd') {
    printResult(
      io,
      fail('swarm.plan', 'UNSUPPORTED_SWARM_SKILL', `Unsupported skill ${options.skill}`, {}, [
        'Use --skill rd'
      ]),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, 'swarm.plan', options.json);
    return;
  }

  const maxWorkers = parseMaxWorkers(io, 'swarm.plan', options.maxWorkers, options.json);
  if (maxWorkers === null) return;

  try {
    validatePlanningInput(options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const config = readConfig();
    // Plan 1 / Task 9 — pre-build peaks-context before peaks-rd runs.
    const projectRoot = workspaceContext.projectRoot ?? process.cwd();
    const sid = getSessionId(projectRoot) ?? 'ad-hoc';
    await ensureContextForRd(options.goal, projectRoot, sid);
    const plan = createRdSwarmPlan({
      skill: 'rd',
      sessionId: '',
      goal: options.goal,
      maxWorkers,
      dryRun: true,
      swarmMode: config.swarmMode ?? true,
      executionModelId: getEconomyAwareExecutionModelId(config),
      ...(options.strictStandards ? { strictStandards: true } : {}),
      ...workspaceContext
    });
    // The service-layer stamps `standardsErrorCode` onto the envelope; the
    // CLI is responsible for translating it into a non-zero exit.
    if (plan.gateStatus.standardsErrorCode === 'EPEAKS_NO_STANDARDS') {
      process.exitCode = 1;
    }
    printResult(io, ok('swarm.plan', plan), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    printResult(
      io,
      fail('swarm.plan', mapping.code, getErrorMessage(error), {}, [...mapping.nextActions]),
      options.json
    );
    process.exitCode = 1;
  }
}

export async function runAutonomousResumeInit(
  io: ProgramIO,
  options: AutonomousResumeInitOptions
): Promise<void> {
  try {
    if (!options.project || !options.project.trim()) {
      throw new Error('Project path must be non-empty');
    }
    // gone. The CLI surfaces a deterministic placeholder
    // (`session-default`) when the user does not pass a change-id, so
    // the on-disk session-dir join via `getSessionDir` succeeds (the
    // writer still requires a safe non-empty string).
    const result = await writeAutonomousResumeArtifacts({
      sessionId: 'session-default',
      goal: options.goal,
      artifactWorkspacePath: options.project,
      apply: options.apply === true
    });
    const data = {
      applied: result.applied,
      files: result.files.map((file) => file.path)
    };
    const nextActions = result.applied
      ? ['Run peaks workflow autonomous --goal "<goal>" --json to verify resumePlan.status']
      : ['Re-run with --apply to write the resume scaffold to disk'];
    printResult(io, ok('autonomous-resume.init', data, [], nextActions), options.json);
  } catch (error) {
    printResult(
      io,
      fail('autonomous-resume.init', 'AUTONOMOUS_RESUME_INIT_FAILED', getErrorMessage(error), {}, [
        'Use a non-empty goal and a writable project path'
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function addSwarmPlanOptions(command: Command, includeSkill: boolean): Command {
  const configured = command
    .description('Plan an RD swarm dry-run graph')
    .requiredOption('--goal <goal>', 'planning goal')
    .option('--max-workers <count>', 'maximum worker count', '40')
    .option('--dry-run', 'preview without writing files', true)
    .option('--no-dry-run', 'unsupported: do not execute RD planning from this CLI')
    .option(
      '--strict-standards',
      'hard-fail (exit non-zero) when project-local standards are missing; surfaces EPEAKS_NO_STANDARDS in the JSON envelope'
    );

  if (includeSkill) {
    configured.requiredOption('--skill <skill>', 'skill to plan for');
  }

  return addJsonOption(configured);
}

export function addAutonomousResumeInitOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Write the autonomous resume artifact scaffold for the active change-id')
      .requiredOption('--goal <goal>', 'planning goal')
      .requiredOption('--project <path>', 'artifact workspace path to write under')
      .option('--apply', 'write the artifacts to disk (default is dry-run preview)')
  );
}
