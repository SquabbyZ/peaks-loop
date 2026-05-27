import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { isInsidePath } from '../../shared/path-utils.js';
import { getWorkspaceConfigForPath } from '../config/config-service.js';
import { getArtifactRemoteRepo, getArtifactWorkspaceStatus, getLocalArtifactPath } from '../artifacts/workspace-service.js';

export type ChangeImpact = {
  changeId: string;
  sourceArtifacts: string[];
  affectedModules: string[];
  affectedFiles: string[];
  qaImpact: {
    coverageDelta: number | null;
    testCount: number;
    status: 'passed' | 'failed' | 'unknown';
  };
  riskImpact: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
  syncPointers: {
    artifactRepo: string | null;
    lastSync: string | null;
    localPath: string;
  };
};

export type ArtifactRetentionReport = {
  sliceId: string;
  prdArtifacts: string[];
  rdArtifacts: string[];
  qaArtifacts: string[];
  coverageArtifacts: string[];
  reviewArtifacts: string[];
  codeChanges: string[];
  retentionStatus: 'local-ready' | 'pending' | 'explicitly-committed' | 'rolled-back';
  commitHash: string | null;
  rollbackPoint: string | null;
};

export type ChangeTraceabilityStatus = {
  changeId: string | null;
  hasArtifactRepo: boolean;
  artifactSyncStatus: 'synced' | 'pending' | 'out-of-sync' | 'unknown';
  localArtifactPath: string;
  requiredArtifacts: {
    name: string;
    path: string;
    exists: boolean;
  }[];
  nextActions: string[];
};

export type CommitBoundary = {
  sliceId: string;
  commitHash: string | null;
  timestamp: string;
  artifacts: string[];
  codeFiles: string[];
  syncState: 'synced' | 'pending' | 'failed';
  rollbackPoint: string | null;
};

const REQUIRED_ARTIFACTS = [
  { name: 'retention-boundary.md', path: ['sc', 'retention-boundary.md'] },
  { name: 'change-impact.json', path: ['sc', 'change-impact.json'] },
  { name: 'coverage-report.md', path: ['rd', 'coverage-report.md'] }
] as const;

const RETENTION_REQUIREMENTS = [
  ['prd', 'refactor-goal.md'],
  ['rd', 'slice-spec.md'],
  ['rd', 'coverage-report.md'],
  ['rd', 'code-review-report.md'],
  ['rd', 'security-review-report.md'],
  ['rd', 'post-check-dry-run.md'],
  ['qa', 'validation-report.md'],
  ['sc', 'change-impact.json'],
  ['sc', 'retention-boundary.md'],
  ['txt', 'context-capsule.md']
] as const;

const SLICE_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

function getPeaksPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, '.peaks');
}

function resolveCurrentChangeId(peaksPath: string): string | null {
  const currentChangePath = resolve(peaksPath, 'current-change');
  if (!existsSync(currentChangePath)) return null;

  try {
    const stat = lstatSync(currentChangePath);
    if (stat.isSymbolicLink()) {
      const targetPath = realpathSync(currentChangePath);
      if (!isInsidePath(targetPath, realpathSync(peaksPath))) return null;
      const targetId = basename(targetPath);
      return SLICE_ID_PATTERN.test(targetId) ? targetId : null;
    }

    const raw = readFileSync(currentChangePath, 'utf-8').trim();
    if (!raw || !SLICE_ID_PATTERN.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function getArtifactRepoUrl(artifactRepo: { provider: 'github' | 'gitlab'; owner: string; name: string } | undefined): string | null {
  if (!artifactRepo) return null;
  if (artifactRepo.provider === 'github') {
    return `https://github.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
  }
  return `https://gitlab.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
}

function getCurrentCommitHash(workspaceRoot?: string): string | null {
  if (!workspaceRoot) return null;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function mapSyncState(syncStatus: 'synced' | 'pending' | 'out-of-sync' | 'unknown'): 'synced' | 'pending' | 'failed' {
  if (syncStatus === 'synced') return 'synced';
  if (syncStatus === 'pending') return 'pending';
  return 'failed';
}

function getCurrentArtifactDir(artifactWorkspacePath: string): { peaksPath: string; changeId: string | null; changeDir: string } {
  const peaksPath = getPeaksPath(artifactWorkspacePath);
  const changeId = resolveCurrentChangeId(peaksPath);
  const effectiveChangeId = changeId ?? 'unknown-session';
  return {
    peaksPath,
    changeId,
    changeDir: resolve(peaksPath, effectiveChangeId)
  };
}

function getRetentionChangeDir(artifactWorkspacePath: string, sliceId: string): { peaksPath: string; changeId: string; changeDir: string } {
  const peaksPath = getPeaksPath(artifactWorkspacePath);
  return {
    peaksPath,
    changeId: sliceId,
    changeDir: resolve(peaksPath, sliceId)
  };
}

function isRetainedArtifactFile(filePath: string, artifactWorkspacePath: string, changesRoot: string, changeDir: string): boolean {
  if (!existsSync(filePath)) return false;

  try {
    const artifactWorkspaceRealPath = realpathSync(artifactWorkspacePath);
    const changesRootRealPath = realpathSync(changesRoot);
    const changeDirRealPath = realpathSync(changeDir);
    const fileRealPath = realpathSync(filePath);
    return !lstatSync(changesRoot).isSymbolicLink()
      && !lstatSync(changeDir).isSymbolicLink()
      && isInsidePath(changesRootRealPath, artifactWorkspaceRealPath)
      && isInsidePath(changeDirRealPath, changesRootRealPath)
      && isInsidePath(fileRealPath, changeDirRealPath);
  } catch {
    return false;
  }
}

export function getChangeTraceabilityStatus(): ChangeTraceabilityStatus {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  const artifactStatus = getArtifactWorkspaceStatus(workspace?.workspaceId);

  if (!workspace) {
    return {
      changeId: null,
      hasArtifactRepo: false,
      artifactSyncStatus: 'unknown',
      localArtifactPath: '.peaks-artifacts',
      requiredArtifacts: REQUIRED_ARTIFACTS.map((artifact) => ({
        name: artifact.name,
        path: resolve('.peaks', '<session-id>', ...artifact.path),
        exists: false
      })),
      nextActions: ['Add a workspace: peaks config workspace add --id <id> --name <name> --path <path>']
    };
  }

  const artifactWorkspacePath = getLocalArtifactPath(workspace);
  const { peaksPath, changeId, changeDir } = getCurrentArtifactDir(artifactWorkspacePath);
  const artifactRepo = getArtifactRemoteRepo(workspace);
  const hasArtifactRepo = Boolean(artifactRepo);
  const changesRoot = peaksPath;
  const requiredArtifacts = REQUIRED_ARTIFACTS.map((artifact) => {
    const artifactPath = resolve(changeDir, ...artifact.path);
    return {
      name: artifact.name,
      path: resolve(peaksPath, changeId ?? '<session-id>', ...artifact.path),
      exists: isRetainedArtifactFile(artifactPath, artifactWorkspacePath, changesRoot, changeDir)
    };
  });

  const nextActions: string[] = [];
  if (!changeId) {
    nextActions.push('Set the current change in .peaks/current-change');
  }
  if (hasArtifactRepo && artifactStatus.syncStatus === 'pending') {
    nextActions.push(`Run peaks artifacts sync --workspace ${workspace.workspaceId} --dry-run`);
  }

  return {
    changeId,
    hasArtifactRepo,
    artifactSyncStatus: artifactStatus.syncStatus,
    localArtifactPath: getLocalArtifactPath(workspace),
    requiredArtifacts,
    nextActions
  };
}

export function createChangeImpact(options: {
  changeId: string;
  sourceArtifacts?: string[];
  affectedModules?: string[];
  affectedFiles?: string[];
}): ChangeImpact {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  const artifactRepo = workspace ? getArtifactRemoteRepo(workspace) : null;

  return {
    changeId: options.changeId,
    sourceArtifacts: options.sourceArtifacts ?? [],
    affectedModules: options.affectedModules ?? [],
    affectedFiles: options.affectedFiles ?? [],
    qaImpact: {
      coverageDelta: null,
      testCount: 0,
      status: 'unknown'
    },
    riskImpact: {
      level: 'medium',
      factors: ['Manual review required', 'No automated gates detected']
    },
    syncPointers: {
      artifactRepo: getArtifactRepoUrl(artifactRepo ?? undefined),
      lastSync: null,
      localPath: workspace ? getLocalArtifactPath(workspace) : '.peaks-artifacts'
    }
  };
}

export function createArtifactRetentionReport(options: {
  sliceId: string;
  prdArtifacts?: string[];
  rdArtifacts?: string[];
  qaArtifacts?: string[];
  coverageArtifacts?: string[];
  reviewArtifacts?: string[];
  codeChanges?: string[];
}): ArtifactRetentionReport {
  return {
    sliceId: options.sliceId,
    prdArtifacts: options.prdArtifacts ?? [],
    rdArtifacts: options.rdArtifacts ?? [],
    qaArtifacts: options.qaArtifacts ?? [],
    coverageArtifacts: options.coverageArtifacts ?? [],
    reviewArtifacts: options.reviewArtifacts ?? [],
    codeChanges: options.codeChanges ?? [],
    retentionStatus: 'pending',
    commitHash: null,
    rollbackPoint: null
  };
}

export function recordCommitBoundary(options: {
  sliceId: string;
  artifacts?: string[];
  codeFiles?: string[];
}): CommitBoundary {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  const artifactStatus = getArtifactWorkspaceStatus(workspace?.workspaceId);
  const commitHash = getCurrentCommitHash(workspace?.rootPath);

  return {
    sliceId: options.sliceId,
    commitHash,
    timestamp: new Date().toISOString(),
    artifacts: options.artifacts ?? [],
    codeFiles: options.codeFiles ?? [],
    syncState: mapSyncState(artifactStatus.syncStatus),
    rollbackPoint: commitHash
  };
}

export function validateArtifactRetention(sliceId: string): {
  valid: boolean;
  missingArtifacts: string[];
  warnings: string[];
} {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  if (!workspace) {
    return {
      valid: false,
      missingArtifacts: ['No workspace configured'],
      warnings: ['Cannot validate without a configured workspace']
    };
  }

  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      valid: false,
      missingArtifacts: ['Invalid slice id'],
      warnings: ['Slice id must stay inside .peaks/<session-id> and only contain letters, numbers, dots, underscores, or hyphens']
    };
  }

  const artifactWorkspacePath = getLocalArtifactPath(workspace);
  const { peaksPath, changeDir } = getRetentionChangeDir(artifactWorkspacePath, sliceId);
  const changesRoot = peaksPath;
  const missingArtifacts = RETENTION_REQUIREMENTS
    .map(([folder, file]) => resolve(changeDir, folder, file))
    .filter((filePath) => !isRetainedArtifactFile(filePath, artifactWorkspacePath, changesRoot, changeDir))
    .map((filePath) => relative(changeDir, filePath).replace(/\\/g, '/'));

  return {
    valid: missingArtifacts.length === 0,
    missingArtifacts,
    warnings: missingArtifacts.length === 0 ? [] : ['Some required artifact files are missing']
  };
}

export function getScHelpText(): string[] {
  return [
    'peaks sc status                          Show change traceability status',
    'peaks sc impact --change-id <id>         Generate change impact artifact',
    'peaks sc retention --slice-id <id>        Create artifact retention report',
    'peaks sc validate --slice-id <id>         Validate artifact retention',
    'peaks sc boundary --slice-id <id>         Record retention boundary for slice',
    '',
    'Change traceability workflow integration:',
    '  1. Run peaks sc status to check current state',
    '  2. After slice completion, run peaks sc retention --slice-id <id>',
    '  3. Keep artifacts local in .peaks/<session-id>/ by default',
    '  4. Commit or sync artifacts only after explicit authorization'
  ];
}
