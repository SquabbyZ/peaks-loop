import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkspaceConfig } from '../../../src/services/config/config-types.js';
import { TECH_REQUIRED_ARTIFACTS } from '../../../src/services/tech/tech-service.js';
import { getLocalArtifactPath } from '../../../src/services/artifacts/workspace-service.js';
import { getChangeScopeDirAbs } from '../../../src/services/artifacts/change-scope-service.js';

export function createWorkspace(rootPath = join(tmpdir(), `peaks-autonomous-root-${Date.now()}-${Math.random()}`), artifactWorkspace?: string): WorkspaceConfig {
  return {
    workspaceId: 'ws-autonomous',
    name: 'Autonomous Workspace',
    rootPath,
    installedCapabilityIds: [],
    ...(artifactWorkspace ? { artifactStorage: { mode: 'local' as const, localPath: artifactWorkspace } } : {})
  };
}

export function createWorkspaceWithArtifactWorkspace(): { workspace: WorkspaceConfig; artifactWorkspace: string } {
  const artifactWorkspace = join(tmpdir(), `peaks-autonomous-artifacts-${Date.now()}-${Math.random()}`);
  const workspace = createWorkspace(undefined, artifactWorkspace);
  const workspaceArtifactPath = getLocalArtifactPath(workspace);
  mkdirSync(join(workspaceArtifactPath, '.peaks'), { recursive: true });
  writeFileSync(join(workspaceArtifactPath, '.peaks', 'config.json'), '{}', 'utf8');
  return { workspace, artifactWorkspace: workspaceArtifactPath };
}

export function writeApprovedTechArtifacts(artifactWorkspace: string, changeId: string): void {
  // Slice 2026-06-23-audit-5th-p1: stage under the canonical change-id
  // scope dir (`.peaks/_runtime/change/<changeId>/rd/architecture/`),
  // matching where `tech-service.ts`'s `getTechStatus` reads from. The
  // old top-level `.peaks/_runtime/<changeId>/` is a SKILL.md 2.8.3 hard-ban
  // violation — see `change-scope-service.ts` for the canonical
  // location.
  const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, changeId), 'rd', 'architecture');
  mkdirSync(architectureRoot, { recursive: true });
  for (const artifact of TECH_REQUIRED_ARTIFACTS) {
    writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
  }
}

export function writeResumeArtifacts(artifactWorkspace: string, changeId: string, goal = 'Resume autonomous RD planning from artifacts'): void {
  // Slice 2026-06-23-audit-5th-p1: route under
  // `.peaks/_runtime/change/<changeId>/...` (see `getChangeScopeDirAbs`).
  const changeRoot = getChangeScopeDirAbs(artifactWorkspace, changeId);
  const artifacts = new Map([
    [join(changeRoot, 'prd', 'autonomous-goal-package.json'), JSON.stringify({ changeId, artifactType: 'goal-package', status: 'ready', goal, doneCondition: 'all acceptance criteria pass', resumeCondition: 'checkpoint verified', acceptanceCriteria: ['validation evidence exists'] })],
    [join(changeRoot, 'rd', 'swarm', 'autonomous-rd-plan.json'), JSON.stringify({ changeId, artifactType: 'rd-plan', status: 'ready', workerQueueStatus: 'ready', taskCount: 3, reducerRequired: true })],
    [join(changeRoot, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json'), JSON.stringify({ changeId, artifactType: 'checkpoint', status: 'ready', checkpointId: 'checkpoint-1', createdAt: '2026-05-17T00:00:00.000Z', workerQueueState: { pending: 0, completed: 3 }, validationRefs: ['validation-details.md'] })],
    [join(changeRoot, 'rd', 'swarm', 'evidence', 'validation-report.md'), `---\nchangeId: ${changeId}\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- validation-details.md`],
    [join(changeRoot, 'rd', 'swarm', 'evidence', 'validation-details.md'), 'Focused tests and review evidence passed'],
    [join(changeRoot, 'rd', 'swarm', 'resume-instructions.md'), `---\nchangeId: ${changeId}\nartifactType: resume-instructions\nstatus: passed\n---\nResume steps:\nPreconditions:\nBlocked actions:\nNext actions:`]
  ]);

  for (const [artifact, content] of artifacts) {
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, content, 'utf8');
  }
}
