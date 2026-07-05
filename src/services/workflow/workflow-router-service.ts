import { type ModelProviderConfig, type WorkspaceConfig } from '../config/config-types.js';
import { getConfiguredExecutionModelId, STRONGEST_MODEL_ID } from '../config/model-routing.js';
import { getLocalArtifactPath } from '../artifacts/workspace-service.js';
import { createRdSwarmPlan, type RdPlanResult } from '../rd/rd-service.js';
import { createTechPlan, getTechStatus, type TechPlanResult, type TechStatus } from '../tech/tech-service.js';
// Slice 2026-06-29-change-id-root-removal: `validateChangeIdOrThrow`
// was removed with the change-id axis. Path-safety helpers now live
// at `shared/path-safety.ts` if this module ever needs them.
import { WORKSPACE_UNAVAILABLE_NEXT_ACTIONS } from '../../shared/planner-response.js';

export type WorkflowMode = 'solo' | 'team';
export type SoloMode = 'full-auto' | 'guided' | 'rnd';
export type ModelTier = 'top-tier' | 'mid-tier';
export type ModelRole = 'strongest' | 'execution';
export type WorkflowRoutePolicy = 'solo-broad-multi-model' | 'team-rd-limited-multi-model';
export type WorkflowStepStage = 'product-direction' | 'design-direction' | 'tech-direction' | 'tech-review' | 'rd-planning' | 'coding-execution' | 'unit-test-execution' | 'quality-review';
export type WorkflowStepOwner = 'peaks-code' | 'peaks-rd' | 'peaks-tech' | 'human';

export type WorkflowRouterRequest = {
  sessionId: string;
  goal: string;
  mode: WorkflowMode;
  soloMode?: SoloMode;
  maxWorkers?: number;
  dryRun: true;
  artifactWorkspacePath?: string;
  workspace?: WorkspaceConfig;
  config?: {
    economyMode?: boolean;
    swarmMode?: boolean;
    providers?: ModelProviderConfig;
  };
};

export type WorkflowRouterStep = {
  readonly id: string;
  readonly stage: WorkflowStepStage;
  readonly owner: WorkflowStepOwner;
  readonly modelTier: ModelTier;
  readonly modelRole: ModelRole;
  readonly modelId: string;
  readonly reason: string;
  readonly dryRunOnly: true;
  readonly invokesAgents: false;
  readonly writesArtifacts: false;
  readonly dependsOn: readonly string[];
};

export type WorkflowModelRouting = {
  readonly strongestModel: {
    readonly modelId: 'claude-opus-4-7';
    readonly uses: readonly WorkflowStepStage[];
  };
  readonly executionModel: {
    readonly modelId: string;
    readonly uses: readonly WorkflowStepStage[];
  };
};

export type WorkflowModelAssignment = {
  readonly stage: WorkflowStepStage;
  readonly owner: WorkflowStepOwner;
  readonly modelTier: ModelTier;
  readonly modelRole: ModelRole;
  readonly modelId: string;
};

export type WorkflowModeStatus = {
  readonly economyModeEnabled: boolean;
  readonly swarmModeEnabled: boolean;
  readonly executionModelId: string;
  readonly executionModelSource: string;
  readonly summary: string;
};

export type WorkflowRouterPlan = {
  readonly sessionId: string;
  readonly goal: string;
  readonly mode: WorkflowMode;
  readonly soloMode?: SoloMode;
  readonly executionMode: 'autonomous';
  readonly decisionProfile: string;
  readonly dryRun: true;
  readonly routePolicy: WorkflowRoutePolicy;
  readonly modelRouting: WorkflowModelRouting;
  readonly modelAssignments: readonly WorkflowModelAssignment[];
  readonly modeStatus: WorkflowModeStatus;
  readonly techStatus: TechStatus;
  readonly techPlan: TechPlanResult;
  readonly rdPlan: RdPlanResult;
  readonly steps: readonly WorkflowRouterStep[];
  readonly blockedReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly constraints: readonly string[];
};

const WORKFLOW_CONSTRAINTS = Object.freeze([
  'dry-run-only',
  'requires-swarm-execution-for-rd-and-qa-when-enabled',
  'execution-model-from-config-providers',
  'do-not-launch-agents',
  'do-not-write-artifacts',
  'do-not-mutate-target-repo'
]);

const EXECUTION_STAGES: readonly WorkflowStepStage[] = ['coding-execution', 'unit-test-execution'];
const GUIDED_DECISION_STAGES: readonly WorkflowStepStage[] = ['product-direction', 'design-direction'];
const GOVERNED_DECISION_STAGES: readonly WorkflowStepStage[] = ['product-direction', 'design-direction', 'tech-direction', 'tech-review'];

export function isWorkflowMode(mode: string): mode is WorkflowMode {
  return mode === 'solo' || mode === 'team';
}

function assertSupportedMode(mode: string): asserts mode is WorkflowMode {
  if (!isWorkflowMode(mode)) {
    throw new Error('Unsupported workflow mode');
  }
}

function normalizeGoal(goal: string): string {
  const normalized = goal.trim();
  if (!normalized) {
    throw new Error('Goal must be non-empty');
  }
  return normalized;
}

function assertSoloModeAllowed(mode: WorkflowMode, soloMode: SoloMode | undefined): void {
  if (mode !== 'solo' && soloMode !== undefined) {
    throw new Error('soloMode requires solo workflow mode');
  }
}

function step(input: Omit<WorkflowRouterStep, 'dryRunOnly' | 'invokesAgents' | 'writesArtifacts' | 'modelRole' | 'modelId'>, executionModelId: string): WorkflowRouterStep {
  const modelRole: ModelRole = EXECUTION_STAGES.includes(input.stage) ? 'execution' : 'strongest';
  return {
    ...input,
    modelRole,
    modelId: modelRole === 'execution' ? executionModelId : STRONGEST_MODEL_ID,
    dryRunOnly: true,
    invokesAgents: false,
    writesArtifacts: false
  };
}

export function isSoloMode(value: string): value is SoloMode {
  return value === 'full-auto' || value === 'guided' || value === 'rnd';
}

function getDecisionProfileSummary(mode: WorkflowMode, soloMode: SoloMode | undefined): string {
  if (mode === 'team') {
    return 'Team mode keeps product and design governance on a human-controlled path while RD execution follows recommended defaults.';
  }

  if (soloMode === 'guided') {
    return 'Guided mode keeps the user in the decision loop for the early recommended defaults, while later execution remains bounded by the routing plan.';
  }

  if (soloMode === 'rnd') {
    return 'R&D mode asks for technical confirmation up front, then applies recommended defaults for implementation, testing, review, and safety checks.';
  }

  return 'Full-auto mode applies recommended defaults for product, design, and tech decisions, then runs the engineering pipeline end to end under routing gates.';
}

function annotateSteps(steps: WorkflowRouterStep[], soloMode: SoloMode): WorkflowRouterStep[] {
  const decisionStages = soloMode === 'guided'
    ? GUIDED_DECISION_STAGES
    : GOVERNED_DECISION_STAGES;
  return steps.map((currentStep) => {
    const isDecisionStage = decisionStages.includes(currentStep.stage);
    const reasonPrefix = isDecisionStage
      ? `[${soloMode}] decision stage`
      : '[routed] execution stage';
    return {
      ...currentStep,
      reason: `${reasonPrefix}: ${currentStep.reason}`
    };
  });
}

function createSoloSteps(executionModelId: string): WorkflowRouterStep[] {
  return [
    step({ id: 'solo-product-direction', stage: 'product-direction', owner: 'peaks-code', modelTier: 'top-tier', reason: 'Product direction needs strong judgment before execution work is delegated.', dependsOn: [] }, executionModelId),
    step({ id: 'solo-design-direction', stage: 'design-direction', owner: 'peaks-code', modelTier: 'top-tier', reason: 'Design direction uses the recommended default before cheaper implementation work.', dependsOn: ['solo-product-direction'] }, executionModelId),
    step({ id: 'solo-tech-direction', stage: 'tech-direction', owner: 'peaks-tech', modelTier: 'top-tier', reason: 'Technical boundaries and approval gates use the recommended default with high-confidence planning.', dependsOn: ['solo-design-direction'] }, executionModelId),
    step({ id: 'solo-tech-review', stage: 'tech-review', owner: 'peaks-tech', modelTier: 'top-tier', reason: 'Tech artifacts and gate decisions require strong review and a recommended default path.', dependsOn: ['solo-tech-direction'] }, executionModelId),
    step({ id: 'solo-rd-planning', stage: 'rd-planning', owner: 'peaks-rd', modelTier: 'top-tier', reason: 'RD task decomposition and acceptance criteria use the recommended default before execution delegation.', dependsOn: ['solo-tech-review'] }, executionModelId),
    step({ id: 'solo-coding-execution', stage: 'coding-execution', owner: 'peaks-rd', modelTier: executionModelId === STRONGEST_MODEL_ID ? 'top-tier' : 'mid-tier', reason: `Coding and routine refactoring must use the configured execution worker model ${executionModelId}.`, dependsOn: ['solo-rd-planning'] }, executionModelId),
    step({ id: 'solo-unit-test-execution', stage: 'unit-test-execution', owner: 'peaks-rd', modelTier: executionModelId === STRONGEST_MODEL_ID ? 'top-tier' : 'mid-tier', reason: `Unit test authoring and focused test runs must use the configured execution worker model ${executionModelId}.`, dependsOn: ['solo-coding-execution'] }, executionModelId),
    step({ id: 'solo-quality-review', stage: 'quality-review', owner: 'peaks-code', modelTier: 'top-tier', reason: 'Reducer and final quality gates need strong synthesis and risk review.', dependsOn: ['solo-unit-test-execution'] }, executionModelId)
  ];
}

function createSoloStepsForMode(soloMode: SoloMode, executionModelId: string): WorkflowRouterStep[] {
  return annotateSteps(createSoloSteps(executionModelId), soloMode);
}

function createTeamSteps(executionModelId: string): WorkflowRouterStep[] {
  return [
    step({ id: 'team-product-direction', stage: 'product-direction', owner: 'human', modelTier: 'top-tier', reason: 'Team product direction should stay on the governed planning path.', dependsOn: [] }, executionModelId),
    step({ id: 'team-design-direction', stage: 'design-direction', owner: 'human', modelTier: 'top-tier', reason: 'Team design direction should preserve reviewability and accountability.', dependsOn: ['team-product-direction'] }, executionModelId),
    step({ id: 'team-tech-direction', stage: 'tech-direction', owner: 'peaks-tech', modelTier: 'top-tier', reason: 'Team technical plans should remain strongly governed before RD execution.', dependsOn: ['team-design-direction'] }, executionModelId),
    step({ id: 'team-tech-review', stage: 'tech-review', owner: 'peaks-tech', modelTier: 'top-tier', reason: 'Team tech approval requires strong review before execution.', dependsOn: ['team-tech-direction'] }, executionModelId),
    step({ id: 'team-rd-planning', stage: 'rd-planning', owner: 'peaks-rd', modelTier: 'top-tier', reason: 'Team RD task decomposition remains on the governed strongest-model path.', dependsOn: ['team-tech-review'] }, executionModelId),
    step({ id: 'team-coding-execution', stage: 'coding-execution', owner: 'peaks-rd', modelTier: executionModelId === STRONGEST_MODEL_ID ? 'top-tier' : 'mid-tier', reason: `Bounded coding tasks must use the configured execution worker model ${executionModelId}.`, dependsOn: ['team-rd-planning'] }, executionModelId),
    step({ id: 'team-unit-test-execution', stage: 'unit-test-execution', owner: 'peaks-rd', modelTier: executionModelId === STRONGEST_MODEL_ID ? 'top-tier' : 'mid-tier', reason: `Unit-test tasks must use the configured execution worker model ${executionModelId}.`, dependsOn: ['team-coding-execution'] }, executionModelId),
    step({ id: 'team-quality-review', stage: 'quality-review', owner: 'peaks-rd', modelTier: 'top-tier', reason: 'Team RD outputs still need reducer and quality review gates.', dependsOn: ['team-unit-test-execution'] }, executionModelId)
  ];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function createModelRouting(steps: readonly WorkflowRouterStep[], executionModelId: string): WorkflowModelRouting {
  return {
    strongestModel: {
      modelId: STRONGEST_MODEL_ID,
      uses: steps.filter((step) => step.modelRole === 'strongest').map((step) => step.stage)
    },
    executionModel: {
      modelId: executionModelId,
      uses: steps.filter((step) => step.modelRole === 'execution').map((step) => step.stage)
    }
  };
}

function createModelAssignments(steps: readonly WorkflowRouterStep[]): WorkflowModelAssignment[] {
  return steps.map((step) => ({
    stage: step.stage,
    owner: step.owner,
    modelTier: step.modelTier,
    modelRole: step.modelRole,
    modelId: step.modelId
  }));
}

function getTechPlanBlockedReasons(techPlan: TechPlanResult): string[] {
  return techPlan.available ? techPlan.blockedReasons : techPlan.preview.blockedReasons;
}

function getTechPlanNextActions(techPlan: TechPlanResult): string[] {
  return [...techPlan.nextActions];
}

function createModeStatus(economyMode: boolean, swarmMode: boolean, executionModelId: string, executionModelSource: string): WorkflowModeStatus {
  const economySummary = economyMode
    ? `Economy mode enabled: code worker and test worker strictly use ${executionModelId} from config providers.`
    : `Economy mode disabled: code worker and test worker use ${STRONGEST_MODEL_ID}, matching planner/reviewer.`;
  const swarmSummary = swarmMode
    ? 'Swarm mode enabled: peaks-rd coding, unit-test, and peaks-qa quality work must be represented as swarm worker tasks.'
    : 'Swarm mode disabled: swarm worker graph generation is bypassed.';
  return {
    economyModeEnabled: economyMode,
    swarmModeEnabled: swarmMode,
    executionModelId,
    executionModelSource,
    summary: `${economySummary} ${swarmSummary}`
  };
}

function getSoloMode(mode: WorkflowMode, soloMode: SoloMode | undefined): SoloMode | undefined {
  if (mode !== 'solo') {
    return undefined;
  }
  if (soloMode === undefined) {
    return 'full-auto';
  }
  if (!isSoloMode(soloMode)) {
    throw new Error('Unsupported solo mode');
  }
  return soloMode;
}

export function createWorkflowRouterPlan(request: WorkflowRouterRequest): WorkflowRouterPlan {
  assertSupportedMode(request.mode);
  assertSoloModeAllowed(request.mode, request.soloMode);
  // Slice 2026-06-29-change-id-root-removal: change-id is metadata-only;
  // no structural validation gate fires here.
  const goal = normalizeGoal(request.goal);
  const maxWorkers = request.maxWorkers ?? 40;
  // Slice 2.0.1-bug1 round 3: project policy defaults. The slim 2.0.1 DEFAULT_CONFIG
  // no longer carries economyMode / swarmMode (those moved to per-project preferences),
  // so we cannot fall back to `DEFAULT_CONFIG.economyMode` / `swarmMode` here. Both
  // flags are project-policy opt-outs: the absence of an explicit `false` means
  // "enabled" (matches the pre-2.0.1 implicit default).
  const economyMode = request.config?.economyMode ?? true;
  const swarmMode = request.config?.swarmMode ?? true;
  // Pre-2.0.1 DEFAULT_CONFIG carried an implicit `minimax-2.7` provider
  // for test fixtures that did not pass `config.providers`. The slim
  // DEFAULT_CONFIG removed that field, so we re-supply it here only when
  // the caller did not pass any providers at all. An explicit empty
  // object (`config: { providers: {} }`) still surfaces the "must be
  // configured" error from `getConfiguredExecutionModelId`.
  const effectiveProviders: ModelProviderConfig = request.config?.providers ?? { minimax: { model: 'minimax-2.7' } };
  const executionModelId = economyMode !== false ? getConfiguredExecutionModelId(effectiveProviders) : STRONGEST_MODEL_ID;
  const modeStatus = createModeStatus(economyMode, swarmMode, executionModelId, economyMode ? 'config.providers' : 'planner-reviewer-strongest-model');
  const soloMode = getSoloMode(request.mode, request.soloMode);
  const decisionProfile = getDecisionProfileSummary(request.mode, soloMode);
  const artifactWorkspacePath = request.artifactWorkspacePath ?? (request.workspace ? getLocalArtifactPath(request.workspace) : undefined);
  const sharedWorkspaceOptions = {
    ...(artifactWorkspacePath ? { artifactWorkspacePath } : {}),
    ...(request.workspace ? { workspace: request.workspace } : {})
  };
  const techStatus = getTechStatus({ sessionId: request.sessionId, ...sharedWorkspaceOptions });
  const techPlan = createTechPlan({ sessionId: request.sessionId, goal, swarm: swarmMode, dryRun: true, ...sharedWorkspaceOptions });
  const rdPlan = createRdSwarmPlan({ skill: 'rd', sessionId: request.sessionId, goal, maxWorkers, swarmMode, executionModelId, dryRun: true, ...sharedWorkspaceOptions });
  const steps = soloMode ? createSoloStepsForMode(soloMode, executionModelId) : createTeamSteps(executionModelId);
  const blockedReasons = uniqueStrings([
    ...techStatus.blockedReasons,
    ...getTechPlanBlockedReasons(techPlan),
    ...rdPlan.blockedReasons
  ]);
  const nextActions = blockedReasons.includes('artifact-workspace-unavailable')
    ? [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS]
    : uniqueStrings([...techStatus.nextActions, ...getTechPlanNextActions(techPlan), ...rdPlan.nextActions]);

  return {
    sessionId: request.sessionId,
    goal,
    mode: request.mode,
    ...(soloMode ? { soloMode } : {}),
    executionMode: 'autonomous',
    decisionProfile,
    dryRun: true,
    routePolicy: request.mode === 'solo' ? 'solo-broad-multi-model' : 'team-rd-limited-multi-model',
    modelRouting: createModelRouting(steps, executionModelId),
    modelAssignments: createModelAssignments(steps),
    modeStatus,
    techStatus,
    techPlan,
    rdPlan,
    steps,
    blockedReasons,
    nextActions,
    constraints: [...WORKFLOW_CONSTRAINTS]
  };
}
