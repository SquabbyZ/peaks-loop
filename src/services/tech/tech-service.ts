import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInsidePath, stableRealPath } from '../../shared/path-utils.js';
import { buildArtifactRelativePath, validateChangeIdOrThrow } from '../../shared/change-id.js';
import { WORKSPACE_UNAVAILABLE_NEXT_ACTIONS } from '../../shared/planner-response.js';
import type { WorkspaceConfig } from '../config/config-types.js';
import { hasValidArtifactWorkspace } from '../artifacts/workspace-service.js';

export type TechWaveName = 'scan' | 'document' | 'review' | 'reducer';
export type TechStatusValue = 'unavailable' | 'missing' | 'blocked' | 'approved';

export type TechPlanRequest = {
  changeId: string;
  goal: string;
  swarm: boolean;
  dryRun: true;
  artifactWorkspacePath?: string;
  workspace?: WorkspaceConfig;
};

export type TechWave = {
  name: TechWaveName;
  taskIds: string[];
};

export type TechTask = {
  taskId: string;
  wave: TechWaveName;
  workerKind: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  dependsOn: string[];
  conflictGroup: string;
  briefPath: string;
};

export type TechPlanGraph = {
  available: true;
  changeId: string;
  goal: string;
  swarm: boolean;
  dryRun: true;
  artifactRoot: string;
  waves: TechWave[];
  tasks: TechTask[];
  outputs: {
    taskGraph: string;
    waveManifests: string[];
    reviewChecklist: string;
    approvalTemplate: string;
  };
  blockedReasons: string[];
  nextActions: string[];
};

export type TechPlanPreview = {
  available: false;
  behavior: 'preview';
  reason: string;
  preview: Omit<TechPlanGraph, 'available'>;
  nextActions: readonly string[];
};

export type TechPlanResult = TechPlanGraph | TechPlanPreview;

export type TechStatus = {
  changeId: string;
  status: TechStatusValue;
  artifactRoot: string;
  requiredArtifacts: string[];
  missingArtifacts: string[];
  approvalRecord: string | null;
  blockedReasons: string[];
  nextActions: string[];
};

export const TECH_REQUIRED_ARTIFACTS = Object.freeze([
  'frontend-tech-doc.md',
  'backend-tech-doc.md',
  'contract-tech-doc.md',
  'test-tech-doc.md',
  'platform-tech-doc.md',
  'security-tech-doc.md',
  'ci-tech-doc.md',
  'migration-tech-doc.md',
  'tech-review-report.md',
  'tech-approval-record.md',
]);

const TECH_WAVE_TASKS: readonly [
  { name: TechWaveName; taskIds: string[] },
  { name: TechWaveName; taskIds: string[] },
  { name: TechWaveName; taskIds: string[] },
  { name: TechWaveName; taskIds: string[] },
] = [
  { name: 'scan', taskIds: ['tech-architecture-scan', 'tech-frontend-scan', 'tech-backend-scan', 'tech-contract-scan', 'tech-test-scan', 'tech-platform-scan', 'tech-security-scan', 'tech-ci-scan'] },
  { name: 'document', taskIds: ['tech-frontend-doc-worker', 'tech-backend-doc-worker', 'tech-contract-doc-worker', 'tech-test-doc-worker', 'tech-platform-doc-worker', 'tech-security-doc-worker', 'tech-ci-doc-worker', 'tech-migration-doc-worker'] },
  { name: 'review', taskIds: ['tech-architecture-reviewer', 'tech-contract-reviewer', 'tech-security-reviewer', 'tech-test-reviewer', 'tech-platform-reviewer', 'tech-risk-reviewer'] },
  { name: 'reducer', taskIds: ['tech-reducer'] },
];

function assertNonEmptyGoal(goal: string): void {
  if (goal.trim().length === 0) {
    throw new Error('Goal must be non-empty');
  }
}

function architectureRoot(changeId: string): string {
  return buildArtifactRelativePath(changeId, 'architecture');
}

function hasPlannerArtifactWorkspace(artifactWorkspacePath: string, workspace?: WorkspaceConfig): boolean {
  return !!workspace && hasValidArtifactWorkspace(workspace, artifactWorkspacePath);
}

function isEscapedArchitectureRoot(rootPath: string, artifactWorkspacePath: string): boolean {
  if (!existsSync(rootPath)) {
    return false;
  }

  try {
    return !isInsidePath(stableRealPath(rootPath), stableRealPath(artifactWorkspacePath));
  } catch {
    return true;
  }
}

function isValidArtifactFile(rootPath: string, artifact: string): boolean {
  const artifactPath = resolve(rootPath, artifact);
  try {
    const artifactStat = lstatSync(artifactPath);
    if (artifactStat.isSymbolicLink()) return false;
    if (!artifactStat.isFile()) return false;
    if (!isInsidePath(stableRealPath(artifactPath), stableRealPath(rootPath))) return false;
    return true;
  } catch {
    return false;
  }
}

function waveManifestPath(changeId: string, index: number, wave: TechWaveName): string {
  return buildArtifactRelativePath(changeId, 'architecture', 'waves', `wave-${index + 1}-${wave}.json`);
}

function taskPurpose(taskId: string, goal: string): string {
  return `${taskId.replace(/^tech-/, '').replace(/-/g, ' ')} for ${goal}`;
}

function createTechGraph(request: TechPlanRequest): Omit<TechPlanGraph, 'available'> {
  validateChangeIdOrThrow(request.changeId);
  assertNonEmptyGoal(request.goal);

  const [scanWave, documentWave, reviewWave] = TECH_WAVE_TASKS;
  const waves = TECH_WAVE_TASKS.map((wave) => ({ name: wave.name, taskIds: [...wave.taskIds] }));
  const scanTaskIds = scanWave.taskIds;
  const documentTaskIds = documentWave.taskIds;
  const reviewTaskIds = reviewWave.taskIds;
  const tasks = TECH_WAVE_TASKS.flatMap((wave) => wave.taskIds.map((taskId) => {
    const dependsOn = wave.name === 'scan'
      ? []
      : wave.name === 'document'
        ? [...scanTaskIds]
        : wave.name === 'review'
          ? [...documentTaskIds]
          : [...reviewTaskIds];
    const briefPath = buildArtifactRelativePath(request.changeId, 'architecture', 'workers', taskId, 'brief.md');
    return {
      taskId,
      wave: wave.name,
      workerKind: taskId,
      purpose: taskPurpose(taskId, request.goal),
      inputs: [request.goal, architectureRoot(request.changeId)],
      outputs: [briefPath],
      dependsOn,
      conflictGroup: `tech-${wave.name}`,
      briefPath,
    };
  }));

  return {
    changeId: request.changeId,
    goal: request.goal,
    swarm: request.swarm,
    dryRun: true,
    artifactRoot: architectureRoot(request.changeId),
    waves,
    tasks,
    outputs: {
      taskGraph: buildArtifactRelativePath(request.changeId, 'architecture', 'tech-task-graph.json'),
      waveManifests: waves.map((wave, index) => waveManifestPath(request.changeId, index, wave.name)),
      reviewChecklist: buildArtifactRelativePath(request.changeId, 'architecture', 'tech-review-checklist.md'),
      approvalTemplate: buildArtifactRelativePath(request.changeId, 'architecture', 'tech-approval-record.template.md'),
    },
    blockedReasons: [],
    nextActions: [],
  };
}

export function createTechPlan(request: TechPlanRequest): TechPlanResult {
  const graph = createTechGraph(request);

  if (!request.artifactWorkspacePath || !hasPlannerArtifactWorkspace(request.artifactWorkspacePath, request.workspace)) {
    return {
      available: false,
      behavior: 'preview',
      reason: 'artifact-workspace-unavailable',
      preview: graph,
      nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS],
    };
  }

  return {
    available: true,
    ...graph,
  };
}

export function getTechStatus(options: { changeId: string; artifactWorkspacePath?: string; workspace?: WorkspaceConfig }): TechStatus {
  validateChangeIdOrThrow(options.changeId);
  const artifactRoot = architectureRoot(options.changeId);

  if (!options.artifactWorkspacePath) {
    return {
      changeId: options.changeId,
      status: 'unavailable',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      approvalRecord: null,
      blockedReasons: ['artifact-workspace-unavailable'],
      nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS],
    };
  }

  if (!hasPlannerArtifactWorkspace(options.artifactWorkspacePath, options.workspace)) {
    return {
      changeId: options.changeId,
      status: 'unavailable',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      approvalRecord: null,
      blockedReasons: ['artifact-workspace-unavailable'],
      nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS],
    };
  }

  const rootPath = resolve(options.artifactWorkspacePath, '.peaks', 'changes', options.changeId, 'architecture');
  const approvalRecord = buildArtifactRelativePath(options.changeId, 'architecture', 'tech-approval-record.md');
  if (isEscapedArchitectureRoot(rootPath, options.artifactWorkspacePath)) {
    return {
      changeId: options.changeId,
      status: 'blocked',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      approvalRecord: null,
      blockedReasons: ['tech-artifacts-missing'],
      nextActions: ['Run peaks tech plan --dry-run, then persist and review the required tech artifacts.'],
    };
  }

  const missingArtifacts = TECH_REQUIRED_ARTIFACTS.filter((artifact) => !existsSync(join(rootPath, artifact)) || !isValidArtifactFile(rootPath, artifact));

  if (missingArtifacts.length === 1 && missingArtifacts[0] === 'tech-approval-record.md') {
    return {
      changeId: options.changeId,
      status: 'blocked',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts,
      approvalRecord: null,
      blockedReasons: ['tech-approval-missing'],
      nextActions: ['Create tech-approval-record.md with status: approved after review.'],
    };
  }

  if (missingArtifacts.length > 0) {
    return {
      changeId: options.changeId,
      status: missingArtifacts.length === TECH_REQUIRED_ARTIFACTS.length ? 'missing' : 'blocked',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts,
      approvalRecord: missingArtifacts.includes('tech-approval-record.md') ? null : approvalRecord,
      blockedReasons: ['tech-artifacts-missing'],
      nextActions: ['Run peaks tech plan --dry-run, then persist and review the required tech artifacts.'],
    };
  }


  let approvalContent: string;
  try {
    approvalContent = readFileSync(join(rootPath, 'tech-approval-record.md'), 'utf8');
  } catch {
    return {
      changeId: options.changeId,
      status: 'blocked',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts,
      approvalRecord,
      blockedReasons: ['tech-approval-unreadable'],
      nextActions: ['Ensure tech-approval-record.md is readable and contains status: approved.'],
    };
  }

  if (!approvalContent.split(/\r?\n/).some((line) => line.trim() === 'status: approved')) {
    return {
      changeId: options.changeId,
      status: 'blocked',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts,
      approvalRecord,
      blockedReasons: ['tech-approval-not-approved'],
      nextActions: ['Update tech-approval-record.md with status: approved after review.'],
    };
  }

  return {
    changeId: options.changeId,
    status: 'approved',
    artifactRoot,
    requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
    missingArtifacts: [],
    approvalRecord,
    blockedReasons: [],
    nextActions: [],
  };
}
