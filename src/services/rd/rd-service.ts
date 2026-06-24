import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { stableRealPath } from '../../shared/path-utils.js';
import { validateChangeIdOrThrow, buildArtifactRelativePath } from '../../shared/change-id.js';
import { WORKSPACE_UNAVAILABLE_NEXT_ACTIONS } from '../../shared/planner-response.js';
import { getLocalArtifactPath, hasValidArtifactWorkspace } from '../artifacts/workspace-service.js';
import { getChangeScopeDirAbs } from '../artifacts/change-scope-service.js';
import type { WorkspaceConfig } from '../config/config-types.js';
import { getConfiguredExecutionModelId, STRONGEST_MODEL_ID } from '../config/model-routing.js';

/**
 * 2.0.1-bug1: the slim 2.0 `~/.peaks/config.json` no longer carries a
 * `providers` block (legacy model config lives in
 * `.peaks/preferences.json` per spec §10.4). `buildPlan` is a pure
 * planner function and historically took its execution model from
 * `DEFAULT_CONFIG.providers.minimax.model`; with the slim default
 * that field is `undefined`, so `getConfiguredExecutionModelId`
 * would throw. We retain the pre-2.0 default here as a literal so
 * the planner remains usable when the caller has not passed an
 * explicit `executionModelId` (unit tests, dry-run previews, the
 * `peaks swarm plan` onboarding path). Production callers that
 * have a real `ocr.llm.model` configured pass it via
 * `request.executionModelId` (or via the legacy preferences.json
 * bridge) and bypass this fallback.
 */
const DEFAULT_EXECUTION_MODEL_ID = 'minimax-2.7';
import { getTechStatus, TECH_REQUIRED_ARTIFACTS } from '../tech/tech-service.js';
import {
  buildRdStandardsGateList,
  detectMissingProjectStandards,
  type RdStandardGate,
  resolveRdStartupStandardsCheck
} from './standards-diagnostic.js';
import { runStrategicStage, type RunStrategicInput } from './strategic-stage.js';
import { runTacticalStage, type RunTacticalInput } from './tactical-stage.js';

/**
 * Plan 3 — sub-stage entry points (strategic + tactical).
 * The existing `createRdSwarmPlan` / swarm-planner surface is unchanged;
 * these thin re-exports give callers a single-import path into the
 * strategic + tactical sub-stages.
 */
export const runStrategic = runStrategicStage;
export const runTactical = runTacticalStage;
export type { RunStrategicInput, RunTacticalInput };

export type RdSkill = 'rd';
export type RdWaveName = 'discovery' | 'planning' | 'implementation candidates' | 'unit-test execution' | 'quality gates' | 'reducer';
export type RdModelRole = 'strongest' | 'execution';

export type RdSwarmPlanRequest = {
  skill: RdSkill;
  changeId: string;
  goal: string;
  maxWorkers: number;
  dryRun: true;
  swarmMode?: boolean;
  artifactWorkspacePath?: string;
  workspace?: WorkspaceConfig;
  requiresTechApproval?: boolean;
  executionModelId?: string;
  /** Project root for the missing-standards diagnostic (slice 2026-06-16-peaks-rd-no-gates). */
  projectRoot?: string;
  /** Opt-in strict mode: hard-fail when project-local standards are missing. */
  strictStandards?: boolean;
};

export type RdTask = {
  taskId: string;
  wave: RdWaveName;
  workerKind: string;
  purpose: string;
  modelRole: RdModelRole;
  modelId: string;
  inputs: string[];
  outputs: [string, ...string[]];
  dependsOn: string[];
  conflictGroup: string;
  targetArea: string;
  expectedEvidence: string;
};

export type RdWave = {
  name: RdWaveName;
  taskIds: string[];
};

export type RdConflictGroup = {
  groupId: string;
  ownedPaths: string[];
  parallelismPolicy: string;
  reason: string;
};

export type RdPlanResult =
  | {
      available: true;
      changeId: string;
      goal: string;
      swarmMode: boolean;
      workerTarget: number;
      waves: RdWave[];
      tasks: RdTask[];
      conflictGroups: RdConflictGroup[];
      artifactRoot: string;
      outputs: {
        taskGraph: string;
        waveManifests: string[];
        workerBriefs: string[];
        reducerReport: string;
      };
      gateStatus: {
        techApprovalRequired: boolean;
        techStatus: string;
        skipReason?: string;
        /** Gate list (code-review / security / performance) reflecting standards availability. */
        standardsGates?: ReadonlyArray<RdStandardGate>;
        /** Diagnostic line emitted to stderr when standards are missing (slice 2026-06-16-peaks-rd-no-gates). */
        standardsDiagnostic?: string;
        /** When `--strict-standards` is on AND standards are missing, the stable error code. */
        standardsErrorCode?: typeof import('./standards-diagnostic.js').EPEAKS_NO_STANDARDS;
      };
      blockedReasons: string[];
      nextActions: string[];
    }
  | {
      available: false;
      behavior: 'preview' | 'blocked';
      reason: string;
      swarmMode: boolean;
      workerTarget: number;
      waves: RdWave[];
      tasks: RdTask[];
      conflictGroups: RdConflictGroup[];
      artifactRoot: string;
      outputs: {
        taskGraph: string;
        waveManifests: string[];
        workerBriefs: string[];
        reducerReport: string;
      };
      gateStatus: {
        techApprovalRequired: boolean;
        techStatus: string;
        skipReason?: string;
        /** Gate list (code-review / security / performance) reflecting standards availability. */
        standardsGates?: ReadonlyArray<RdStandardGate>;
        /** Diagnostic line emitted to stderr when standards are missing (slice 2026-06-16-peaks-rd-no-gates). */
        standardsDiagnostic?: string;
        /** When `--strict-standards` is on AND standards are missing, the stable error code. */
        standardsErrorCode?: typeof import('./standards-diagnostic.js').EPEAKS_NO_STANDARDS;
      };
      blockedReasons: string[];
      nextActions: string[];
    };

function normalizeGoal(goal: string): string {
  const normalized = goal.trim();
  if (!normalized) {
    throw new Error('Goal must be non-empty');
  }
  return normalized;
}

function isClearLowRiskGoal(goal: string): boolean {
  return /^fix\b/i.test(goal) && /\b(typo|spelling|comment|docs?|test|lint|format|copy)\b/i.test(goal);
}

const MIN_SAFE_SWARM_WORKERS = 25;
const MAX_SAFE_SWARM_WORKERS = 80;

function resolveWorkerTarget(maxWorkers: number): { workerTarget: number; blockedReasons: string[] } {
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    throw new Error('max-workers must be a positive integer');
  }

  if (maxWorkers < MIN_SAFE_SWARM_WORKERS) {
    return { workerTarget: maxWorkers, blockedReasons: ['worker-count-below-target'] };
  }

  if (maxWorkers > MAX_SAFE_SWARM_WORKERS) {
    return { workerTarget: MAX_SAFE_SWARM_WORKERS, blockedReasons: ['worker-count-capped'] };
  }

  return { workerTarget: maxWorkers, blockedReasons: [] };
}

function resolveArtifactWorkspacePath(request: Pick<RdSwarmPlanRequest, 'artifactWorkspacePath' | 'workspace'>): string | undefined {
  return request.artifactWorkspacePath ?? (request.workspace ? getLocalArtifactPath(request.workspace) : undefined);
}

function hasPlannerArtifactWorkspace(request: RdSwarmPlanRequest, artifactWorkspacePath: string | undefined): artifactWorkspacePath is string {
  return !!request.workspace && !!artifactWorkspacePath && hasValidArtifactWorkspace(request.workspace, artifactWorkspacePath);
}

function buildTaskIds(workerTarget: number): string[] {
  const fixed = [
    'rd-discovery-1', 'rd-discovery-2', 'rd-discovery-3', 'rd-discovery-4', 'rd-discovery-5', 'rd-discovery-6', 'rd-discovery-7', 'rd-discovery-8',
    'rd-planning-1', 'rd-planning-2', 'rd-planning-3', 'rd-planning-4', 'rd-planning-5', 'rd-planning-6', 'rd-planning-7', 'rd-planning-8',
    'rd-test-1', 'rd-test-2', 'rd-test-3',
    'peaks-qa-1', 'peaks-qa-2', 'peaks-qa-3', 'peaks-qa-4',
    'rd-reducer-1',
  ];

  const implementationCount = Math.max(workerTarget - fixed.length, 1);
  const implementation = Array.from({ length: implementationCount }, (_, index) => `rd-impl-${String(index + 1).padStart(3, '0')}`);
  return [...fixed.slice(0, 16), ...implementation, ...fixed.slice(16)];
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function isSafeRepoRelativePath(candidate: string): boolean {
  if (!candidate || candidate.includes('\\') || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate) || candidate.includes(':') || isAbsolute(candidate)) {
    return false;
  }

  return candidate.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function extractCandidatePath(line: string): string | null {
  const trimmed = line.trim().replace(/^[-*+]\s+/, '').trim();
  const codeSpan = trimmed.match(/^`([^`]+)`(?:\s|$)/);
  const firstToken = trimmed.split(/\s+/)[0]!;
  const candidate = codeSpan === null ? firstToken : codeSpan[1]!;
  const normalized = candidate.replace(/[),.;:]+$/, '');
  return normalized.length > 0 ? normalized : null;
}

function extractImplementationTargetAreas(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => /^#{0,6}\s*Implementation target areas\s*:?\s*$/i.test(line.trim()));
  if (sectionStart === -1) {
    return [];
  }

  const sectionLines = lines.slice(sectionStart + 1);
  const sectionEnd = sectionLines.findIndex((line) => /^#{1,6}\s+\S/.test(line.trim()));
  return (sectionEnd === -1 ? sectionLines : sectionLines.slice(0, sectionEnd))
    .map(extractCandidatePath)
    .filter((candidate): candidate is string => candidate !== null)
    .filter((candidate) => /^(?:packages|src|tests|apps|libs)\//.test(candidate))
    .filter(isSafeRepoRelativePath);
}

function hasConcreteTargetAreas(targetAreas: string[]): targetAreas is [string, ...string[]] {
  return targetAreas.length > 0;
}

function selectConcreteTargetArea(targetAreas: [string, ...string[]], index: number): string {
  return targetAreas[index % targetAreas.length] as string;
}

function getTaskModelRole(wave: RdWaveName): RdModelRole {
  return wave === 'implementation candidates' || wave === 'unit-test execution' ? 'execution' : 'strongest';
}

function getTaskModelId(modelRole: RdModelRole, executionModelId: string): string {
  return modelRole === 'execution' ? executionModelId : STRONGEST_MODEL_ID;
}

const MAX_ARTIFACT_BYTES = 256_000;

function readArtifactFile(rootPath: string, artifactWorkspacePath: string, artifact: string): string | null {
  const artifactPath = resolve(rootPath, artifact);
  try {
    const artifactWorkspaceRealPath = stableRealPath(artifactWorkspacePath);
    const rootRealPath = stableRealPath(rootPath);
    const rdRootPath = resolve(rootPath, '..');
    const sessionRootPath = resolve(rdRootPath, '..');
    if (lstatSync(sessionRootPath).isSymbolicLink() || lstatSync(rdRootPath).isSymbolicLink() || lstatSync(rootPath).isSymbolicLink() || !isInsidePath(rootRealPath, artifactWorkspaceRealPath)) {
      return null;
    }

    const artifactStat = lstatSync(artifactPath);
    if (artifactStat.isSymbolicLink() || !artifactStat.isFile() || artifactStat.size > MAX_ARTIFACT_BYTES) {
      return null;
    }
    if (!isInsidePath(stableRealPath(artifactPath), rootRealPath)) {
      return null;
    }

    const fd = openSync(artifactPath, 'r');
    try {
      const openedStat = fstatSync(fd);
      const currentStat = statSync(artifactPath);
      if (!openedStat.isFile() || openedStat.size > MAX_ARTIFACT_BYTES || openedStat.dev !== artifactStat.dev || openedStat.ino !== artifactStat.ino || openedStat.dev !== currentStat.dev || openedStat.ino !== currentStat.ino) {
        return null;
      }

      const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_ARTIFACT_BYTES) {
        return null;
      }

      const finalStat = fstatSync(fd);
      if (finalStat.dev !== openedStat.dev || finalStat.ino !== openedStat.ino) {
        return null;
      }

      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function resolveExecutionModelId(): string {
  try {
    return getConfiguredExecutionModelId(undefined);
  } catch {
    // 2.0.1-bug1: with the slim `~/.peaks/config.json` the legacy
    // `providers` block is gone, so the configured-model lookup is
    // expected to throw. Fall back to the pre-2.0 default so the
    // planner remains usable in unit tests and the dry-run path.
    return DEFAULT_EXECUTION_MODEL_ID;
  }
}

function getConcreteTargetAreas(request: RdSwarmPlanRequest, artifactWorkspacePath: string | undefined, hasApprovedTechArtifacts: boolean): string[] {
  if (!artifactWorkspacePath || !hasApprovedTechArtifacts || !hasPlannerArtifactWorkspace(request, artifactWorkspacePath)) {
    return [];
  }

  // Slice 2026-06-23-audit-5th-p1: read under the canonical change-id
  // scope dir `.peaks/_runtime/change/<changeId>/rd/architecture/`. The
  // previous `.peaks/_runtime/${changeId}/...` was a SKILL.md 2.8.3 hard-ban
  // violation (sibling of `.peaks/_runtime/`). `getChangeScopeDirAbs`
  // is the canonical location authority.
  const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspacePath, request.changeId), 'rd', 'architecture');
  const candidates = TECH_REQUIRED_ARTIFACTS.flatMap((artifact) => {
    if (artifact === 'tech-approval-record.md') {
      return [];
    }

    const content = readArtifactFile(architectureRoot, artifactWorkspacePath, artifact);
    return content ? extractImplementationTargetAreas(content) : [];
  });

  return [...new Set(candidates)];
}

/**
 * Slice 2026-06-16-peaks-rd-no-gates: optional standards overlay stamped onto
 * every `gateStatus` shape produced by this module. Built once per
 * `createRdSwarmPlan` call and merged into the result so the JSON envelope
 * always carries the gate list + diagnostic (or null when standards present).
 */
type StandardsOverlay = {
  readonly standardsGates?: ReadonlyArray<RdStandardGate>;
  readonly standardsDiagnostic?: string;
  readonly standardsErrorCode?: typeof import('./standards-diagnostic.js').EPEAKS_NO_STANDARDS;
};

function withStandardsOverlay(
  gateStatus: { techApprovalRequired: boolean; techStatus: string; skipReason?: string },
  overlay: StandardsOverlay
): { techApprovalRequired: boolean; techStatus: string; skipReason?: string } & StandardsOverlay {
  return { ...gateStatus, ...overlay };
}

function buildStandardsOverlay(request: RdSwarmPlanRequest): StandardsOverlay {
  if (!request.projectRoot) {
    return {};
  }
  const check = resolveRdStartupStandardsCheck({ projectRoot: request.projectRoot, strict: request.strictStandards === true });
  // Slice 2026-06-16-peaks-rd-no-gates — Repair cycle 1:
  // thread BOTH diagnostic and errorCode so strict-mode callers still
  // surface `EPEAKS_NO_STANDARDS`. The pre-fix version early-returned
  // on `diagnostic !== null` and dropped `errorCode` (QA#4 AC3 violation).
  const overlay: StandardsOverlay = { standardsGates: check.gates };
  const withDiagnostic = check.diagnostic !== null
    ? { ...overlay, standardsDiagnostic: check.diagnostic }
    : overlay;
  return check.errorCode !== null
    ? { ...withDiagnostic, standardsErrorCode: check.errorCode }
    : withDiagnostic;
}

function buildPlan(request: RdSwarmPlanRequest, standardsOverlay: StandardsOverlay): Omit<Extract<RdPlanResult, { available: true }>, 'available'> {
  validateChangeIdOrThrow(request.changeId);
  const goal = normalizeGoal(request.goal);
  const swarmMode = request.swarmMode ?? true;
  const executionModelId = request.executionModelId?.trim() || resolveExecutionModelId();
  const { workerTarget, blockedReasons } = resolveWorkerTarget(request.maxWorkers);
  const artifactWorkspacePath = resolveArtifactWorkspacePath(request);
  const artifactRoot = buildArtifactRelativePath(request.changeId, 'rd', 'swarm');
  const techStatus = getTechStatus({
    changeId: request.changeId,
    ...(artifactWorkspacePath ? { artifactWorkspacePath } : {}),
    ...(request.workspace ? { workspace: request.workspace } : {}),
  });
  const requiresTechApproval = request.requiresTechApproval ?? !isClearLowRiskGoal(goal);
  const techGateSkipped = !requiresTechApproval;

  if (!swarmMode) {
    return {
      changeId: request.changeId,
      goal,
      swarmMode,
      workerTarget,
      waves: [],
      tasks: [],
      conflictGroups: [],
      artifactRoot,
      outputs: {
        taskGraph: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'task-graph.json'),
        waveManifests: [],
        workerBriefs: [],
        reducerReport: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'reducer-report.md'),
      },
      gateStatus: withStandardsOverlay({
        techApprovalRequired: requiresTechApproval,
        techStatus: techStatus.status,
        ...(techGateSkipped ? { skipReason: 'tech-gate-skipped-clear-implementation-path' as const } : {}),
      }, standardsOverlay),
      blockedReasons,
      nextActions: [],
    };
  }

  if (requiresTechApproval && techStatus.status !== 'approved') {
    return {
      changeId: request.changeId,
      goal,
      swarmMode,
      workerTarget,
      waves: [],
      tasks: [],
      conflictGroups: [],
      artifactRoot,
      outputs: {
        taskGraph: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'task-graph.json'),
        waveManifests: [],
        workerBriefs: [],
        reducerReport: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'reducer-report.md'),
      },
      gateStatus: withStandardsOverlay({
        techApprovalRequired: true,
        techStatus: techStatus.status,
      }, standardsOverlay),
      blockedReasons: ['tech-approval-required', ...blockedReasons],
      nextActions: ['Run peaks tech plan --dry-run and approve the tech plan before running peaks swarm plan.'],
    };
  }

  if (blockedReasons.includes('worker-count-below-target')) {
    return {
      changeId: request.changeId,
      goal,
      swarmMode,
      workerTarget,
      waves: [],
      tasks: [],
      conflictGroups: [],
      artifactRoot,
      outputs: {
        taskGraph: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'task-graph.json'),
        waveManifests: [],
        workerBriefs: [],
        reducerReport: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'reducer-report.md'),
      },
      gateStatus: withStandardsOverlay({
        techApprovalRequired: requiresTechApproval,
        techStatus: techStatus.status,
        ...(techGateSkipped ? { skipReason: 'tech-gate-skipped-clear-implementation-path' as const } : {}),
      }, standardsOverlay),
      blockedReasons,
      nextActions: ['Lower max-workers to match the current change scope or accept the capped target.'],
    };
  }

  const taskIds = buildTaskIds(workerTarget);
  const concreteTargetAreas = getConcreteTargetAreas(request, artifactWorkspacePath, techStatus.status === 'approved');
  const discoveryTaskIds = taskIds.slice(0, 8);
  const planningTaskIds = taskIds.slice(8, 16);
  const implementationTaskIds = taskIds.slice(16, taskIds.length - 8);
  const unitTestTaskIds = taskIds.slice(taskIds.length - 8, taskIds.length - 5);
  const qualityTaskIds = taskIds.slice(taskIds.length - 5, taskIds.length - 1);
  const reducerTaskIds = taskIds.slice(taskIds.length - 1);

  const waves: RdWave[] = [
    { name: 'discovery', taskIds: [...discoveryTaskIds] },
    { name: 'planning', taskIds: [...planningTaskIds] },
    { name: 'implementation candidates', taskIds: [...implementationTaskIds] },
    { name: 'unit-test execution', taskIds: [...unitTestTaskIds] },
    { name: 'quality gates', taskIds: [...qualityTaskIds] },
    { name: 'reducer', taskIds: [...reducerTaskIds] },
  ];

  const waveDependencies: Record<RdWaveName, string[]> = {
    discovery: [],
    planning: discoveryTaskIds,
    'implementation candidates': planningTaskIds,
    'unit-test execution': implementationTaskIds,
    'quality gates': unitTestTaskIds,
    reducer: qualityTaskIds,
  };

  const tasks: RdTask[] = taskIds.map((taskId, index): RdTask => {
    const wave: RdWaveName = index < 8 ? 'discovery' : index < 16 ? 'planning' : index < taskIds.length - 8 ? 'implementation candidates' : index < taskIds.length - 5 ? 'unit-test execution' : index < taskIds.length - 1 ? 'quality gates' : 'reducer';
    const briefPath = buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'workers', taskId, 'brief.md');
    const implementationIndex = index - 16;
    const targetArea = wave === 'implementation candidates' && hasConcreteTargetAreas(concreteTargetAreas)
      ? selectConcreteTargetArea(concreteTargetAreas, implementationIndex)
      : `area-${wave}`;
    const modelRole = getTaskModelRole(wave);
    return {
      taskId,
      wave,
      workerKind: taskId,
      purpose: `${taskId.replace(/^rd-/, '').replace(/-/g, ' ')} for ${goal}`,
      modelRole,
      modelId: getTaskModelId(modelRole, executionModelId),
      inputs: [goal, artifactRoot],
      outputs: [briefPath] as [string, ...string[]],
      dependsOn: [...waveDependencies[wave]],
      conflictGroup: `group-${wave.replace(/\s+/g, '-')}`,
      targetArea,
      expectedEvidence: wave === 'reducer'
        ? 'reducer-report.md'
        : wave === 'implementation candidates'
          ? `${taskId}-patch-summary.md`
          : wave === 'unit-test execution'
            ? `${taskId}-test-command-result.md`
            : wave === 'quality gates'
              ? `${taskId}-qa-review.md`
              : `${taskId}.md`,
    };
  });

  const conflictGroups: RdConflictGroup[] = waves.map((wave) => ({
    groupId: `group-${wave.name.replace(/\s+/g, '-')}`,
    ownedPaths: wave.taskIds.map((taskId) => buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'workers', taskId, 'brief.md')),
    parallelismPolicy: wave.taskIds.length > 1 ? 'parallel' : 'sequential',
    reason: `${wave.name} work is isolated by worker output path`,
  }));

  return {
    changeId: request.changeId,
    goal,
    swarmMode,
    workerTarget,
    waves,
    tasks,
    conflictGroups,
    artifactRoot,
    outputs: {
      taskGraph: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'task-graph.json'),
      waveManifests: waves.map((wave, index) => buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'waves', `wave-${index + 1}-${wave.name}.json`)),
      workerBriefs: tasks.map((task) => task.outputs[0]),
      reducerReport: buildArtifactRelativePath(request.changeId, 'rd', 'swarm', 'reducer-report.md'),
    },
    gateStatus: withStandardsOverlay({
      techApprovalRequired: requiresTechApproval,
      techStatus: techStatus.status,
      ...(techGateSkipped ? { skipReason: 'tech-gate-skipped-clear-implementation-path' as const } : {}),
    }, standardsOverlay),
    blockedReasons,
    nextActions: blockedReasons.length > 0 ? ['Lower max-workers to match the current change scope or accept the capped target.'] : [],
  };
}

export function createRdSwarmPlan(request: RdSwarmPlanRequest): RdPlanResult {
  if (request.skill !== 'rd') {
    throw new Error('Unsupported skill');
  }

  const standardsOverlay = buildStandardsOverlay(request);
  const result = buildPlan(request, standardsOverlay);
  const artifactWorkspacePath = resolveArtifactWorkspacePath(request);

  if (!hasPlannerArtifactWorkspace(request, artifactWorkspacePath)) {
    return {
      available: false,
      behavior: 'preview',
      reason: 'artifact-workspace-unavailable',
      swarmMode: result.swarmMode,
      workerTarget: result.workerTarget,
      waves: result.waves,
      tasks: result.tasks,
      conflictGroups: result.conflictGroups,
      artifactRoot: result.artifactRoot,
      outputs: result.outputs,
      gateStatus: result.gateStatus,
      blockedReasons: result.blockedReasons,
      nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS],
    };
  }

  const blockedReason = result.blockedReasons[0];
  if (blockedReason) {
    return {
      available: false,
      behavior: 'blocked',
      reason: blockedReason,
      swarmMode: result.swarmMode,
      workerTarget: result.workerTarget,
      waves: result.waves,
      tasks: result.tasks,
      conflictGroups: result.conflictGroups,
      artifactRoot: result.artifactRoot,
      outputs: result.outputs,
      gateStatus: result.gateStatus,
      blockedReasons: result.blockedReasons,
      nextActions: result.nextActions,
    };
  }

  return {
    available: true,
    ...result,
  };
}
