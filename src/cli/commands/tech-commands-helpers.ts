/**
 * Support types + pure helpers extracted verbatim from `tech-commands.ts`
 * (file-size cap campaign). Mechanical move only: the change-id option/result
 * declarations, the workspace-context resolver and the artifact-path
 * flattener. `tech-commands.ts` re-exports the public types from here.
 */
import { findProjectRoot } from '../../services/config/config-safety.js';
import type { WorkspaceConfig } from '../../services/config/config-types.js';
import type {
  TechChangeArtifacts,
  TechChangeStatus
} from '../../services/tech/tech-change-id-service.js';

export interface TechChangeIdPlanOptions {
  changeId: string;
  goal: string;
  swarm?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface TechChangeIdStatusOptions {
  changeId: string;
  json?: boolean;
}

export type TechChangeIdPlanResult = {
  available: true;
  changeId: string;
  goal: string;
  swarm: boolean;
  dryRun: true;
  artifactRoot: string;
  artifacts: {
    taskGraph: string;
    waveManifests: string[];
    reviewChecklist: string;
    approvalTemplate: string;
  };
  blockedReasons: string[];
  nextActions: string[];
};

export type TechChangeIdStatusResult = TechChangeStatus;

export interface ChangeIdWorkspaceContext {
  projectRoot?: string;
  workspace?: WorkspaceConfig;
  artifactWorkspacePath?: string;
}

export function resolveChangeIdWorkspaceContext(): ChangeIdWorkspaceContext {
  try {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    return { projectRoot };
  } catch {
    return {};
  }
}

export function flattenArtifacts(value: TechChangeArtifacts): TechChangeIdPlanResult['artifacts'] {
  return {
    taskGraph: value.taskGraph.jsonSafeRelativePath,
    waveManifests: value.waveManifests.map((w) => w.jsonSafeRelativePath),
    reviewChecklist: value.reviewChecklist.jsonSafeRelativePath,
    approvalTemplate: value.approvalTemplate.jsonSafeRelativePath
  };
}
