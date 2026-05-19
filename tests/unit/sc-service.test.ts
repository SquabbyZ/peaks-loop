import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';
import { pathsEqual } from '../../src/shared/path-utils.js';
import { createDirectoryLinkSync } from '../../src/shared/fs-utils.js';

let currentWorkspace: WorkspaceConfig | null = null;
let artifactSyncStatus: 'synced' | 'pending' | 'out-of-sync' | 'unknown' = 'pending';
let commitHash = 'abc123def456';
let gitCwd: string | undefined;
let throwGitRevParse = false;

vi.mock('../../src/services/config/config-service.js', () => ({
  getCurrentWorkspaceConfig: () => currentWorkspace,
  readConfig: () => ({ workspaces: currentWorkspace ? [currentWorkspace] : [] })
}));

function resolveArtifactRepo(workspace: WorkspaceConfig | null): WorkspaceConfig['artifactRepo'] | null {
  if (!workspace) return null;
  if (workspace.artifactStorage?.mode === 'local-with-remote-sync') return workspace.artifactStorage.remote;
  if (workspace.artifactStorage?.mode === 'local') return null;
  return workspace.artifactRepo ?? null;
}

vi.mock('../../src/services/artifacts/workspace-service.js', () => ({
  getArtifactRemoteRepo: (workspace: WorkspaceConfig) => resolveArtifactRepo(workspace),
  getLocalArtifactPath: (workspace: WorkspaceConfig) => join(dirname(workspace.rootPath), `${basename(workspace.rootPath)}.peaks-artifacts`),
  getArtifactWorkspaceStatus: () => {
    const artifactRepo = resolveArtifactRepo(currentWorkspace);
    return {
      workspaceId: currentWorkspace?.workspaceId ?? 'unknown',
      localPath: currentWorkspace ? join(dirname(currentWorkspace.rootPath), `${basename(currentWorkspace.rootPath)}.peaks-artifacts`) : '.peaks-artifacts',
      configured: Boolean(currentWorkspace),
      syncStatus: artifactSyncStatus,
      lastSync: null,
      hasLocalChanges: false,
      artifactRepo,
      nextActions: []
    };
  }
}));

vi.mock('node:child_process', () => ({
  exec: () => undefined,
  execFileSync: (command: string, args: string[], options?: { cwd?: string }) => {
    if (command === 'git' && args[0] === 'rev-parse') {
      gitCwd = options?.cwd;
      if (throwGitRevParse) throw new Error('not a git repo');
      return `${commitHash}\n`;
    }
    if (command === 'git' && args[0] === '--version') return 'git version 2.0.0';
    throw new Error('unexpected command');
  }
}));

const {
  createArtifactRetentionReport,
  createChangeImpact,
  getChangeTraceabilityStatus,
  getScHelpText,
  recordCommitBoundary,
  validateArtifactRetention
} = await import('../../src/services/sc/sc-service.js');

function createWorkspace(provider?: WorkspaceConfig['artifactRepo']): WorkspaceConfig {
  const rootPath = join(tmpdir(), `peaks-sc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(rootPath, { recursive: true });
  const workspace = {
    workspaceId: 'ws-sc',
    name: 'SC Workspace',
    rootPath,
    installedCapabilityIds: []
  };

  return provider ? { ...workspace, artifactRepo: provider } : workspace;
}

function createWorkspaceWithRepo(provider: WorkspaceConfig['artifactRepo'] = { provider: 'github', owner: 'acme', name: 'artifact-repo' }): WorkspaceConfig {
  return createWorkspace(provider);
}

function createWorkspaceWithArtifactStorage(artifactStorage: NonNullable<WorkspaceConfig['artifactStorage']>, legacyRepo?: WorkspaceConfig['artifactRepo']): WorkspaceConfig {
  return {
    ...createWorkspace(legacyRepo),
    artifactStorage
  };
}

function getTestArtifactRoot(workspace: WorkspaceConfig): string {
  return join(dirname(workspace.rootPath), `${basename(workspace.rootPath)}.peaks-artifacts`);
}

function prepareChangeDir(workspace: WorkspaceConfig, changeId: string): string {
  const changeDir = join(getTestArtifactRoot(workspace), '.peaks', 'changes', changeId);
  mkdirSync(join(changeDir, 'product'), { recursive: true });
  mkdirSync(join(changeDir, 'architecture'), { recursive: true });
  mkdirSync(join(changeDir, 'qa'), { recursive: true });
  mkdirSync(join(changeDir, 'review'), { recursive: true });
  mkdirSync(join(changeDir, 'sc'), { recursive: true });
  mkdirSync(join(changeDir, 'checkpoints'), { recursive: true });
  return changeDir;
}

describe('peaks-sc service', () => {
  beforeEach(() => {
    currentWorkspace = createWorkspaceWithRepo();
    artifactSyncStatus = 'pending';
    commitHash = 'abc123def456';
    gitCwd = undefined;
    throwGitRevParse = false;
  });

  test('describes traceability status when no workspace is configured', () => {
    currentWorkspace = null;

    const status = getChangeTraceabilityStatus();

    expect(status.changeId).toBeNull();
    expect(status.hasArtifactRepo).toBe(false);
    expect(status.artifactSyncStatus).toBe('unknown');
    expect(status.localArtifactPath).toBe('.peaks-artifacts');
    expect(status.requiredArtifacts.every((artifact) => artifact.exists)).toBe(false);
    expect(status.nextActions[0]).toContain('Add a workspace');
  });

  test('reports change impact defaults when no workspace is configured', () => {
    currentWorkspace = null;

    const impact = createChangeImpact({ changeId: 'change-1' });

    expect(impact.syncPointers.artifactRepo).toBeNull();
    expect(impact.syncPointers.localPath).toBe('.peaks-artifacts');
  });

  test('describes retention validation failure when no workspace is configured', () => {
    currentWorkspace = null;

    const result = validateArtifactRetention('slice-1');

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toContain('No workspace configured');
  });

  test.each(['../outside', '.', '..'])('rejects artifact retention validation outside the changes directory: %s', (sliceId) => {
    const result = validateArtifactRetention(sliceId);

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toContain('Invalid slice id');
    expect(result.warnings).toContain('Slice id must stay inside .peaks/changes and only contain letters, numbers, dots, underscores, or hyphens');
  });

  test('renders SC help text', () => {
    const help = getScHelpText();

    expect(help[0]).toContain('peaks sc status');
    expect(help.join('\n')).toContain('peaks sc boundary');
  });

  test('describes current change and required artifacts when current-change file exists', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const changeDir = prepareChangeDir(workspace, '2026-05-15-test-change');
    writeFileSync(join(getTestArtifactRoot(workspace), '.peaks', 'current-change'), '2026-05-15-test-change', 'utf-8');
    writeFileSync(join(changeDir, 'qa', 'artifact-retention-report.md'), 'retention', 'utf-8');
    writeFileSync(join(changeDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(changeDir, 'checkpoints', 'commit-boundary.md'), 'boundary', 'utf-8');
    writeFileSync(join(changeDir, 'qa', 'coverage-report.md'), 'coverage', 'utf-8');

    const status = getChangeTraceabilityStatus();

    expect(status.changeId).toBe('2026-05-15-test-change');
    expect(status.requiredArtifacts.every((artifact) => artifact.exists)).toBe(true);
    expect(status.nextActions).toContain(`Run peaks artifacts sync --workspace ${workspace.workspaceId} --dry-run`);
  });

  test('describes current change when current-change is missing and artifact repo is configured', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const status = getChangeTraceabilityStatus();

    expect(status.changeId).toBeNull();
    expect(status.hasArtifactRepo).toBe(true);
    expect(status.nextActions[0]).toBe('Set the current change in .peaks/current-change');
    expect(status.requiredArtifacts[0]?.path).toContain('<change-id>');
  });

  test('resolves current change from directory link target', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const peaksPath = join(artifactRoot, '.peaks');
    const changeId = '2026-05-15-symlink-change';

    const changeDir = join(artifactRoot, 'changes', changeId);
    mkdirSync(peaksPath, { recursive: true });
    mkdirSync(changeDir, { recursive: true });
    mkdirSync(join(changeDir, 'product'), { recursive: true });
    mkdirSync(join(changeDir, 'architecture'), { recursive: true });
    mkdirSync(join(changeDir, 'qa'), { recursive: true });
    mkdirSync(join(changeDir, 'review'), { recursive: true });
    mkdirSync(join(changeDir, 'sc'), { recursive: true });
    mkdirSync(join(changeDir, 'checkpoints'), { recursive: true });

    createDirectoryLinkSync(changeDir, join(peaksPath, 'current-change'));

    expect(getChangeTraceabilityStatus().changeId).toBe(changeId);
  });

  test('returns null when current-change directory link target is removed', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const peaksPath = join(artifactRoot, '.peaks');
    const changeId = '2026-05-15-broken-change';
    const changeDir = join(artifactRoot, 'changes', changeId);

    mkdirSync(peaksPath, { recursive: true });
    mkdirSync(changeDir, { recursive: true });
    createDirectoryLinkSync(changeDir, join(peaksPath, 'current-change'));
    rmSync(changeDir, { recursive: true, force: true });

    expect(getChangeTraceabilityStatus().changeId).toBeNull();
  });

  test('ignores empty or unreadable current-change values', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    mkdirSync(join(getTestArtifactRoot(workspace), '.peaks'), { recursive: true });
    writeFileSync(join(getTestArtifactRoot(workspace), '.peaks', 'current-change'), '   ', 'utf-8');

    expect(getChangeTraceabilityStatus().changeId).toBeNull();
  });

  test('reports local-only artifact storage without requiring artifact repo configuration', () => {
    currentWorkspace = createWorkspaceWithArtifactStorage({ mode: 'local' });

    const status = getChangeTraceabilityStatus();

    expect(status.hasArtifactRepo).toBe(false);
    expect(status.nextActions).not.toContain('Configure artifact repo: peaks config workspace add --id <id> --provider github --repo-owner <owner> --repo-name <name>');
    expect(status.nextActions[0]).toBe('Set the current change in .peaks/current-change');
  });

  test('uses artifactStorage remote sync for traceability without legacy artifactRepo', () => {
    currentWorkspace = createWorkspaceWithArtifactStorage({ mode: 'local-with-remote-sync', remote: { provider: 'gitlab', owner: 'acme', name: 'storage-artifacts' } });

    const status = getChangeTraceabilityStatus();
    const impact = createChangeImpact({ changeId: 'change-remote-storage' });

    expect(status.hasArtifactRepo).toBe(true);
    expect(status.nextActions[0]).toBe('Set the current change in .peaks/current-change');
    expect(impact.syncPointers.artifactRepo).toBe('https://gitlab.com/acme/storage-artifacts.git');
  });

  test('reads change traceability and retention artifacts from the artifact workspace path', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const changeId = '2026-05-15-artifact-workspace-change';
    const retentionSliceId = 'slice-artifact-workspace';
    const changeDir = join(artifactRoot, '.peaks', 'changes', changeId);
    const retentionDir = join(artifactRoot, '.peaks', 'changes', retentionSliceId);

    mkdirSync(join(workspace.rootPath, '.peaks'), { recursive: true });
    writeFileSync(join(workspace.rootPath, '.peaks', 'current-change'), 'legacy-root-change', 'utf-8');
    mkdirSync(join(artifactRoot, '.peaks'), { recursive: true });
    writeFileSync(join(artifactRoot, '.peaks', 'current-change'), changeId, 'utf-8');

    for (const folder of ['product', 'architecture', 'qa', 'review', 'sc', 'checkpoints']) {
      mkdirSync(join(changeDir, folder), { recursive: true });
      mkdirSync(join(retentionDir, folder), { recursive: true });
    }

    writeFileSync(join(changeDir, 'qa', 'artifact-retention-report.md'), 'retention', 'utf-8');
    writeFileSync(join(changeDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(changeDir, 'checkpoints', 'commit-boundary.md'), 'boundary', 'utf-8');
    writeFileSync(join(changeDir, 'qa', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(retentionDir, 'product', 'prd.md'), 'prd', 'utf-8');
    writeFileSync(join(retentionDir, 'architecture', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(retentionDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(retentionDir, 'qa', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(retentionDir, 'review', 'code-review.md'), 'review', 'utf-8');

    const status = getChangeTraceabilityStatus();
    const retention = validateArtifactRetention(retentionSliceId);

    expect(status.changeId).toBe(changeId);
    expect(status.requiredArtifacts.every((artifact) => artifact.exists)).toBe(true);
    expect(status.requiredArtifacts.every((artifact) => artifact.path.includes(`${basename(workspace.rootPath)}.peaks-artifacts`))).toBe(true);
    expect(pathsEqual(status.localArtifactPath, artifactRoot)).toBe(true);
    expect(retention.valid).toBe(true);
    expect(retention.missingArtifacts).toEqual([]);
  });

  test('validates artifact retention by checking the requested slice directory', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const currentChangeDir = prepareChangeDir(workspace, '2026-05-15-current');
    const requestedSliceDir = prepareChangeDir(workspace, 'slice-1');
    writeFileSync(join(getTestArtifactRoot(workspace), '.peaks', 'current-change'), '2026-05-15-current', 'utf-8');
    writeFileSync(join(currentChangeDir, 'product', 'prd.md'), 'prd', 'utf-8');
    writeFileSync(join(currentChangeDir, 'architecture', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(currentChangeDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(currentChangeDir, 'qa', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(currentChangeDir, 'review', 'code-review.md'), 'review', 'utf-8');

    const missing = validateArtifactRetention('slice-1');
    expect(missing.valid).toBe(false);
    expect(missing.missingArtifacts).toContain('product/prd.md');
    expect(missing.missingArtifacts.every((artifactPath) => !artifactPath.includes(workspace.rootPath))).toBe(true);

    writeFileSync(join(requestedSliceDir, 'product', 'prd.md'), 'prd', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'architecture', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'qa', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'review', 'code-review.md'), 'review', 'utf-8');

    expect(validateArtifactRetention('slice-1').valid).toBe(true);
  });

  test('rejects retention artifacts whose changes root real path escapes the artifact workspace', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const sliceId = 'slice-changes-root-escape';
    const outsideRoot = join(tmpdir(), `peaks-sc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const outsideSliceDir = join(outsideRoot, sliceId);
    mkdirSync(join(artifactRoot, '.peaks'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'product'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'architecture'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'qa'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'review'), { recursive: true });

    writeFileSync(join(outsideSliceDir, 'product', 'prd.md'), 'outside prd', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'architecture', 'slice-spec.md'), 'outside rd', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'qa', 'validation-report.md'), 'outside qa', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'qa', 'coverage-report.md'), 'outside coverage', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'review', 'code-review.md'), 'outside review', 'utf-8');
    symlinkSync(outsideRoot, join(artifactRoot, '.peaks', 'changes'), 'junction');

    const result = validateArtifactRetention(sliceId);

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toEqual([
      'product/prd.md',
      'architecture/slice-spec.md',
      'qa/validation-report.md',
      'qa/coverage-report.md',
      'review/code-review.md'
    ]);
  });

  test('rejects retention artifacts whose slice directory real path escapes the artifact workspace', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const sliceId = 'slice-dir-escape';
    const sliceDir = prepareChangeDir(workspace, sliceId);
    const outsideDir = join(tmpdir(), `peaks-sc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(outsideDir, 'product'), { recursive: true });
    mkdirSync(join(outsideDir, 'architecture'), { recursive: true });
    mkdirSync(join(outsideDir, 'qa'), { recursive: true });
    mkdirSync(join(outsideDir, 'review'), { recursive: true });

    writeFileSync(join(outsideDir, 'product', 'prd.md'), 'outside prd', 'utf-8');
    writeFileSync(join(outsideDir, 'architecture', 'slice-spec.md'), 'outside rd', 'utf-8');
    writeFileSync(join(outsideDir, 'qa', 'validation-report.md'), 'outside qa', 'utf-8');
    writeFileSync(join(outsideDir, 'qa', 'coverage-report.md'), 'outside coverage', 'utf-8');
    writeFileSync(join(outsideDir, 'review', 'code-review.md'), 'outside review', 'utf-8');
    rmSync(sliceDir, { recursive: true, force: true });
    symlinkSync(outsideDir, sliceDir, 'junction');

    const result = validateArtifactRetention(sliceId);

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toEqual([
      'product/prd.md',
      'architecture/slice-spec.md',
      'qa/validation-report.md',
      'qa/coverage-report.md',
      'review/code-review.md'
    ]);
  });

  test('rejects retention artifacts whose real paths escape the artifact workspace', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const sliceDir = prepareChangeDir(workspace, 'slice-symlink-escape');
    const outsideDir = join(tmpdir(), `peaks-sc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(outsideDir, { recursive: true });

    writeFileSync(join(outsideDir, 'prd.md'), 'outside prd', 'utf-8');
    rmSync(join(sliceDir, 'product'), { recursive: true, force: true });
    symlinkSync(outsideDir, join(sliceDir, 'product'), 'junction');
    writeFileSync(join(sliceDir, 'architecture', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(sliceDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(sliceDir, 'qa', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(sliceDir, 'review', 'code-review.md'), 'review', 'utf-8');

    const result = validateArtifactRetention('slice-symlink-escape');

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toContain('product/prd.md');
  });

  test('creates artifact retention reports with defaults', () => {
    const report = createArtifactRetentionReport({ sliceId: 'slice-1' });

    expect(report.sliceId).toBe('slice-1');
    expect(report.commitStatus).toBe('pending');
    expect(report.rollbackPoint).toBeNull();
  });

  test('populates change impact sync pointers for GitHub and GitLab repos', () => {
    const githubImpact = createChangeImpact({ changeId: 'change-1' });
    expect(githubImpact.syncPointers.artifactRepo).toBe('https://github.com/acme/artifact-repo.git');
    const workspaceRoot = (currentWorkspace as WorkspaceConfig).rootPath;
    expect(pathsEqual(githubImpact.syncPointers.localPath, join(dirname(workspaceRoot), `${basename(workspaceRoot)}.peaks-artifacts`))).toBe(true);

    currentWorkspace = createWorkspace({ provider: 'gitlab', owner: 'acme', name: 'artifact-repo' });
    const gitlabImpact = createChangeImpact({ changeId: 'change-2' });
    expect(gitlabImpact.syncPointers.artifactRepo).toBe('https://gitlab.com/acme/artifact-repo.git');
  });

  test('records commit boundary with current git commit as rollback point', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const pendingBoundary = recordCommitBoundary({ sliceId: 'slice-1', artifacts: ['qa/report.md'], codeFiles: ['src/a.ts'] });
    expect(pendingBoundary.commitHash).toBe('abc123def456');
    expect(pendingBoundary.rollbackPoint).toBe('abc123def456');
    expect(pendingBoundary.syncState).toBe('pending');
    expect(pathsEqual(gitCwd ?? '', workspace.rootPath)).toBe(true);

    artifactSyncStatus = 'synced';
    expect(recordCommitBoundary({ sliceId: 'slice-2' }).syncState).toBe('synced');

    artifactSyncStatus = 'out-of-sync';
    expect(recordCommitBoundary({ sliceId: 'slice-3' }).syncState).toBe('failed');
  });

  test('returns null commit data when workspace or git commit is unavailable', () => {
    currentWorkspace = null;
    const noWorkspaceBoundary = recordCommitBoundary({ sliceId: 'slice-no-workspace' });
    expect(noWorkspaceBoundary.commitHash).toBeNull();
    expect(noWorkspaceBoundary.rollbackPoint).toBeNull();

    currentWorkspace = createWorkspaceWithRepo();
    throwGitRevParse = true;
    const noGitBoundary = recordCommitBoundary({ sliceId: 'slice-no-git' });
    expect(noGitBoundary.commitHash).toBeNull();
    expect(noGitBoundary.rollbackPoint).toBeNull();
  });
});