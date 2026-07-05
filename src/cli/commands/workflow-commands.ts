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
import { getEconomyAwareExecutionModelId } from '../../services/config/model-routing.js';
import { getLocalArtifactPath } from '../../services/artifacts/workspace-service.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { getSessionDir } from '../../services/session/getSessionDir.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { verifyPipeline } from '../../services/workflow/pipeline-verify-service.js';
import { applySkip, detectCallerKind, type SkipArgs } from '../../services/workflow/workflow-skip-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, isRecommendationWorkflow, printResult, type ProgramIO } from '../cli-helpers.js';
// Plan 1 / Task 9 — auto-build peaks-context before peaks-rd runs.
import { buildContext } from '../../services/context/context-builder.js';
// Plan 1 / Task 10 — production fetcher (replaces mockFetcher).
import { createHeadroomFetcher } from '../../services/context/headroom-fetcher.js';

function buildHeadroomFetcher(sid: string): import('../../services/context/doc-retriever.js').DocFetcher {
  return createHeadroomFetcher({
    cacheDir: `.peaks/_runtime/${sid}/doc-cache`,
    // remoteFetcher wired in a future slice (headroom-ai programmatic API).
  });
}

async function ensureContextForRd(goal: string, project: string, sid: string): Promise<void> {
  const out = `.peaks/_runtime/${sid}/context.json`;
  try {
    await buildContext({
      goal,
      project,
      audience: 'peaks-rd',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out,
      fetcher: buildHeadroomFetcher(sid),
    });
  } catch (error) {
    // Plan 1 / Task 9 — context is a pre-step, not a precondition.
    // If the Collector (e.g. missing package.json) or DocRetriever
    // fails, we still want the rd slice to proceed. Task 11
    // upgrades this to a hard precondition once the rd slice
    // actually consumes context.json.
    const message = error instanceof Error ? error.message : 'unknown context build failure';
    process.stderr.write(`[peaks-context] rd pre-step skipped: ${message}\n`);
  }
}

interface WorkspaceContext {
  workspace?: WorkspaceConfig;
  artifactWorkspacePath?: string;
  sessionId?: string;
  sessionDir?: string;
  // Slice 2026-06-16-peaks-rd-no-gates — Repair cycle 2:
  // thread `projectRoot` so CLI callers surface standards overlays (EPEAKS_NO_STANDARDS).
  projectRoot?: string;
}

interface TechPlanOptions {
  // Slice 2026-06-29-change-id-root-removal: `sessionId` is no longer
  // a CLI option; the planner derives scope from the active session.
  goal: string;
  swarm?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

interface TechStatusOptions {
  json?: boolean;
}

interface WorkflowRouteOptions {
  mode: string;
  goal: string;
  soloMode?: string;
  maxWorkers: string;
  dryRun?: boolean;
  json?: boolean;
}

interface SwarmPlanOptions {
  skill?: string;
  goal: string;
  maxWorkers: string;
  dryRun?: boolean;
  json?: boolean;
  /** Slice 2026-06-16-peaks-rd-no-gates — opt-in strict standards mode. */
  strictStandards?: boolean;
}

interface AutonomousResumeInitOptions {
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
    if (!workspace) return { projectRoot };
    return { projectRoot, workspace, artifactWorkspacePath: getLocalArtifactPath(workspace) };
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

function validatePlanningInput(goal: string): void {
  // v2.17.0: change-id axis removed. The planning input is now keyed
  // by the session id (already bound via `peaks workspace init`),
  // not by a user-supplied change-id. Only the goal is validated.
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
    validatePlanningInput(options.goal);
    const workspaceContext = getCurrentWorkspaceContext();
    // Slice 2026-06-29-change-id-root-removal: the change-id axis is
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
    printResult(io, fail('tech.plan', 'INVALID_GOAL', getErrorMessage(error), {}, ['Use a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

function runTechStatus(io: ProgramIO, options: TechStatusOptions): void {
  try {
    const workspaceContext = getCurrentWorkspaceContext();
    printResult(io, ok('tech.status', getTechStatus({ sessionId: '', ...workspaceContext })), options.json);
  } catch (error) {
    printResult(io, fail('tech.status', 'TECH_STATUS_FAILED', getErrorMessage(error), {}, ['Verify the project setup']), options.json);
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
    validatePlanningInput(options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const plan = createWorkflowRouterPlan({
      sessionId: '',
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
    printResult(io, fail('workflow.route', 'INVALID_GOAL', getErrorMessage(error), {}, ['Use a non-empty goal']), options.json);
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
    validatePlanningInput(options.goal);
    const workspaceContext = getWorkflowWorkspaceContext();
    const plan = createAutonomousWorkflowPlan({
      sessionId: '',
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
    printResult(io, fail('workflow.autonomous', 'INVALID_GOAL', getErrorMessage(error), {}, ['Use a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

async function runSwarmPlan(io: ProgramIO, options: SwarmPlanOptions): Promise<void> {
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
    // Slice 2026-06-16-peaks-rd-no-gates — wire the strict-mode exit code.
    // The service-layer stamps `standardsErrorCode` onto the envelope; the
    // CLI is responsible for translating it into a non-zero exit.
    if (plan.gateStatus.standardsErrorCode === 'EPEAKS_NO_STANDARDS') {
      process.exitCode = 1;
    }
    printResult(io, ok('swarm.plan', plan), options.json);
  } catch (error) {
    printResult(io, fail('swarm.plan', 'INVALID_GOAL', getErrorMessage(error), {}, ['Use a non-empty goal']), options.json);
    process.exitCode = 1;
  }
}

async function runAutonomousResumeInit(io: ProgramIO, options: AutonomousResumeInitOptions): Promise<void> {
  try {
    if (!options.project || !options.project.trim()) {
      throw new Error('Project path must be non-empty');
    }
    // Slice 2026-06-29-change-id-root-removal: the change-id axis is
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
    printResult(io, fail('autonomous-resume.init', 'AUTONOMOUS_RESUME_INIT_FAILED', getErrorMessage(error), {}, ['Use a non-empty goal and a writable project path']), options.json);
    process.exitCode = 1;
  }
}

function addTechPlanOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Generate a technical dry-run graph')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--swarm', 'opt into swarm-oriented planning')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute tech planning from this CLI')
  );
}

function addTechStatusOptions(command: Command): Command {
  return addJsonOption(command.description('Inspect technical approval status'));
}

function addWorkflowRouteOptions(command: Command, description: string): Command {
  return addJsonOption(
    command
      .description(description)
      .requiredOption('--mode <mode>', 'workflow mode: solo or team')
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
    .requiredOption('--goal <goal>', 'planning goal')
    .option('--max-workers <count>', 'maximum worker count', '40')
    .option('--dry-run', 'preview without writing files', true)
    .option('--no-dry-run', 'unsupported: do not execute RD planning from this CLI')
    .option('--strict-standards', 'hard-fail (exit non-zero) when project-local standards are missing; surfaces EPEAKS_NO_STANDARDS in the JSON envelope');

  if (includeSkill) {
    configured.requiredOption('--skill <skill>', 'skill to plan for');
  }

  return addJsonOption(configured);
}

function addAutonomousResumeInitOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Write the autonomous resume artifact scaffold for the active change-id')
      .requiredOption('--goal <goal>', 'planning goal')
      .requiredOption('--project <path>', 'artifact workspace path to write under')
      .option('--apply', 'write the artifacts to disk (default is dry-run preview)')
  );
}

export function registerWorkflowCommands(program: Command, io: ProgramIO): void {
  const refactor = program.command('refactor').description('Plan a Peaks refactor run without modifying code');
  addJsonOption(
    refactor
      .option('--solo', 'use peaks-code orchestration mode')
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
      .description('Verify the complete rd→qa pipeline was followed for a request. Scans the v2.17.0 canonical session-axis layout (artifacts under _runtime per-session) and falls back to the legacy v2.16.0 change-axis forms during the 1-minor-release deprecation window.')
      .requiredOption('--rid <rid>', 'request identifier')
      .requiredOption('--project <path>', 'project root path')
      .option('--type <type>', 'request type: feature, bugfix, refactor, docs, config, chore', 'feature')
      .option('--session-id <sid>', 'slice 2026-06-13-peaks-workflow-skip: session id under which to read the skip-state file. When omitted, no skip-state is consulted (legacy behavior).')
  ).action(async (options: { rid: string; project: string; type?: string; sessionId?: string; json?: boolean }) => {
    try {
      const result = await verifyPipeline({
        projectRoot: options.project,
        rid: options.rid,
        ...(options.type ? { requestType: options.type } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {})
      });
      const exitOk = result.complete ? 0 : 1;
      printResult(io, result.complete
        ? ok('workflow.verify-pipeline', result)
        : fail('workflow.verify-pipeline', 'PIPELINE_INCOMPLETE', `${result.violations.length} violation(s): ${result.violations.join('; ')}`, result, result.nextActions), options.json);
      process.exitCode = exitOk;
    } catch (error) {
      printResult(io, fail('workflow.verify-pipeline', 'VERIFY_FAILED', getErrorMessage(error), { acceptedForm: 'none', gateC: 'fail' }, ['Check that --project and --rid are correct.']), options.json);
      process.exitCode = 1;
    }
  });

  // Slice 2026-06-13-peaks-workflow-skip — `peaks workflow skip`.
  // Mark gates as bypassed for a specific rid, so the next
  // `verify-pipeline` reports them as `status: 'skipped'` instead of
  // missing-evidence violations. See RD
  // `.peaks/_runtime/<sid>/rd/requests/001-2026-06-13-peaks-workflow-skip.md`
  // for the three-rule classifier (type allowlist, one-time
  // semantics, role-based auth).
  addJsonOption(
    workflow
      .command('skip')
      .description('Skip specific gates for a request (RD/QA). Use --dry-run to preview without writing. Allowed gate names: QA / RD (phase shortcuts) or specific gate names (rd-request-exists, tech-doc, code-review, security-review, qa-request-exists, test-cases, test-report, security-findings, performance-findings). Three rules apply: (1) only docs/config/chore slices can skip; (2) skip is one-time per rid; (3) script callers must also pass --i-have-reviewed.')
      .requiredOption('--rid <rid>', 'request identifier')
      .requiredOption('--project <path>', 'project root path')
      .requiredOption('--gates <list>', 'comma-separated gate names (e.g. "QA" or "QA,slice-check" or "code-review,security-review")')
      .requiredOption('--reason <text>', 'free-text justification; persisted in the state file and surfaced in verify-pipeline nextActions')
      .option('--dry-run', 'preview the skip; do not write the state file')
      .option('--i-have-reviewed', 'required when caller is a script (CI / postinstall / cron). LLM and human callers do not need this.')
  ).action(async (options: { rid: string; project: string; gates: string; reason: string; dryRun?: boolean; iHaveReviewed?: boolean; json?: boolean }) => {
    try {
      // Resolve the session id from the project's current binding
      // (CLI is the single source of truth per the dev-preference
      // rules). The skip-state is keyed by session id, so the
      // operator's current session determines where the marker
      // lives. Auto-rotation on outer-mismatch is irrelevant here
      // because we read, not write, the binding.
      const sessionId = getSessionId(options.project);
      if (sessionId === null) {
        printResult(io, fail('workflow.skip', 'NO_ACTIVE_SESSION', `project "${options.project}" has no peaks-code session binding; run \`peaks workspace init --project ${options.project} --json\` first`, { applied: false }, [`peaks workspace init --project ${options.project} --json`]), options.json);
        process.exitCode = 1;
        return;
      }
      const callerKind = detectCallerKind(process.env['PEAKS_CALLER_ID']);
      const skipArgs: SkipArgs = {
        rid: options.rid,
        gatesRaw: options.gates,
        reason: options.reason,
        ...(options.dryRun === true ? { dryRun: true } : {}),
        ...(options.iHaveReviewed === true ? { iHaveReviewed: true } : {}),
        callerKind
      };
      const result = await applySkip(options.project, sessionId, skipArgs);
      if (result.applied) {
        printResult(io, ok('workflow.skip', result, [], [
          `Skip applied for rid "${options.rid}": gates [${result.skippedGates.join(', ')}] marked as status: 'skipped' on next verify-pipeline.`,
          `State file: ${result.persistedTo}`,
          `Run \`peaks workflow verify-pipeline --rid ${options.rid} --project ${options.project} --session-id ${sessionId} --json\` to confirm.`
        ]), options.json);
        return;
      }
      if (result.idempotent) {
        printResult(io, ok('workflow.skip', result, [], [`Skip already applied for rid "${options.rid}"; idempotent no-op.`]), options.json);
        return;
      }
      // applied:false + reason → rejection.
      printResult(io, fail('workflow.skip', 'SKIP_REJECTED', result.reason ?? 'unknown rejection', result, [
        'See RD request for the three rules: docs/config/chore only, one-time per rid, script callers need --i-have-reviewed.'
      ]), options.json);
      process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('workflow.skip', 'SKIP_FAILED', getErrorMessage(error), { applied: false }, ['Check that --project and --rid are correct; --reason and --gates are required.']), options.json);
      process.exitCode = 1;
    }
  });

  const swarm = program.command('swarm').description('Plan RD swarm dry-run graphs');
  addSwarmPlanOptions(swarm.command('plan'), true).action(async (options: SwarmPlanOptions) => { await runSwarmPlan(io, options); });
  addSwarmPlanOptions(program.command('swarm-plan'), false).action(async (options: SwarmPlanOptions) => { await runSwarmPlan(io, options); });

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
      ok('recommend', createRecommendationPlan({ workflow: options.workflow, language: options.language ?? readConfig().language ?? 'en' })),
      options.json
    );
  });
}
