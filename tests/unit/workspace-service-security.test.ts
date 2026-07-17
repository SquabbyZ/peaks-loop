import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';

let currentWorkspace: WorkspaceConfig | null = null;
let localDirExists = false;
let execError: Error | null = null;
type ExecCall = { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv };
const execCalls: ExecCall[] = [];

vi.mock('../../src/services/config/config-service.js', () => ({
  getCurrentWorkspaceConfig: () => currentWorkspace,
  getWorkspaceConfig: (id: string) => currentWorkspace?.workspaceId === id ? currentWorkspace : null,
  getWorkspaceConfigForCurrentPath: () => currentWorkspace,
  readConfig: () => ({ workspaces: currentWorkspace ? [currentWorkspace] : [] })
}));

vi.mock('peaks-loop-shared/fs', () => ({
  pathExists: () => Promise.resolve(localDirExists)
}));

vi.mock('../../src/shared/process.js', () => ({
  execCommand: async (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    const call: ExecCall = { command, args };
    if (options?.cwd) call.cwd = options.cwd;
    if (options?.env) call.env = options.env;
    execCalls.push(call);
    if (execError) throw execError;
    return 'ok';
  }
}));

const { executeArtifactSync, hasValidArtifactWorkspace, isArtifactWorkspaceOutsideTarget } = await import('../../src/services/artifacts/workspace-service.js');

describe('executeArtifactSync security', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    localDirExists = false;
    execError = null;
    execCalls.length = 0;
    currentWorkspace = {
      workspaceId: 'ws-secure',
      name: 'Secure Workspace',
      rootPath: join(tmpdir(), `peaks-secure-${Date.now()}`),
      artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo' },
      artifactStorage: { mode: 'local-with-remote-sync', localPath: join(tmpdir(), `peaks-secure-artifacts-${Date.now()}`), remote: { provider: 'github', owner: 'acme', name: 'artifact-repo' } },
      installedCapabilityIds: []
    };
  });

  test('rejects artifact workspace links that resolve inside the target repository', () => {
    const workspaceRoot = join(tmpdir(), `peaks-link-root-${Date.now()}`);
    const targetArtifactRoot = join(workspaceRoot, '.peaks-artifacts-target');
    const linkedArtifactRoot = join(tmpdir(), `peaks-linked-artifacts-${Date.now()}`);
    mkdirSync(targetArtifactRoot, { recursive: true });
    symlinkSync(targetArtifactRoot, linkedArtifactRoot, 'junction');
    currentWorkspace = {
      workspaceId: 'ws-linked',
      name: 'Linked Workspace',
      rootPath: workspaceRoot,
      artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo' },
      installedCapabilityIds: []
    };

    expect(isArtifactWorkspaceOutsideTarget(currentWorkspace, linkedArtifactRoot)).toBe(true);
  });

  test('rejects artifact workspaces whose .peaks link resolves inside the target repository', () => {
    const workspaceRoot = join(tmpdir(), `peaks-peaks-link-root-${Date.now()}`);
    const artifactRoot = join(tmpdir(), `peaks-artifacts-${Date.now()}`);
    const internalPeaks = join(workspaceRoot, '.peaks-internal');
    mkdirSync(join(internalPeaks, 'changes'), { recursive: true });
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(internalPeaks, 'config.json'), '{}', 'utf8');
    symlinkSync(internalPeaks, join(artifactRoot, '.peaks'), 'junction');
    currentWorkspace = {
      workspaceId: 'ws-peaks-linked',
      name: 'Peaks Linked Workspace',
      rootPath: workspaceRoot,
      artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo' },
      installedCapabilityIds: []
    };

    expect(isArtifactWorkspaceOutsideTarget(currentWorkspace, artifactRoot)).toBe(true);
    expect(hasValidArtifactWorkspace(currentWorkspace as WorkspaceConfig, artifactRoot)).toBe(false);
  });

  test('rejects artifact workspaces whose .peaks changes link resolves inside the target repository', () => {
    const workspaceRoot = join(tmpdir(), `peaks-changes-link-root-${Date.now()}`);
    const artifactRoot = join(tmpdir(), `peaks-artifacts-${Date.now()}`);
    const internalChanges = join(workspaceRoot, '.peaks-internal-changes');
    mkdirSync(internalChanges, { recursive: true });
    mkdirSync(join(artifactRoot, '.peaks'), { recursive: true });
    writeFileSync(join(artifactRoot, '.peaks', 'config.json'), '{}', 'utf8');
    symlinkSync(internalChanges, join(artifactRoot, '.peaks', 'changes'), 'junction');
    currentWorkspace = {
      workspaceId: 'ws-changes-linked',
      name: 'Changes Linked Workspace',
      rootPath: workspaceRoot,
      artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo' },
      installedCapabilityIds: []
    };

    expect(isArtifactWorkspaceOutsideTarget(currentWorkspace, artifactRoot)).toBe(true);
    expect(hasValidArtifactWorkspace(currentWorkspace as WorkspaceConfig, artifactRoot)).toBe(false);
  });

  test('does not expose GH_TOKEN in returned sync details', async () => {
    vi.stubEnv('GH_TOKEN', 'secret-token');

    const result = await executeArtifactSync();

    expect(result.success).toBe(true);
    expect(result.remoteUrl).toBe('https://github.com/acme/artifact-repo.git');
    const expectedLocalPath = resolve((currentWorkspace!.artifactStorage as { mode: string; localPath: string }).localPath);
    expect(result.commands.join('\n')).not.toContain('secret-token');
    expect(result.commands).toContain(`git clone https://github.com/acme/artifact-repo.git "${expectedLocalPath}"`);
    expect(execCalls[0]).toMatchObject({
      command: 'git',
      args: ['clone', 'https://github.com/acme/artifact-repo.git', expectedLocalPath]
    });
    expect(execCalls[0]?.env?.GIT_CONFIG_VALUE_0).toContain('AUTHORIZATION: basic ');
    expect(execCalls[0]?.env?.GIT_CONFIG_VALUE_0).not.toContain('secret-token');
  });

  test('redacts GH_TOKEN from sync errors', async () => {
    vi.stubEnv('GH_TOKEN', 'secret-token');
    const encodedToken = Buffer.from('x-access-token:secret-token', 'utf-8').toString('base64');
    execError = new Error(`fatal: https://x-access-token:secret-token@github.com/acme/artifact-repo.git failed with AUTHORIZATION: basic ${encodedToken}`);

    const result = await executeArtifactSync();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Clone failed: fatal: https://x-access-token:***@github.com/acme/artifact-repo.git failed with AUTHORIZATION: basic ***');
    expect(result.error).not.toContain('secret-token');
    expect(result.error).not.toContain(encodedToken);
    expect(result.remoteUrl).toBe('https://github.com/acme/artifact-repo.git');
  });

  test('does not apply GH_TOKEN to GitLab remotes', async () => {
    vi.stubEnv('GH_TOKEN', 'github-only-token');
    currentWorkspace = {
      workspaceId: 'ws-gitlab',
      name: 'GitLab Workspace',
      rootPath: join(tmpdir(), `peaks-gitlab-${Date.now()}`),
      artifactRepo: { provider: 'gitlab', owner: 'acme', name: 'artifact-repo' },
      artifactStorage: { mode: 'local-with-remote-sync', localPath: join(tmpdir(), `peaks-gitlab-artifacts-${Date.now()}`), remote: { provider: 'gitlab', owner: 'acme', name: 'artifact-repo' } },
      installedCapabilityIds: []
    };

    const result = await executeArtifactSync();

    expect(result.success).toBe(true);
    expect(result.remoteUrl).toBe('https://gitlab.com/acme/artifact-repo.git');
    expect(execCalls[0]?.args[1]).toBe('https://gitlab.com/acme/artifact-repo.git');
    expect(result.commands.join('\n')).not.toContain('github-only-token');
  });
});
