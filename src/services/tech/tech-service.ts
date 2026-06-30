import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInsidePath, stableRealPath } from '../../shared/path-utils.js';
import { WORKSPACE_UNAVAILABLE_NEXT_ACTIONS } from '../../shared/planner-response.js';
import type { WorkspaceConfig } from '../config/config-types.js';
import { hasValidArtifactWorkspace } from '../artifacts/workspace-service.js';
import { getSessionDir } from '../session/getSessionDir.js';

export type TechWaveName = 'scan' | 'document' | 'review' | 'reducer';
export type TechStatusValue = 'unavailable' | 'missing' | 'blocked' | 'approved';

export type TechPlanRequest = {
  sessionId: string;
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
  sessionId: string;
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
  sessionId: string;
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

function architectureRoot(_sessionId: string): string {
  // Slice 2026-06-29-change-id-root-removal: descriptor is now the bare
  // role-relative sub-path `<role>/architecture` (no `.peaks/_runtime/...`
  // prefix). The on-disk location is resolved by `architectureRootAbs`
  // via `getSessionDir`. Callers that previously split this string on
  // the change-id segment need to use the descriptor as-is and resolve
  // the absolute path via `architectureRootAbs` / `getSessionDir`.
  return 'rd/architecture';
}

function architectureRootAbs(artifactWorkspacePath: string, sessionId: string): string {
  // Slice 2026-06-29-change-id-root-removal: on-disk path now resolves
  // via the session-axis `getSessionDir(root, sessionId)` (the change-id
  // identifier is reused as the session-dir name for tech-artifact
  // reads, matching the test helper `writeApprovedTechArtifacts` and
  // `autonomous-resume-writer.ts`).
  return join(getSessionDir(artifactWorkspacePath, sessionId), 'rd', 'architecture');
}

function hasPlannerArtifactWorkspace(artifactWorkspacePath: string, workspace?: WorkspaceConfig): boolean {
  return !!workspace && hasValidArtifactWorkspace(workspace, artifactWorkspacePath);
}

function isEscapedArchitectureRoot(rootPath: string, artifactWorkspacePath: string): boolean {
  if (!existsSync(rootPath)) {
    return false;
  }

  try {
    const rdRootPath = resolve(rootPath, '..');
    const sessionRootPath = resolve(rdRootPath, '..');
    return lstatSync(sessionRootPath).isSymbolicLink()
      || lstatSync(rdRootPath).isSymbolicLink()
      || lstatSync(rootPath).isSymbolicLink()
      || !isInsidePath(stableRealPath(rootPath), stableRealPath(artifactWorkspacePath));
  } catch {
    return true;
  }
}

const MAX_TECH_ARTIFACT_BYTES = 256_000;

function readTechArtifactFile(rootPath: string, artifact: string): string | null {
  const artifactPath = resolve(rootPath, artifact);
  try {
    const rootRealPath = stableRealPath(rootPath);
    const artifactStat = lstatSync(artifactPath);
    if (artifactStat.isSymbolicLink() || !artifactStat.isFile() || artifactStat.size > MAX_TECH_ARTIFACT_BYTES) {
      return null;
    }
    if (!isInsidePath(stableRealPath(artifactPath), rootRealPath)) {
      return null;
    }

    const fd = openSync(artifactPath, 'r');
    try {
      const openedStat = fstatSync(fd);
      const currentStat = statSync(artifactPath);
      if (!openedStat.isFile() || openedStat.size > MAX_TECH_ARTIFACT_BYTES || openedStat.dev !== artifactStat.dev || openedStat.ino !== artifactStat.ino || openedStat.dev !== currentStat.dev || openedStat.ino !== currentStat.ino) {
        return null;
      }

      const buffer = Buffer.alloc(openedStat.size);
      let offset = 0;
      while (offset < openedStat.size) {
        const bytesRead = readSync(fd, buffer, offset, openedStat.size - offset, offset);
        if (bytesRead === 0) {
          return null;
        }
        offset += bytesRead;
      }

      const finalStat = fstatSync(fd);
      if (finalStat.dev !== openedStat.dev || finalStat.ino !== openedStat.ino) {
        return null;
      }
      return buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
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

function waveManifestPath(_sessionId: string, index: number, wave: TechWaveName): string {
  // Slice 2026-06-29-change-id-root-removal: descriptor is now
  // `rd/architecture/waves/<file>`. The scope root is supplied by the
  // caller via `getSessionDir`.
  return `rd/architecture/waves/wave-${index + 1}-${wave}.json`;
}

function taskPurpose(taskId: string, goal: string): string {
  return `${taskId.replace(/^tech-/, '').replace(/-/g, ' ')} for ${goal}`;
}

function createTechGraph(request: TechPlanRequest): Omit<TechPlanGraph, 'available'> {
  // Slice 2026-06-29-change-id-root-removal: change-id is metadata-only;
  // no structural validation gate fires here.
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
    const briefPath = `rd/architecture/workers/${taskId}/brief.md`;
    return {
      taskId,
      wave: wave.name,
      workerKind: taskId,
      purpose: taskPurpose(taskId, request.goal),
      inputs: [request.goal, architectureRoot(request.sessionId)],
      outputs: [briefPath],
      dependsOn,
      conflictGroup: `tech-${wave.name}`,
      briefPath,
    };
  }));

  return {
    sessionId: request.sessionId,
    goal: request.goal,
    swarm: request.swarm,
    dryRun: true,
    artifactRoot: architectureRoot(request.sessionId),
    waves,
    tasks,
    outputs: {
      taskGraph: 'rd/architecture/tech-task-graph.json',
      waveManifests: waves.map((wave, index) => waveManifestPath(request.sessionId, index, wave.name)),
      reviewChecklist: 'rd/architecture/tech-review-checklist.md',
      approvalTemplate: 'rd/architecture/tech-approval-record.template.md',
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

export function getTechStatus(options: { sessionId: string; artifactWorkspacePath?: string; workspace?: WorkspaceConfig }): TechStatus {
  // Slice 2026-06-29-change-id-root-removal: change-id is metadata-only;
  // no structural validation gate fires here.
  const artifactRoot = architectureRoot(options.sessionId);

  if (!options.artifactWorkspacePath) {
    return {
      sessionId: options.sessionId,
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
      sessionId: options.sessionId,
      status: 'unavailable',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      approvalRecord: null,
      blockedReasons: ['artifact-workspace-unavailable'],
      nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS],
    };
  }

  const rootPath = architectureRootAbs(options.artifactWorkspacePath, options.sessionId);
  const approvalRecord = 'rd/architecture/tech-approval-record.md';
  if (isEscapedArchitectureRoot(rootPath, options.artifactWorkspacePath)) {
    return {
      sessionId: options.sessionId,
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
      sessionId: options.sessionId,
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
      sessionId: options.sessionId,
      status: missingArtifacts.length === TECH_REQUIRED_ARTIFACTS.length ? 'missing' : 'blocked',
      artifactRoot,
      requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
      missingArtifacts,
      approvalRecord: missingArtifacts.includes('tech-approval-record.md') ? null : approvalRecord,
      blockedReasons: ['tech-artifacts-missing'],
      nextActions: ['Run peaks tech plan --dry-run, then persist and review the required tech artifacts.'],
    };
  }


  const approvalContent = readTechArtifactFile(rootPath, 'tech-approval-record.md');
  if (approvalContent === null) {
    return {
      sessionId: options.sessionId,
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
      sessionId: options.sessionId,
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
    sessionId: options.sessionId,
    status: 'approved',
    artifactRoot,
    requiredArtifacts: [...TECH_REQUIRED_ARTIFACTS],
    missingArtifacts: [],
    approvalRecord,
    blockedReasons: [],
    nextActions: [],
  };
}
