import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { getCurrentWorkspaceConfig } from '../config/config-service.js';
import { getArtifactWorkspaceStatus, getLocalArtifactPath } from '../artifacts/workspace-service.js';

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
  commitStatus: 'committed' | 'pending' | 'rolled-back';
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
  { name: 'artifact-retention-report.md', path: ['qa', 'artifact-retention-report.md'] },
  { name: 'change-impact.json', path: ['sc', 'change-impact.json'] },
  { name: 'commit-boundary.md', path: ['checkpoints', 'commit-boundary.md'] },
  { name: 'coverage-report.md', path: ['qa', 'coverage-report.md'] }
] as const;

const RETENTION_REQUIREMENTS = [
  ['product', 'prd.md'],
  ['architecture', 'slice-spec.md'],
  ['qa', 'validation-report.md'],
  ['qa', 'coverage-report.md'],
  ['review', 'code-review.md']
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
      return basename(realpathSync(currentChangePath));
    }

    const raw = readFileSync(currentChangePath, 'utf-8').trim();
    if (!raw) return null;
    return basename(raw);
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

function getCurrentArtifactDir(workspaceRoot: string): { peaksPath: string; changeId: string | null; changeDir: string } {
  const peaksPath = getPeaksPath(workspaceRoot);
  const changeId = resolveCurrentChangeId(peaksPath);
  const effectiveChangeId = changeId ?? 'unknown-change';
  return {
    peaksPath,
    changeId,
    changeDir: resolve(peaksPath, 'changes', effectiveChangeId)
  };
}

function getRetentionChangeDir(workspaceRoot: string, sliceId: string): { peaksPath: string; changeId: string; changeDir: string } {
  const peaksPath = getPeaksPath(workspaceRoot);
  return {
    peaksPath,
    changeId: sliceId,
    changeDir: resolve(peaksPath, 'changes', sliceId)
  };
}

export function getChangeTraceabilityStatus(): ChangeTraceabilityStatus {
  const workspace = getCurrentWorkspaceConfig();
  const artifactStatus = getArtifactWorkspaceStatus(workspace?.workspaceId);

  if (!workspace) {
    return {
      changeId: null,
      hasArtifactRepo: false,
      artifactSyncStatus: 'unknown',
      localArtifactPath: '.peaks-artifacts',
      requiredArtifacts: REQUIRED_ARTIFACTS.map((artifact) => ({
        name: artifact.name,
        path: resolve('.peaks', 'changes', '<change-id>', ...artifact.path),
        exists: false
      })),
      nextActions: ['Add a workspace: peaks config workspace add --id <id> --name <name> --path <path>']
    };
  }

  const { peaksPath, changeId, changeDir } = getCurrentArtifactDir(workspace.rootPath);
  const hasArtifactRepo = Boolean(workspace.artifactRepo);
  const requiredArtifacts = REQUIRED_ARTIFACTS.map((artifact) => {
    const artifactPath = resolve(changeDir, ...artifact.path);
    return {
      name: artifact.name,
      path: resolve(peaksPath, 'changes', changeId ?? '<change-id>', ...artifact.path),
      exists: existsSync(artifactPath)
    };
  });

  const nextActions: string[] = [];
  if (!changeId) {
    nextActions.push('Set the current change in .peaks/current-change');
  }
  if (!hasArtifactRepo) {
    nextActions.push('Configure artifact repo: peaks config workspace add --id <id> --provider github --repo-owner <owner> --repo-name <name>');
    nextActions.push('Then run: peaks artifacts init --provider github --name <repo> --dry-run');
  } else if (artifactStatus.syncStatus === 'pending') {
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
  const workspace = getCurrentWorkspaceConfig();
  const artifactRepo = workspace?.artifactRepo ?? null;

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
    commitStatus: 'pending',
    rollbackPoint: null
  };
}

export function recordCommitBoundary(options: {
  sliceId: string;
  artifacts?: string[];
  codeFiles?: string[];
}): CommitBoundary {
  const workspace = getCurrentWorkspaceConfig();
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
  const workspace = getCurrentWorkspaceConfig();
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
      warnings: ['Slice id must stay inside .peaks/changes and only contain letters, numbers, dots, underscores, or hyphens']
    };
  }

  const { changeDir } = getRetentionChangeDir(workspace.rootPath, sliceId);
  const missingArtifacts = RETENTION_REQUIREMENTS
    .map(([folder, file]) => resolve(changeDir, folder, file))
    .filter((filePath) => !existsSync(filePath))
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
    'peaks sc boundary --slice-id <id>         Record commit boundary for slice',
    '',
    'Change traceability workflow integration:',
    '  1. Run peaks sc status to check current state',
    '  2. After slice completion, run peaks sc retention --slice-id <id>',
    '  3. Artifact sync is automatic when artifact repo is configured',
    '  4. Commit boundary is recorded when code is committed'
  ];
}
