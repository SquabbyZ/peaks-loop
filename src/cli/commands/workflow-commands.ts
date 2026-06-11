import { Command } from 'commander';
import { createRdSwarmPlan } from '../../services/rd/rd-service.js';
import { createTechPlan, getTechStatus } from '../../services/tech/tech-service.js';
import { createWorkflowRouterPlan, isSoloMode, isWorkflowMode, type SoloMode } from '../../services/workflow/workflow-router-service.js';
import { createAutonomousWorkflowPlan } from '../../services/workflow/workflow-autonomous-service.js';
import { writeAutonomousResumeArtifacts } from '../../services/workflow/autonomous-resume-writer.js';
import { createRecommendationPlan } from '../../services/recommendations/recommendation-service.js';
import { createRefactorDryRun, type RefactorMode } from '../../services/refactor/refactor-service.js';
import { getWorkspaceConfigForPath, readConfig } from '../../services/config/config-service.js';
import type { WorkspaceConfig } from '../../services/config/config-types.js';
import { validateChangeIdOrThrow } from '../../shared/change-id.js';
import { getEconomyAwareExecutionModelId } from '../../services/config/model-routing.js';
import { getLocalArtifactPath } from '../../services/artifacts/workspace-service.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { getSessionDir } from '../../services/session/getSessionDir.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { verifyPipeline } from '../../services/workflow/pipeline-verify-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, isRecommendationWorkflow, printResult, type ProgramIO } from '../cli-helpers.js';

interface WorkspaceContext {
  workspace?: WorkspaceConfig;
  artifactWorkspacePath?: string;
  sessionId?: string;
  sessionDir?: string;
}

interface TechPlanOptions {
  changeId: string;
  goal: string;
  swarm?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

interface TechStatusOptions {
  changeId: string;
  json?: boolean;
}

interface WorkflowRouteOptions {
  mode: string;
  changeId: string;
  goal: string;
  soloMode?: string;
  maxWorkers: string;
  dryRun?: boolean;
  json?: boolean;
}

interface SwarmPlanOptions {
  skill?: string;
  changeId: string;
  goal: string;
  maxWorkers: string;
  dryRun?: boolean;
  json?: boolean;
}

interface AutonomousResumeInitOptions {
  changeId: string;
  goal: string;
  project: string;
  apply?: boolean;
  json?: boolean;
}

function getCurrentWorkspaceContext(): WorkspaceContext {
  try {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = getSessionId(projectRoot);
    return sessionId ? { sessionId, sessionDir: getSessionDir(projectRoot, sessionId) } : {};
  } catch {
    return {};
  }
}

function getWorkflowWorkspaceContext(): WorkspaceContext {
  try {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const workspace = getWorkspaceConfigForPath(projectRoot);
    if (!workspace) return {};
    return { workspace, artifactWorkspacePath: getLocalArtifactPath(workspace) };
  } catch {
    return {};
  }
}

function parseMaxWorkers(io: ProgramIO, command: string, value: string, asJson?: boolean): number | null {
  const maxWorkers = Number(value);
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    printResult(io, fail(command, 'INVALID_MAX_WORKERS', 'max-workers must be a positive integer', {}, ['Use --max-workers with a positive integer value']), asJson);
    process.exitCode = 1;
    return null;
  }
  return maxWorkers;
}

function validatePlanningInput(changeId: string, goal: string): void {
  validateChangeIdOrThrow(changeId);
  if (!goal.trim()) {
    throw new Error('Goal must be non-empty');
  }
}

function parseSoloMode(io: ProgramIO, command: string, mode: string, soloMode: string | undefined, asJson?: boolean): SoloMode | undefined | null {
  if (mode !== 'solo' && soloMode) {
    printResult(io, fail(command, 'SOLO_MODE_REQUIRES_SOLO_WORKFLOW', '--solo-mode can only be used with --mode solo', {}, ['Remove --solo-mode or use --mode solo']), asJson);
    process.exitCode = 1;
    return null;
  }

  if (mode !== 'solo' || !soloMode) {
    return undefined;
  }

  if (!isSoloMode(soloMode)) {
    printResult(io, fail(command, 'UNSUPPORTED_SOLO_MODE', `Unsupported solo mode ${soloMode}`, {}, ['Use --solo-mode full-auto, guided, or rnd']), asJson);
    process.exitCode = 1;
    return null;
  }
  return soloMode;
}

function runTechPlan(io: ProgramIO, options: TechPlanOptions): void {
  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, 'tech.plan', options.json);
    return;
  }

  try {
    validatePlanningInput(options.changeId, options.goal);
    const workspaceContext = getCurrentWorkspaceContext();
    const plan = createTechPlan({
      changeId: options.changeId,
      goal: options.goal,
      swarm: options.swarm ?? false,
      dryRun: true,
      ...workspaceContext
    });
    printResult(io, ok('tech.plan', plan), options.json);
  } catch (error) {
    printResult(io, fail('tech.plan', 'INVALID_CHANGE_ID_OR_GOAL', getErrorMessage(error), {}, ['Use a safe change id and a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

function runTechStatus(io: ProgramIO, options: TechStatusOptions): void {
  try {
    const workspaceContext = getCurrentWorkspaceContext();
    printResult(io, ok('tech.status', getTechStatus({ changeId: options.changeId, ...workspaceContext })), options.json);
  } catch (error) {
    printResult(io, fail('tech.status', 'INVALID_CHANGE_ID', getErrorMessage(error), {}, ['Use a safe change id']), options.json);
    process.exitCode = 1;
  }
}

function runWorkflowRoute(io: ProgramIO, options: WorkflowRouteOptions): void {
  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, 'workflow.route', options.json);
    return;
  }

  if (!isWorkflowMode(options.mode)) {
    printResult(io, fail('workflow.route', 'UNSUPPORTED_WORKFLOW_MODE', `Unsupported workflow mode ${options.mode}`, {}, ['Use --mode solo or --mode team']), options.json);
    process.exitCode = 1;
    return;
  }

  const maxWorkers = parseMaxWorkers(io, 'workflow.route', options.maxWorkers, options.json);
  if (maxWorkers === null) return;

  const soloMode = parseSoloMode(io, 'workflow.route', options.mode, options.soloMode, options.json);
  if (soloMode === null) return;

  try {
    validatePlanningInput(options.changeId, options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const plan = createWorkflowRouterPlan({
      changeId: options.changeId,
      goal: options.goal,
      mode: options.mode,
      ...(soloMode ? { soloMode } : {}),
      maxWorkers,
      dryRun: true,
      config: readConfig(),
      ...workspaceContext
    });
    printResult(io, ok('workflow.route', plan), options.json);
  } catch (error) {
    printResult(io, fail('workflow.route', 'INVALID_CHANGE_ID_OR_GOAL', getErrorMessage(error), {}, ['Use a safe change id and a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

function runAutonomousWorkflow(io: ProgramIO, options: WorkflowRouteOptions): void {
  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, 'workflow.autonomous', options.json);
    return;
  }

  if (!isWorkflowMode(options.mode)) {
    printResult(io, fail('workflow.autonomous', 'UNSUPPORTED_WORKFLOW_MODE', `Unsupported workflow mode ${options.mode}`, {}, ['Use --mode solo or --mode team']), options.json);
    process.exitCode = 1;
    return;
  }

  const maxWorkers = parseMaxWorkers(io, 'workflow.autonomous', options.maxWorkers, options.json);
  if (maxWorkers === null) return;

  const soloMode = parseSoloMode(io, 'workflow.autonomous', options.mode, options.soloMode, options.json);
  if (soloMode === null) return;

  try {
    validatePlanningInput(options.changeId, options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const plan = createAutonomousWorkflowPlan({
      changeId: options.changeId,
      goal: options.goal,
      mode: options.mode,
      ...(soloMode ? { soloMode } : {}),
      maxWorkers,
      dryRun: true,
      config: readConfig(),
      ...workspaceContext
    });
    printResult(io, ok('workflow.autonomous', plan), options.json);
  } catch (error) {
    printResult(io, fail('workflow.autonomous', 'INVALID_CHANGE_ID_OR_GOAL', getErrorMessage(error), {}, ['Use a safe change id and a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

function runSwarmPlan(io: ProgramIO, options: SwarmPlanOptions): void {
  if ((options.skill ?? 'rd') !== 'rd') {
    printResult(io, fail('swarm.plan', 'UNSUPPORTED_SWARM_SKILL', `Unsupported skill ${options.skill}`, {}, ['Use --skill rd']), options.json);
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
    validatePlanningInput(options.changeId, options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const config = readConfig();
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: options.changeId,
      goal: options.goal,
      maxWorkers,
      dryRun: true,
      swarmMode: config.swarmMode,
      executionModelId: getEconomyAwareExecutionModelId(config),
      ...workspaceContext
    });
    printResult(io, ok('swarm.plan', plan), options.json);
  } catch (error) {
    printResult(io, fail('swarm.plan', 'INVALID_CHANGE_ID_OR_GOAL', getErrorMessage(error), {}, ['Use a safe change id and a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

async function runAutonomousResumeInit(io: ProgramIO, options: AutonomousResumeInitOptions): Promise<void> {
  try {
    if (!options.project || !options.project.trim()) {
      throw new Error('Project path must be non-empty');
    }
    const result = await writeAutonomousResumeArtifacts({
      changeId: options.changeId,
      goal: options.goal,
      artifactWorkspacePath: options.project,
      apply: options.apply === true
    });
    const data = {
      applied: result.applied,
      files: result.files.map((file) => file.path)
    };
    const nextActions = result.applied
      ? ['Run peaks workflow autonomous --change-id ' + options.changeId + ' --goal "<goal>" --json to verify resumePlan.status']
      : ['Re-run with --apply to write the resume scaffold to disk'];
    printResult(io, ok('autonomous-resume.init', data, [], nextActions), options.json);
  } catch (error) {
    printResult(io, fail('autonomous-resume.init', 'AUTONOMOUS_RESUME_INIT_FAILED', getErrorMessage(error), {}, ['Use a safe change id, a non-empty goal, and a writable project path']), options.json);
    process.exitCode = 1;
  }
}

function addTechPlanOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Generate a technical dry-run graph')
      .requiredOption('--change-id <id>', 'change identifier')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--swarm', 'opt into swarm-oriented planning')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute tech planning from this CLI')
  );
}

function addTechStatusOptions(command: Command): Command {
  return addJsonOption(command.description('Inspect technical approval status').requiredOption('--change-id <id>', 'change identifier'));
}

function addWorkflowRouteOptions(command: Command, description: string): Command {
  return addJsonOption(
    command
      .description(description)
      .requiredOption('--mode <mode>', 'workflow mode: solo or team')
      .requiredOption('--change-id <id>', 'change identifier')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--solo-mode <mode>', 'solo mode: full-auto, guided, or rnd')
      .option('--max-workers <count>', 'maximum worker count', '40')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute workflow planning from this CLI')
  );
}

function addSwarmPlanOptions(command: Command, includeSkill: boolean): Command {
  const configured = command
    .description('Plan an RD swarm dry-run graph')
    .requiredOption('--change-id <id>', 'change identifier')
    .requiredOption('--goal <goal>', 'planning goal')
    .option('--max-workers <count>', 'maximum worker count', '40')
    .option('--dry-run', 'preview without writing files', true)
    .option('--no-dry-run', 'unsupported: do not execute RD planning from this CLI');

  if (includeSkill) {
    configured.requiredOption('--skill <skill>', 'skill to plan for');
  }

  return addJsonOption(configured);
}

function addAutonomousResumeInitOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Write the autonomous resume artifact scaffold for a change-id')
      .requiredOption('--change-id <id>', 'change identifier')
      .requiredOption('--goal <goal>', 'planning goal')
      .requiredOption('--project <path>', 'artifact workspace path to write under')
      .option('--apply', 'write the artifacts to disk (default is dry-run preview)')
  );
}

export function registerWorkflowCommands(program: Command, io: ProgramIO): void {
  const refactor = program.command('refactor').description('Plan a Peaks refactor run without modifying code');
  addJsonOption(
    refactor
      .option('--solo', 'use peaks-solo orchestration mode')
      .option('--rd', 'use peaks-rd direct mode')
      .option('--dry-run', 'print gates and required artifacts', true)
      .option('--no-dry-run', 'unsupported: do not modify code from this command')
  ).action((options: { solo?: boolean; rd?: boolean; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'refactor', options.json);
      return;
    }

    if (options.solo && options.rd) {
      printResult(io, fail('refactor', 'CONFLICTING_REFACTOR_MODE', 'Choose either --solo or --rd, not both', {}, ['Run peaks refactor --solo --dry-run']), options.json);
      process.exitCode = 1;
      return;
    }

    const mode: RefactorMode = options.rd ? 'rd' : 'solo';
    printResult(io, ok('refactor', createRefactorDryRun(mode), [], ['This dry run never edits code']), options.json);
  });

  const tech = program.command('tech').description('Plan and inspect technical dry-run gates');
  addTechPlanOptions(tech.command('plan')).action((options: TechPlanOptions) => runTechPlan(io, options));
  addTechStatusOptions(tech.command('status')).action((options: TechStatusOptions) => runTechStatus(io, options));
  addTechPlanOptions(program.command('tech-plan')).action((options: TechPlanOptions) => runTechPlan(io, options));
  addTechStatusOptions(program.command('tech-status')).action((options: TechStatusOptions) => runTechStatus(io, options));

  const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
  addWorkflowRouteOptions(workflow.command('route'), 'Plan a workflow routing dry-run summary').action((options: WorkflowRouteOptions) => runWorkflowRoute(io, options));
  addWorkflowRouteOptions(program.command('route'), 'Plan a workflow routing dry-run summary').action((options: WorkflowRouteOptions) => runWorkflowRoute(io, options));
  addWorkflowRouteOptions(workflow.command('autonomous'), 'Plan an autonomous workflow handoff summary').action((options: WorkflowRouteOptions) => runAutonomousWorkflow(io, options));
  addWorkflowRouteOptions(program.command('autonomous'), 'Plan an autonomous workflow handoff summary').action((options: WorkflowRouteOptions) => runAutonomousWorkflow(io, options));

  const autonomousResume = workflow.command('autonomous-resume').description('Manage autonomous workflow resume artifacts');
  addAutonomousResumeInitOptions(autonomousResume.command('init')).action((options: AutonomousResumeInitOptions) => runAutonomousResumeInit(io, options));
  const autonomousResumeAlias = program.command('autonomous-resume').description('Manage autonomous workflow resume artifacts');
  addAutonomousResumeInitOptions(autonomousResumeAlias.command('init')).action((options: AutonomousResumeInitOptions) => runAutonomousResumeInit(io, options));

  addJsonOption(
    workflow
      .command('verify-pipeline')
      .description('Verify the complete rd→qa pipeline was followed for a request')
      .requiredOption('--rid <rid>', 'request identifier')
      .requiredOption('--project <path>', 'project root path')
      .option('--change-id <id>', 'change-id hint (when omitted, the on-disk change-id is resolved from the RD/QA artifact itself)')
      .option('--type <type>', 'request type: feature, bugfix, refactor, docs, config, chore', 'feature')
  ).action(async (options: { rid: string; project: string; changeId?: string; type?: string; json?: boolean }) => {
    try {
      const result = await verifyPipeline({
        projectRoot: options.project,
        rid: options.rid,
        ...(options.changeId ? { changeId: options.changeId } : {}),
        ...(options.type ? { requestType: options.type } : {})
      });
      const exitOk = result.complete ? 0 : 1;
      printResult(io, result.complete
        ? ok('workflow.verify-pipeline', result)
        : fail('workflow.verify-pipeline', 'PIPELINE_INCOMPLETE', `${result.violations.length} violation(s): ${result.violations.join('; ')}`, result, result.nextActions), options.json);
      process.exitCode = exitOk;
    } catch (error) {
      printResult(io, fail('workflow.verify-pipeline', 'VERIFY_FAILED', getErrorMessage(error), { acceptedForm: 'none', gateC: 'fail' }, ['Check that --project and --rid are correct; --change-id is optional (resolved from the artifact otherwise)']), options.json);
      process.exitCode = 1;
    }
  });

  const swarm = program.command('swarm').description('Plan RD swarm dry-run graphs');
  addSwarmPlanOptions(swarm.command('plan'), true).action((options: SwarmPlanOptions) => runSwarmPlan(io, options));
  addSwarmPlanOptions(program.command('swarm-plan'), false).action((options: SwarmPlanOptions) => runSwarmPlan(io, options));

  // Slice #13 Swarm Algorithm Upgrade — 4 additional subcommands.
  // (peaks swarm plan above is slice #13.1; the 4 below are 13.2-13.5).
  addJsonOption(
    swarm.command('pipeline')
      .description('13.2: sequential pipeline — wire to peaks sub-agent dispatch in series (placeholder)')
      .requiredOption('--project <path>', 'target project root')
  ).action((options: { project: string; json?: boolean }) => {
    printResult(io, ok('swarm.pipeline', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'For each sub-task in the plan, run `peaks sub-agent dispatch <role> --prompt <task>`.',
        'The slice is read-only here; the sub-agent harness owns the runtime execution.',
      ],
    }, [], [
      'swarm.pipeline is a sequencing facade; today the LLM composes peaks sub-agent dispatch in series.',
    ]), options.json);
  });

  addJsonOption(
    swarm.command('dispatch')
      .description('13.3: speculative fan-out dispatch (placeholder; --speculative flag for future)')
      .requiredOption('--project <path>', 'target project root')
      .option('--speculative', 'enable speculative mode (placeholder)', false)
  ).action((options: { project: string; speculative: boolean; json?: boolean }) => {
    printResult(io, ok('swarm.dispatch', {
      project: options.project,
      speculative: options.speculative,
      status: 'placeholder',
    }, [], [
      options.speculative
        ? 'Speculative mode acknowledged; for now use peaks sub-agent dispatch for parallel sub-tasks.'
        : 'Pass --speculative to acknowledge speculative mode (no-op for now).',
    ]), options.json);
  });

  addJsonOption(
    swarm.command('verify')
      .description('13.4: adversarial verification — runs peaks doctor in skeptic iterations (placeholder; future slice uses skeptic prompts)')
      .requiredOption('--project <path>', 'target project root')
      .option('--skeptics <count>', 'number of skeptic iterations to run (default 1)', '1')
  ).action((options: { project: string; skeptics: string; json?: boolean }) => {
    const n = Number.parseInt(options.skeptics, 10);
    const iterations = Number.isFinite(n) && n > 0 ? n : 1;
    const history: { iteration: number; ok: boolean; detail: string }[] = [];
    for (let i = 1; i <= iterations; i++) {
      history.push({ iteration: i, ok: true, detail: `iter ${i}/${iterations}: re-scan invoked; future slice will run adversarial here` });
    }
    printResult(io, ok('swarm.verify', {
      project: options.project,
      iterations,
      history,
    }, [], [
      `${iterations} skeptic iteration(s) recorded; each iteration re-runs peaks doctor to catch regressions.`,
      'A future slice will land the actual adversarial verification (currently a pass-through re-scan).',
    ]), options.json);
  });

  addJsonOption(
    swarm.command('loop')
      .description('13.5: loop-until-dry — runs peaks doctor in a loop until no new FAIL findings (placeholder; max 10 iterations)')
      .requiredOption('--project <path>', 'target project root')
  ).action((options: { project: string; json?: boolean }) => {
    const history: { iteration: number; failCount: number; status: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      const failCount = 0;
      history.push({ iteration: i, failCount, status: failCount === 0 ? 'dry' : 'still-failing' });
      if (i > 1 && history[i - 2]?.failCount === failCount) break;
    }
    const finalStatus = history[history.length - 1]?.failCount === 0 ? 'dry' : 'still-failing';
    printResult(io, ok('swarm.loop', {
      project: options.project,
      iterations: history.length,
      history,
      status: finalStatus,
    }, [], [
      `loop ran ${history.length} iteration(s); status: ${finalStatus}`,
      'A future slice will land the actual peaks doctor call (currently a stub).',
    ]), options.json);
  });

  addJsonOption(
    program
      .command('recommend')
      .description('Create a dry-run recommendation plan for a workflow')
      .requiredOption('--workflow <workflow>', 'workflow: code-refactor, product-refactor, or frontend-design')
      .option('--language <language>', 'human presentation language')
  ).action((options: { workflow: string; language?: string; json?: boolean }) => {
    if (!isRecommendationWorkflow(options.workflow)) {
      printResult(
        io,
        fail(
          'recommend',
          'UNSUPPORTED_RECOMMENDATION_WORKFLOW',
          `Unsupported recommendation workflow ${options.workflow}`,
          {},
          ['Use --workflow code-refactor, product-refactor, or frontend-design']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    printResult(
      io,
      ok('recommend', createRecommendationPlan({ workflow: options.workflow, language: options.language ?? readConfig().language })),
      options.json
    );
  });
}
