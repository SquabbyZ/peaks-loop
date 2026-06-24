import { existsSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
  getWorkspaceConfigForPath: (_path?: string) => currentWorkspace,
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
  const changeDir = join(getTestArtifactRoot(workspace), '.peaks', changeId);
  mkdirSync(join(changeDir, 'prd'), { recursive: true });
  mkdirSync(join(changeDir, 'rd'), { recursive: true });
  mkdirSync(join(changeDir, 'qa'), { recursive: true });
  mkdirSync(join(changeDir, 'sc'), { recursive: true });
  mkdirSync(join(changeDir, 'txt'), { recursive: true });
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

  test.each(['../outside', '.', '..'])('rejects artifact retention validation outside the session directory: %s', (sliceId) => {
    const result = validateArtifactRetention(sliceId);

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toContain('Invalid slice id');
    expect(result.warnings).toContain('Slice id must stay inside .peaks/_runtime/<session-id> and only contain letters, numbers, dots, underscores, or hyphens');
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
    writeFileSync(join(changeDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(changeDir, 'sc', 'retention-boundary.md'), 'boundary', 'utf-8');
    writeFileSync(join(changeDir, 'rd', 'coverage-report.md'), 'coverage', 'utf-8');

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
    expect(status.requiredArtifacts[0]?.path).toContain('<session-id>');
  });

  test('resolves current change from directory link target', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const peaksPath = join(artifactRoot, '.peaks');
    const changeId = '2026-05-15-symlink-change';

    const changeDir = join(artifactRoot, '.peaks', changeId);
    mkdirSync(peaksPath, { recursive: true });
    mkdirSync(changeDir, { recursive: true });
    mkdirSync(join(changeDir, 'prd'), { recursive: true });
    mkdirSync(join(changeDir, 'rd'), { recursive: true });
    mkdirSync(join(changeDir, 'qa'), { recursive: true });
    mkdirSync(join(changeDir, 'sc'), { recursive: true });

    createDirectoryLinkSync(changeDir, join(peaksPath, 'current-change'));

    expect(getChangeTraceabilityStatus().changeId).toBe(changeId);
  });

  test('returns null when current-change directory link target is removed', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const peaksPath = join(artifactRoot, '.peaks');
    const changeId = '2026-05-15-broken-change';
    const changeDir = join(artifactRoot, '.peaks', changeId);

    mkdirSync(peaksPath, { recursive: true });
    mkdirSync(changeDir, { recursive: true });
    createDirectoryLinkSync(changeDir, join(peaksPath, 'current-change'));
    rmSync(changeDir, { recursive: true, force: true });

    expect(getChangeTraceabilityStatus().changeId).toBeNull();
  });

  test('returns null when current-change directory link target escapes .peaks', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const peaksPath = join(artifactRoot, '.peaks');
    const outsideChangeDir = join(tmpdir(), `peaks-sc-current-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    mkdirSync(peaksPath, { recursive: true });
    mkdirSync(outsideChangeDir, { recursive: true });
    createDirectoryLinkSync(outsideChangeDir, join(peaksPath, 'current-change'));

    expect(getChangeTraceabilityStatus().changeId).toBeNull();
  });

  test('returns null when current-change directory link target has an unsafe basename', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const peaksPath = join(artifactRoot, '.peaks');
    const unsafeChangeDir = join(peaksPath, 'bad change');

    mkdirSync(peaksPath, { recursive: true });
    mkdirSync(unsafeChangeDir, { recursive: true });
    createDirectoryLinkSync(unsafeChangeDir, join(peaksPath, 'current-change'));

    expect(getChangeTraceabilityStatus().changeId).toBeNull();
  });

  test('ignores empty or unsafe current-change values', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const peaksPath = join(getTestArtifactRoot(workspace), '.peaks');
    mkdirSync(peaksPath, { recursive: true });

    for (const value of ['   ', '../outside', '/tmp/change', 'foo/bar', 'foo\\bar']) {
      writeFileSync(join(peaksPath, 'current-change'), value, 'utf-8');
      expect(getChangeTraceabilityStatus().changeId).toBeNull();
    }
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
    const changeDir = join(artifactRoot, '.peaks', changeId);
    const retentionDir = join(artifactRoot, '.peaks', retentionSliceId);

    mkdirSync(join(workspace.rootPath, '.peaks'), { recursive: true });
    writeFileSync(join(workspace.rootPath, '.peaks', 'current-change'), 'legacy-root-change', 'utf-8');
    mkdirSync(join(artifactRoot, '.peaks'), { recursive: true });
    writeFileSync(join(artifactRoot, '.peaks', 'current-change'), changeId, 'utf-8');

    for (const folder of ['prd', 'rd', 'qa', 'sc', 'txt']) {
      mkdirSync(join(changeDir, folder), { recursive: true });
      mkdirSync(join(retentionDir, folder), { recursive: true });
    }

    writeFileSync(join(changeDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(changeDir, 'sc', 'retention-boundary.md'), 'boundary', 'utf-8');
    writeFileSync(join(changeDir, 'rd', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(retentionDir, 'prd', 'refactor-goal.md'), 'prd', 'utf-8');
    writeFileSync(join(retentionDir, 'rd', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(retentionDir, 'rd', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(retentionDir, 'rd', 'code-review-report.md'), 'review', 'utf-8');
    writeFileSync(join(retentionDir, 'rd', 'security-review-report.md'), 'security', 'utf-8');
    writeFileSync(join(retentionDir, 'rd', 'post-check-dry-run.md'), 'dry-run', 'utf-8');
    writeFileSync(join(retentionDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(retentionDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(retentionDir, 'sc', 'retention-boundary.md'), 'boundary', 'utf-8');
    writeFileSync(join(retentionDir, 'txt', 'context-capsule.md'), 'txt', 'utf-8');

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
    writeFileSync(join(currentChangeDir, 'prd', 'refactor-goal.md'), 'prd', 'utf-8');
    writeFileSync(join(currentChangeDir, 'rd', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(currentChangeDir, 'rd', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(currentChangeDir, 'rd', 'code-review-report.md'), 'review', 'utf-8');
    writeFileSync(join(currentChangeDir, 'rd', 'security-review-report.md'), 'security', 'utf-8');
    writeFileSync(join(currentChangeDir, 'rd', 'post-check-dry-run.md'), 'dry-run', 'utf-8');
    writeFileSync(join(currentChangeDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');

    const missing = validateArtifactRetention('slice-1');
    expect(missing.valid).toBe(false);
    expect(missing.missingArtifacts).toContain('prd/refactor-goal.md');
    expect(missing.missingArtifacts.every((artifactPath) => !artifactPath.includes(workspace.rootPath))).toBe(true);

    writeFileSync(join(requestedSliceDir, 'prd', 'refactor-goal.md'), 'prd', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'rd', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'rd', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'rd', 'code-review-report.md'), 'review', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'rd', 'security-review-report.md'), 'security', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'rd', 'post-check-dry-run.md'), 'dry-run', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(requestedSliceDir, 'sc', 'retention-boundary.md'), 'boundary', 'utf-8');

    const missingTxt = validateArtifactRetention('slice-1');
    expect(missingTxt.valid).toBe(false);
    expect(missingTxt.missingArtifacts).toContain('txt/context-capsule.md');

    writeFileSync(join(requestedSliceDir, 'txt', 'context-capsule.md'), 'txt', 'utf-8');
    expect(validateArtifactRetention('slice-1').valid).toBe(true);
  });

  test('rejects retention artifacts whose changes root real path escapes the artifact workspace', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const artifactRoot = getTestArtifactRoot(workspace);
    const sliceId = 'slice-changes-root-escape';
    const outsideRoot = join(tmpdir(), `peaks-sc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const outsideSliceDir = join(outsideRoot, sliceId);
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(join(outsideSliceDir, 'prd'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'rd'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'qa'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'rd'), { recursive: true });
    mkdirSync(join(outsideSliceDir, 'txt'), { recursive: true });

    writeFileSync(join(outsideSliceDir, 'prd', 'refactor-goal.md'), 'outside prd', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'rd', 'slice-spec.md'), 'outside rd', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'qa', 'validation-report.md'), 'outside qa', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'rd', 'coverage-report.md'), 'outside coverage', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'rd', 'code-review-report.md'), 'outside review', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'rd', 'security-review-report.md'), 'outside security', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'rd', 'post-check-dry-run.md'), 'outside dry-run', 'utf-8');
    writeFileSync(join(outsideSliceDir, 'txt', 'context-capsule.md'), 'outside txt', 'utf-8');
    symlinkSync(outsideRoot, join(artifactRoot, '.peaks'), 'junction');

    const result = validateArtifactRetention(sliceId);

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toEqual([
      'prd/refactor-goal.md',
      'rd/slice-spec.md',
      'rd/coverage-report.md',
      'rd/code-review-report.md',
      'rd/security-review-report.md',
      'rd/post-check-dry-run.md',
      'qa/validation-report.md',
      'sc/change-impact.json',
      'sc/retention-boundary.md',
      'txt/context-capsule.md'
    ]);
  });

  test('rejects retention artifacts whose slice directory real path escapes the artifact workspace', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const sliceId = 'slice-dir-escape';
    const sliceDir = prepareChangeDir(workspace, sliceId);
    const outsideDir = join(tmpdir(), `peaks-sc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(outsideDir, 'prd'), { recursive: true });
    mkdirSync(join(outsideDir, 'rd'), { recursive: true });
    mkdirSync(join(outsideDir, 'qa'), { recursive: true });
    mkdirSync(join(outsideDir, 'rd'), { recursive: true });
    mkdirSync(join(outsideDir, 'txt'), { recursive: true });

    writeFileSync(join(outsideDir, 'prd', 'refactor-goal.md'), 'outside prd', 'utf-8');
    writeFileSync(join(outsideDir, 'rd', 'slice-spec.md'), 'outside rd', 'utf-8');
    writeFileSync(join(outsideDir, 'qa', 'validation-report.md'), 'outside qa', 'utf-8');
    writeFileSync(join(outsideDir, 'rd', 'coverage-report.md'), 'outside coverage', 'utf-8');
    writeFileSync(join(outsideDir, 'rd', 'code-review-report.md'), 'outside review', 'utf-8');
    writeFileSync(join(outsideDir, 'rd', 'security-review-report.md'), 'outside security', 'utf-8');
    writeFileSync(join(outsideDir, 'rd', 'post-check-dry-run.md'), 'outside dry-run', 'utf-8');
    writeFileSync(join(outsideDir, 'txt', 'context-capsule.md'), 'outside txt', 'utf-8');
    rmSync(sliceDir, { recursive: true, force: true });
    symlinkSync(outsideDir, sliceDir, 'junction');

    const result = validateArtifactRetention(sliceId);

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toEqual([
      'prd/refactor-goal.md',
      'rd/slice-spec.md',
      'rd/coverage-report.md',
      'rd/code-review-report.md',
      'rd/security-review-report.md',
      'rd/post-check-dry-run.md',
      'qa/validation-report.md',
      'sc/change-impact.json',
      'sc/retention-boundary.md',
      'txt/context-capsule.md'
    ]);
  });

  test('rejects retention artifacts whose real paths escape the artifact workspace', () => {
    const workspace = currentWorkspace as WorkspaceConfig;
    const sliceDir = prepareChangeDir(workspace, 'slice-symlink-escape');
    const outsideDir = join(tmpdir(), `peaks-sc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(outsideDir, { recursive: true });

    writeFileSync(join(outsideDir, 'refactor-goal.md'), 'outside prd', 'utf-8');
    rmSync(join(sliceDir, 'prd'), { recursive: true, force: true });
    symlinkSync(outsideDir, join(sliceDir, 'prd'), 'junction');
    writeFileSync(join(sliceDir, 'rd', 'slice-spec.md'), 'rd', 'utf-8');
    writeFileSync(join(sliceDir, 'qa', 'validation-report.md'), 'qa', 'utf-8');
    writeFileSync(join(sliceDir, 'rd', 'coverage-report.md'), 'coverage', 'utf-8');
    writeFileSync(join(sliceDir, 'rd', 'code-review-report.md'), 'review', 'utf-8');
    writeFileSync(join(sliceDir, 'rd', 'security-review-report.md'), 'security', 'utf-8');
    writeFileSync(join(sliceDir, 'rd', 'post-check-dry-run.md'), 'dry-run', 'utf-8');
    writeFileSync(join(sliceDir, 'sc', 'change-impact.json'), '{}', 'utf-8');
    writeFileSync(join(sliceDir, 'sc', 'retention-boundary.md'), 'boundary', 'utf-8');
    writeFileSync(join(sliceDir, 'txt', 'context-capsule.md'), 'txt', 'utf-8');

    const result = validateArtifactRetention('slice-symlink-escape');

    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toContain('prd/refactor-goal.md');
  });

  test('creates artifact retention reports with defaults', () => {
    const report = createArtifactRetentionReport({ sliceId: 'slice-1' });

    expect(report.sliceId).toBe('slice-1');
    expect(report.retentionStatus).toBe('pending');
    expect(report.commitHash).toBeNull();
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

  test('records retention boundary with current git commit as optional rollback point', () => {
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

describe('peaks-sc artifact session resolution (W4)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `peaks-sc-resolve-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    currentWorkspace = {
      workspaceId: 'ws-sc-resolve',
      name: 'SC Resolve Workspace',
      rootPath: projectRoot,
      installedCapabilityIds: []
    };
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
    currentWorkspace = null;
  });

  function writeSessionDir(sessionId: string, files: string[]): void {
    const dir = join(projectRoot, '.peaks', sessionId);
    mkdirSync(dir, { recursive: true });
    for (const rel of files) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, 'content', 'utf8');
    }
  }

  function writeActiveSkill(sessionId: string | null): void {
    const path = join(projectRoot, '.peaks', '.active-skill.json');
    if (sessionId === null) {
      if (existsSync(path)) rmSync(path);
      return;
    }
    writeFileSync(path, JSON.stringify({ sessionId, skill: 'peaks-rd', mode: 'inline' }, null, 2), 'utf8');
  }

  function writeActiveSkillNew(sessionId: string | null): void {
    const path = join(projectRoot, '.peaks', '_runtime', 'active-skill.json');
    if (sessionId === null) {
      if (existsSync(path)) rmSync(path);
      return;
    }
    mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(path, JSON.stringify({ sessionId, skill: 'peaks-rd', mode: 'inline' }, null, 2), 'utf8');
  }

  function writeSessionJsonBinding(sessionId: string | null): void {
    const path = join(projectRoot, '.peaks', '.session.json');
    if (sessionId === null) {
      if (existsSync(path)) rmSync(path);
      return;
    }
    writeFileSync(path, JSON.stringify({ sessionId, projectRoot }, null, 2), 'utf8');
  }

  function writeSessionJsonBindingNew(sessionId: string | null): void {
    const path = join(projectRoot, '.peaks', '_runtime', 'session.json');
    if (sessionId === null) {
      if (existsSync(path)) rmSync(path);
      return;
    }
    mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(path, JSON.stringify({ sessionId, projectRoot }, null, 2), 'utf8');
  }

  test('tier 1: active-skill sessionId wins when it owns the slice', () => {
    writeActiveSkill('2026-06-04-session-89f7cb');
    writeSessionJsonBinding('2026-06-04-session-cda1cd');
    writeSessionDir('2026-06-04-session-89f7cb', ['qa/test-cases/2026-06-04-slice-x.md']);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const result = validateArtifactRetention('2026-06-04-slice-x');

    expect(result.resolvedSessionId).toBe('2026-06-04-session-89f7cb');
    expect(result.candidateSources).toEqual(['active-skill']);
  });

  test('tier 2: session.json fallback when active-skill does not own the slice', () => {
    writeActiveSkill('2026-06-04-session-89f7cb');
    writeSessionJsonBinding('2026-06-04-session-cda1cd');
    // 89f7cb does NOT own the slice; cda1cd does.
    writeSessionDir('2026-06-04-session-89f7cb', []);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const result = validateArtifactRetention('2026-06-04-slice-x');

    expect(result.resolvedSessionId).toBe('2026-06-04-session-cda1cd');
    expect(result.candidateSources).toEqual(['active-skill', 'session-json']);
  });

  test('tier 3: find-fallback when neither binding owns the slice', () => {
    writeActiveSkill('2026-06-04-session-89f7cb');
    writeSessionJsonBinding('2026-06-04-session-ec7f95');
    // Neither binding owns the slice; a third session does.
    writeSessionDir('2026-06-04-session-89f7cb', []);
    writeSessionDir('2026-06-04-session-ec7f95', []);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const result = validateArtifactRetention('2026-06-04-slice-x');

    expect(result.resolvedSessionId).toBe('2026-06-04-session-cda1cd');
    expect(result.candidateSources).toEqual(['active-skill', 'session-json', 'find-fallback']);
  });

  test('no resolution: returns null resolvedSessionId when no session owns the slice', () => {
    writeActiveSkill('2026-06-04-session-89f7cb');
    writeSessionJsonBinding('2026-06-04-session-89f7cb');
    writeSessionDir('2026-06-04-session-89f7cb', []);

    const result = validateArtifactRetention('2026-06-04-slice-missing');

    expect(result.resolvedSessionId).toBeNull();
    expect(result.candidateSources).toEqual([]);
  });

  test('recordCommitBoundary also reports resolvedSessionId', () => {
    writeActiveSkill('2026-06-04-session-89f7cb');
    writeSessionJsonBinding('2026-06-04-session-89f7cb');
    writeSessionDir('2026-06-04-session-89f7cb', []);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const boundary = recordCommitBoundary({ sliceId: '2026-06-04-slice-x' });

    expect(boundary.resolvedSessionId).toBe('2026-06-04-session-cda1cd');
    expect(boundary.candidateSources).toEqual(['active-skill', 'session-json', 'find-fallback']);
  });

  // Slice 2026-06-05-peaks-runtime-layer: the canonical home for the
  // active-skill marker and the session binding is
  // `.peaks/_runtime/{active-skill,session}.json`. The legacy
  // `.peaks/.active-skill.json` / `.peaks/.session.json` paths are
  // tolerated as a one-minor-release back-compat fallback.
  test('runtime-layer: new active-skill path wins when both new + legacy exist', () => {
    writeActiveSkillNew('2026-06-04-session-89f7cb');
    writeActiveSkill('2026-06-04-session-cda1cd'); // stale legacy value
    writeSessionJsonBinding('2026-06-04-session-89f7cb');
    writeSessionDir('2026-06-04-session-89f7cb', ['qa/test-cases/2026-06-04-slice-x.md']);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const result = validateArtifactRetention('2026-06-04-slice-x');

    expect(result.resolvedSessionId).toBe('2026-06-04-session-89f7cb');
    expect(result.candidateSources).toEqual(['active-skill']);
  });

  test('runtime-layer: legacy active-skill path is honored as back-compat fallback', () => {
    writeActiveSkill('2026-06-04-session-89f7cb'); // only legacy
    writeSessionJsonBinding('2026-06-04-session-cda1cd');
    writeSessionDir('2026-06-04-session-89f7cb', ['qa/test-cases/2026-06-04-slice-x.md']);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const result = validateArtifactRetention('2026-06-04-slice-x');

    expect(result.resolvedSessionId).toBe('2026-06-04-session-89f7cb');
    expect(result.candidateSources).toEqual(['active-skill']);
  });

  test('runtime-layer: new session.json binding wins when both new + legacy exist', () => {
    writeActiveSkill(null);
    writeSessionJsonBindingNew('2026-06-04-session-89f7cb');
    writeSessionJsonBinding('2026-06-04-session-cda1cd');
    writeSessionDir('2026-06-04-session-89f7cb', ['qa/test-cases/2026-06-04-slice-x.md']);
    writeSessionDir('2026-06-04-session-cda1cd', ['qa/test-cases/2026-06-04-slice-x.md']);

    const result = validateArtifactRetention('2026-06-04-slice-x');

    expect(result.resolvedSessionId).toBe('2026-06-04-session-89f7cb');
    expect(result.candidateSources).toEqual(['active-skill', 'session-json']);
  });

  // Slice 2026-06-05-change-id-as-unit-of-work: shipped slice content lives
  // under `.peaks/retrospective/<change-id>/<role>/...`, ONE level deeper
  // than legacy `.peaks/<session-id>/<role>/...`. The find-fallback tier
  // must scan the nested umbrella, not just top-level.
  test('find-fallback: finds session under retrospective/ when only nested layout is on disk', () => {
    // Use a valid 6-hex session-id format: YYYY-MM-DD-session-<6hex>.
    const sessionId = '2026-05-29-session-aa11bb';
    // Create the nested retrospective dir, NOT a top-level session dir.
    const nestedDir = join(projectRoot, '.peaks', 'retrospective', sessionId);
    mkdirSync(join(nestedDir, 'qa', 'test-cases'), { recursive: true });
    writeFileSync(join(nestedDir, 'qa', 'test-cases', '2026-05-29-slice-shipped.md'), 'content', 'utf8');

    // No active-skill, no session.json — only the find-fallback should
    // find this session.
    writeActiveSkill(null);
    writeSessionJsonBinding(null);

    const result = validateArtifactRetention('2026-05-29-slice-shipped');

    expect(result.resolvedSessionId).toBe(sessionId);
    expect(result.candidateSources).toEqual(['active-skill', 'session-json', 'find-fallback']);
  });

  test('find-fallback: finds session under _dogfood/ umbrella', () => {
    const sessionId = '2026-06-05-session-d00d00';
    const nestedDir = join(projectRoot, '.peaks', '_dogfood', sessionId);
    mkdirSync(join(nestedDir, 'qa', 'test-cases'), { recursive: true });
    writeFileSync(join(nestedDir, 'qa', 'test-cases', '2026-06-05-dogfood.md'), 'content', 'utf8');

    writeActiveSkill(null);
    writeSessionJsonBinding(null);

    const result = validateArtifactRetention('2026-06-05-dogfood');

    expect(result.resolvedSessionId).toBe(sessionId);
    expect(result.candidateSources).toEqual(['active-skill', 'session-json', 'find-fallback']);
  });
});