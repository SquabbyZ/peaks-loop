import { join } from 'node:path';
// Slice 2026-06-29-change-id-root-removal: `validateChangeIdOrThrow`
// was removed with the change-id axis. Path-safety helpers now live
// at `shared/path-safety.ts` if this module ever needs them.
import { WORKSPACE_UNAVAILABLE_NEXT_ACTIONS } from '../../shared/planner-response.js';
import { getLocalArtifactPath, hasValidArtifactWorkspace } from '../artifacts/workspace-service.js';
import { createCapabilityMapPlan } from '../recommendations/capability-map-service.js';
import type { CapabilityAvailabilityStatus, CapabilityItemType } from '../recommendations/recommendation-types.js';
import type { ModelProviderConfig, WorkspaceConfig } from '../config/config-types.js';
import { createRdSwarmPlan, type RdPlanResult } from '../rd/rd-service.js';
import { createWorkflowRouterPlan, type CodeMode, type WorkflowMode, type WorkflowRouterPlan } from './workflow-router-service.js';
import type {
  AutonomousCapabilityPlan,
  AutonomousGoalCommand,
  AutonomousGoalPackage,
  AutonomousMvpPackage,
  AutonomousResumePlan,
  AutonomousStoragePlan,
  AutonomousWorkflowPlan,
  AutonomousWorkflowRequest,
  CapabilityActivation,
  CapabilityCandidate,
  CapabilityPurpose,
  CapabilitySurface,
  CapabilityTrustLevel
} from './workflow-autonomous-types.js';

// Re-export the resume validation surface so external callers (CLI,
// tests) keep importing from this module unchanged. The helpers
// (`getResumeRequiredArtifacts`, `getResumeArtifactsStatus`,
// `createResumePlan`) live in the sibling
// `workflow-autonomous-resume-helpers.ts` module — see v2.18.3
// file-split for the rationale. Function signatures and behaviour
// are unchanged (verbatim move).
import { getResumeRequiredArtifacts, getResumeArtifactsStatus, createResumePlan } from './workflow-autonomous-resume-helpers.js';
export { getResumeRequiredArtifacts, getResumeArtifactsStatus, createResumePlan } from './workflow-autonomous-resume-helpers.js';

// Public type declarations live in `workflow-autonomous-types.ts` (rid-006
// split). Re-export them verbatim under their original names so existing
// import paths compile unchanged.
export type {
  AutonomousCapabilityPlan,
  AutonomousGoalCommand,
  AutonomousGoalPackage,
  AutonomousMvpPackage,
  AutonomousResumePlan,
  AutonomousStoragePlan,
  AutonomousWorkflowPlan,
  AutonomousWorkflowRequest,
  CapabilityActivation,
  CapabilityCandidate,
  CapabilityPurpose,
  CapabilitySurface,
  CapabilityTrustLevel
} from './workflow-autonomous-types.js';

const AUTONOMOUS_CONSTRAINTS = Object.freeze([
  'dry-run-only',
  'do-not-launch-workers',
  'do-not-install-capabilities',
  'do-not-mutate-claude-settings',
  'do-not-mutate-target-repo',
  'artifact-backed-resume-required',
  'evidence-before-resume'
]);

const RESUME_ARTIFACTS_MISSING_NEXT_ACTIONS = Object.freeze([
  'Persist autonomous goal package, RD plan, checkpoint, validation evidence, and resume instructions before autonomous resume.'
]);

const RESUME_ARTIFACTS_INVALID_NEXT_ACTIONS = Object.freeze([
  'Refresh autonomous resume artifacts with matching change ids, valid JSON state, and passed validation evidence before autonomous resume.'
]);

function normalizeGoal(goal: string): string {
  const normalized = goal.trim();
  if (!normalized) {
    throw new Error('Goal must be non-empty');
  }
  return normalized;
}

function resolveArtifactWorkspacePath(request: AutonomousWorkflowRequest): string | undefined {
  return request.artifactWorkspacePath ?? (request.workspace ? getLocalArtifactPath(request.workspace) : undefined);
}

function hasArtifactWorkspace(request: AutonomousWorkflowRequest, artifactWorkspacePath: string | undefined): boolean {
  return !!request.workspace && !!artifactWorkspacePath && hasValidArtifactWorkspace(request.workspace, artifactWorkspacePath);
}

function createGoalPackage(sessionId: string, goal: string): AutonomousGoalPackage {
  return {
    sessionId,
    goal,
    nonGoals: [
      'Change product behavior without explicit approval.',
      'Install MCP servers, hooks, agents, or router configuration during dry-run planning.',
      'Store API keys or provider credentials in Peaks artifacts.'
    ],
    preservedBehavior: [
      'Existing product behavior remains stable unless the accepted goal explicitly changes it.',
      'Existing repository source files are not mutated by dry-run planning.',
      'Intermediate artifacts remain outside the target repository source tree.'
    ],
    acceptanceCriteria: [
      'A resumable autonomous RD plan exists with checkpoints, worker queue, and validation evidence requirements.',
      'Curated capabilities from docs/accessRepo.md and docs/mcpServer.md are considered before custom implementation.',
      'Resume after compact verifies checkpoints and evidence before continuing.',
      'All execution remains dry-run until explicitly approved.'
    ],
    doneCondition: `The ${sessionId} autonomous plan is complete when all acceptance criteria pass, the worker queue is empty or blocked with next actions, and validation evidence is recorded.`,
    resumeCondition: `Resume ${sessionId} only after checkpoint artifacts, worker queue state, and validation evidence requirements have been verified.`,
    riskNotes: [
      'Claude Code /goal is session-scoped and cannot be the only durable state source.',
      'External capabilities may require installation, credentials, network access, or settings changes.',
      'Large swarms need conflict groups and reducer evidence to avoid unsafe parallel edits.'
    ]
  };
}

const CAPABILITY_SURFACES: readonly CapabilitySurface[] = ['skill', 'mcp', 'plugin', 'expert'];

function createCapabilitySurfaceSummary(): Record<CapabilitySurface, number> {
  return {
    skill: 0,
    mcp: 0,
    plugin: 0,
    expert: 0
  };
}

function getCapabilitySurface(itemType: CapabilityItemType): CapabilitySurface {
  if (itemType === 'skill') return 'skill';
  if (itemType === 'mcp') return 'mcp';
  if (itemType === 'agent') return 'expert';
  return 'plugin';
}

function getCapabilityTrustLevel(sourceId: string): CapabilityTrustLevel {
  if (sourceId === 'skills/*/SKILL.md' || sourceId === 'local-peaks-skills') {
    return 'local';
  }

  if (
    sourceId.startsWith('everything-claude-code')
    || sourceId.startsWith('ruflo-')
    || sourceId === 'superpowers'
    || sourceId === 'openspec'
    || sourceId === 'gstack'
    || sourceId === 'impeccable'
    || sourceId === 'andrej-karpathy-skills'
    || sourceId === 'mattpocock-skills'
  ) {
    return 'user-curated';
  }

  return 'third-party';
}

function getCapabilityPurpose(item: { category: string; itemType: CapabilityItemType }): CapabilityPurpose {
  switch (item.category) {
    case 'browser-validation':
    case 'browser-debug':
    case 'design-context':
    case 'code-search':
    case 'database-inspection':
    case 'browser-agent':
    case 'docs-lookup':
    case 'design-source':
    case 'code-review':
    case 'security-review':
    case 'coding-standards':
    case 'worker-guidance':
    case 'memory':
    case 'context-management':
    case 'ui-components':
    case 'spec-workflow':
    case 'repo-intelligence':
    case 'openspec':
    case 'workflow-methodology':
    case 'workflow-reference':
    case 'workflow-guidance':
    case 'product-guidance':
    case 'design-reference':
    case 'ui-reference':
    case 'engineering-guidance':
    case 'typescript-guidance':
    case 'quality-guidance':
    case 'skill-pack':
    case 'external-skill':
    case 'design-critique':
    case 'design-guidance':
    case 'cloud-skill-pack':
      return item.category;
    default:
      return item.itemType === 'mcp' ? 'docs-lookup' : 'workflow-guidance';
  }
}

function getCapabilityActivation(status: CapabilityAvailabilityStatus, itemType: CapabilityItemType): CapabilityActivation {
  switch (status) {
    case 'available':
      return 'available';
    case 'installable':
      return itemType === 'mcp' ? 'needs-credentials' : 'needs-install';
    case 'disabled':
      return 'not-active';
    case 'unknown':
    default:
      return itemType === 'mcp' ? 'needs-credentials' : 'not-active';
  }
}

function createCapabilityPlan(request: AutonomousWorkflowRequest): AutonomousCapabilityPlan {
  const catalogPlan = createCapabilityMapPlan({ installedCapabilityIds: request.workspace?.installedCapabilityIds ?? [] });
  const surfaceSummary = createCapabilitySurfaceSummary();
  const candidates: CapabilityCandidate[] = catalogPlan.items.map((item) => {
    const surface = getCapabilitySurface(item.itemType);
    const availability = catalogPlan.availability.find((availability) => availability.capabilityId === item.capabilityId);

    surfaceSummary[surface] += 1;
    return {
      id: item.capabilityId,
      source: item.sourceId,
      purpose: getCapabilityPurpose(item),
      surface,
      kind: surface,
      sourceType: item.itemType,
      trustLevel: getCapabilityTrustLevel(item.sourceId),
      activation: getCapabilityActivation(availability?.status ?? 'unknown', item.itemType),
      risk: [item.riskLevel] as const
    };
  });

  candidates.push({
    id: 'local-peaks-skills',
    source: 'skills/*/SKILL.md',
    purpose: 'workflow-methodology',
    surface: 'skill',
    kind: 'skill',
    sourceType: 'skill',
    trustLevel: 'local',
    activation: 'available',
    risk: ['local-skill-boundary-misuse'] as const
  });
  surfaceSummary.skill += 1;

  return {
    sources: uniqueStrings(['docs/accessRepo.md', 'docs/mcpServer.md', 'skills/*/SKILL.md', ...catalogPlan.sources.map((source) => source.sourceId)]),
    policy: [
      'reuse-curated-capabilities-before-custom-build',
      'plan-capability-use-before-activation',
      'require-explicit-approval-for-install-credentials-network-or-settings-mutation'
    ],
    candidates,
    surfaces: [...CAPABILITY_SURFACES],
    surfaceSummary
  };
}

function createMvpPackage(request: AutonomousWorkflowRequest, routePlan: WorkflowRouterPlan, rdPlan: RdPlanResult, capabilityPlan: AutonomousCapabilityPlan, ready: boolean): AutonomousMvpPackage {
  return {
    mode: request.mode,
    codeMode: routePlan.codeMode,
    executionMode: 'preview',
    dryRun: true,
    routePolicy: routePlan.routePolicy,
    rdWaveNames: rdPlan.waves.map((wave) => wave.name),
    capabilitySurfaces: [...capabilityPlan.surfaces],
    capabilityCountBySurface: { ...capabilityPlan.surfaceSummary },
    ready
  };
}

function createGoalCommand(goalPackage: AutonomousGoalPackage): AutonomousGoalCommand {
  return {
    command: `/goal ${goalPackage.doneCondition}`,
    durable: false,
    reason: 'Claude Code /goal can help continue across turns in the current session, but Peaks artifacts remain the durable state.'
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createAutonomousWorkflowPlan(request: AutonomousWorkflowRequest): AutonomousWorkflowPlan {
  // Slice 2026-06-29-change-id-root-removal: change-id is metadata-only;
  // no structural validation gate fires here.
  const goal = normalizeGoal(request.goal);
  const maxWorkers = request.maxWorkers ?? 40;
  const artifactWorkspacePath = resolveArtifactWorkspacePath(request);
  const memoryBackupPath = artifactWorkspacePath ? join(artifactWorkspacePath, '.peaks', 'memory-backups', 'project-memory-primary') : null;
  const sharedWorkspaceOptions = {
    ...(artifactWorkspacePath ? { artifactWorkspacePath } : {}),
    ...(request.workspace ? { workspace: request.workspace } : {})
  };
  const goalPackage = createGoalPackage(request.sessionId, goal);
  const available = hasArtifactWorkspace(request, artifactWorkspacePath);
  const routePlan = createWorkflowRouterPlan({
    mode: request.mode,
    ...(request.codeMode !== undefined ? { codeMode: request.codeMode } : {}),
    sessionId: request.sessionId,
    goal,
    maxWorkers,
    dryRun: true,
    ...(request.config ? { config: request.config } : {}),
    ...sharedWorkspaceOptions
  });
  const rdPlan = createRdSwarmPlan({
    skill: 'rd',
    sessionId: request.sessionId,
    goal,
    maxWorkers,
    dryRun: true,
    ...(request.config?.swarmMode !== undefined ? { swarmMode: request.config.swarmMode } : {}),
    executionModelId: routePlan.modeStatus.executionModelId,
    ...sharedWorkspaceOptions
  });
  const requiredArtifacts = getResumeRequiredArtifacts(request.sessionId);
  const resumeArtifactsStatus = available && artifactWorkspacePath
    ? getResumeArtifactsStatus(artifactWorkspacePath, requiredArtifacts, request.sessionId, goal)
    : 'missing';
  const blockedReasons = uniqueStrings([
    ...routePlan.blockedReasons,
    ...rdPlan.blockedReasons,
    ...(available ? [] : ['artifact-workspace-unavailable']),
    ...(resumeArtifactsStatus === 'missing' ? ['resume-artifacts-missing'] : []),
    ...(resumeArtifactsStatus === 'invalid' ? ['resume-artifacts-invalid'] : [])
  ]);
  const ready = available && blockedReasons.length === 0;
  const capabilityPlan = createCapabilityPlan(request);
  const mvpPackage = createMvpPackage(request, routePlan, rdPlan, capabilityPlan, ready);

  return {
    available: ready,
    behavior: ready ? 'ready' : 'preview',
    sessionId: request.sessionId,
    goal,
    mode: request.mode,
    dryRun: true,
    goalPackage,
    goalCommand: createGoalCommand(goalPackage),
    capabilityPlan,
    storagePlan: {
      scope: 'user-local',
      artifactWorkspacePath: artifactWorkspacePath ?? null,
      memoryBackupPath: memoryBackupPath ?? null
    },
    routePlan,
    modelAssignments: routePlan.modelAssignments,
    rdPlan,
    resumePlan: createResumePlan(request.sessionId, ready),
    mvpPackage,
    constraints: [...AUTONOMOUS_CONSTRAINTS],
    blockedReasons,
    nextActions: available
      ? uniqueStrings([
          ...routePlan.nextActions,
          ...rdPlan.nextActions,
          ...(resumeArtifactsStatus === 'missing' ? RESUME_ARTIFACTS_MISSING_NEXT_ACTIONS : []),
          ...(resumeArtifactsStatus === 'invalid' ? RESUME_ARTIFACTS_INVALID_NEXT_ACTIONS : [])
        ])
      : [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS]
  };
}