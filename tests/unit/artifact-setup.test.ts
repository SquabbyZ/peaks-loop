import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';
import { pathsEqual } from '../../src/shared/path-utils.js';

let currentWorkspace: WorkspaceConfig | null = null;

vi.mock('../../src/services/config/config-service.js', () => ({
  getCurrentWorkspaceConfig: () => currentWorkspace
}));

vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[]) => {
    if (command === 'git' && args[0] === '--version') return Buffer.from('git version 2.0.0');
    throw new Error('unexpected command');
  }
}));

const { createGuidedArtifactSetup } = await import('../../src/services/artifacts/artifact-service.js');

describe('guided artifact setup', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    currentWorkspace = null;
  });

  test('reports unconfigured workspace when no workspace is selected', () => {
    const setup = createGuidedArtifactSetup();

    expect(setup.validationResult.workspaceExists).toBe(false);
    expect(setup.workspaceId).toBeNull();
    expect(setup.provider).toBeNull();
    expect(setup.remoteUrl).toBeNull();
    expect(setup.nextStep).toBe('configure');
    expect(setup.localPath).toBe('.peaks-artifacts');
  });

  test('reports configured workspace and artifact repo details', () => {
    const testRoot = join(tmpdir(), `peaks-test-${Date.now()}`);
    currentWorkspace = {
      workspaceId: 'ws-artifacts',
      name: 'Artifacts Workspace',
      rootPath: testRoot,
      artifactRepo: { provider: 'github', owner: 'acme', name: 'peaks-artifacts' },
      installedCapabilityIds: []
    };

    const setup = createGuidedArtifactSetup();

    expect(setup.validationResult.workspaceExists).toBe(true);
    expect(setup.validationResult.gitAvailable).toBe(true);
    expect(setup.workspaceId).toBe('ws-artifacts');
    expect(setup.workspacePath).toBe(testRoot);
    expect(setup.provider).toBe('github');
    expect(setup.repoOwner).toBe('acme');
    expect(setup.repoName).toBe('peaks-artifacts');
    expect(pathsEqual(setup.localPath, join(process.env.HOME ?? '', '.peaks', 'workspaces', 'ws-artifacts', 'artifacts'))).toBe(true);
    expect(setup.remoteUrl).toBe('https://github.com/acme/peaks-artifacts.git');
  });

  test('reports artifactStorage remote details without legacy artifactRepo', () => {
    const testRoot = join(tmpdir(), `peaks-test-${Date.now()}`);
    currentWorkspace = {
      workspaceId: 'ws-storage-remote',
      name: 'Storage Remote Workspace',
      rootPath: testRoot,
      artifactStorage: { mode: 'local-with-remote-sync', remote: { provider: 'gitlab', owner: 'acme', name: 'storage-artifacts' } },
      installedCapabilityIds: []
    };

    const setup = createGuidedArtifactSetup();

    expect(setup.provider).toBe('gitlab');
    expect(setup.repoOwner).toBe('acme');
    expect(setup.repoName).toBe('storage-artifacts');
    expect(setup.remoteUrl).toBe('https://gitlab.com/acme/storage-artifacts.git');
    expect(setup.nextStep).toBe('validate');
  });

  test('treats local artifactStorage as ready without requiring a remote repository', () => {
    const testRoot = join(tmpdir(), `peaks-test-${Date.now()}`);
    currentWorkspace = {
      workspaceId: 'ws-local-artifacts',
      name: 'Local Artifact Workspace',
      rootPath: testRoot,
      artifactStorage: { mode: 'local' },
      installedCapabilityIds: []
    };

    const setup = createGuidedArtifactSetup();

    expect(setup.provider).toBeNull();
    expect(setup.remoteUrl).toBeNull();
    expect(setup.nextStep).toBe('complete');
    expect(setup.guidance.join('\n')).not.toContain('Artifact sync is ready when workspace has artifactRepo configured');
    expect(setup.guidance.join('\n')).toContain('Local artifact storage is ready');
  });

  test('detects token and common SSH key names without CommonJS require', () => {
    const home = join(tmpdir(), `peaks-home-${Date.now()}`);
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(join(home, '.ssh', 'id_ed25519'), 'test-key', 'utf-8');
    vi.stubEnv('HOME', home);
    vi.stubEnv('GH_TOKEN', 'test-token');

    const setup = createGuidedArtifactSetup();

    expect(existsSync(join(home, '.ssh', 'id_ed25519'))).toBe(true);
    expect(setup.validationResult.ghTokenAvailable).toBe(true);
    expect(setup.validationResult.sshKeyAvailable).toBe(true);
  });
});
