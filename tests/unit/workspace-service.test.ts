import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getArtifactWorkspaceStatus, getLocalArtifactPath, planArtifactSync } from '../../src/services/artifacts/workspace-service.js';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';

const workspaceServiceHome = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'peaks-workspace-service-home-'));
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => workspaceServiceHome };
});

function writeWorkspaceServiceConfig(): void {
  mkdirSync(join(workspaceServiceHome, '.peaks'), { recursive: true });
  writeFileSync(join(workspaceServiceHome, '.peaks', 'config.json'), JSON.stringify({
    version: '0.1.0',
    currentWorkspace: null,
    workspaces: [
      {
        workspaceId: 'ws-sw',
        name: 'Local Workspace',
        rootPath: join(tmpdir(), 'peaks-local-target'),
        installedCapabilityIds: []
      },
      {
        workspaceId: 'ws1',
        name: 'Legacy Remote Workspace',
        rootPath: join(tmpdir(), 'peaks-legacy-target'),
        artifactRepo: { provider: 'github', owner: 'smallmark1912', name: 'artifacts' },
        installedCapabilityIds: []
      },
      {
        workspaceId: 'ws-local-overrides-legacy',
        name: 'Local Override Workspace',
        rootPath: join(tmpdir(), 'peaks-local-override-target'),
        artifactRepo: { provider: 'github', owner: 'smallmark1912', name: 'legacy-artifacts' },
        artifactStorage: { mode: 'local' },
        installedCapabilityIds: []
      },
      {
        workspaceId: 'ws-storage-remote',
        name: 'Storage Remote Workspace',
        rootPath: join(tmpdir(), 'peaks-storage-remote-target'),
        artifactStorage: { mode: 'local-with-remote-sync', remote: { provider: 'gitlab', owner: 'acme', name: 'storage-artifacts' } },
        installedCapabilityIds: []
      }
    ],
    language: 'en',
    model: 'sonnet',
    economyMode: true,
    swarmMode: true,
    tokens: {},
    providers: { minimax: { model: 'minimax-2.7' } },
    proxy: {}
  }), 'utf8');
}

describe('workspace service', () => {
  beforeEach(() => {
    writeWorkspaceServiceConfig();
  });

  test('getLocalArtifactPath defaults to global workspace artifact directory', () => {
    const workspace: WorkspaceConfig = {
      workspaceId: 'ws-local',
      name: 'Local Workspace',
      rootPath: join(mkdtempSync(join(tmpdir(), 'peaks-target-')), 'app'),
      installedCapabilityIds: []
    };

    expect(getLocalArtifactPath(workspace)).toBe(join(workspaceServiceHome, '.peaks', 'workspaces', 'ws-local', 'artifacts'));
  });

  test('getArtifactWorkspaceStatus treats missing artifactRepo as configured local storage', () => {
    const status = getArtifactWorkspaceStatus('ws-sw');

    expect(status.configured).toBe(true);
    expect(status.artifactRepo).toBeNull();
    expect(status.syncStatus).toBe('pending');
    expect(status.localPath).toBe(join(workspaceServiceHome, '.peaks', 'workspaces', 'ws-sw', 'artifacts'));
    expect(status.nextActions.join('\n')).not.toContain('Configure artifact repo');
  });

  test('planArtifactSync for default local storage returns local-only plan without git commands', () => {
    const plan = planArtifactSync('ws-sw', true);

    expect(plan.workspaceId).toBe('ws-sw');
    expect(plan.remoteUrl).toBeNull();
    expect(plan.localPath).toBe(join(workspaceServiceHome, '.peaks', 'workspaces', 'ws-sw', 'artifacts'));
    expect(plan.plannedCommands.join('\n')).toContain('Local artifact storage');
    expect(plan.plannedCommands.join('\n')).not.toContain('git clone');
  });

  test('planArtifactSync keeps legacy artifactRepo as remote sync plan', () => {
    const plan = planArtifactSync('ws1', true);

    expect(plan.workspaceId).toBe('ws1');
    expect(plan.remoteUrl).toBe('https://github.com/smallmark1912/artifacts.git');
    expect(plan.localPath).toBe(join(workspaceServiceHome, '.peaks', 'workspaces', 'ws1', 'artifacts'));
    expect(plan.plannedCommands.join('\n')).toContain('peaks artifacts sync --workspace ws1');
  });

  test('explicit local artifactStorage overrides legacy artifactRepo sync', () => {
    const status = getArtifactWorkspaceStatus('ws-local-overrides-legacy');
    const plan = planArtifactSync('ws-local-overrides-legacy', true);

    expect(status.artifactRepo).toBeNull();
    expect(status.nextActions.join('\n')).toContain('Local artifact storage ready');
    expect(plan.remoteUrl).toBeNull();
    expect(plan.plannedCommands.join('\n')).toContain('Local artifact storage');
    expect(plan.plannedCommands.join('\n')).not.toContain('peaks artifacts sync');
  });

  test('artifactStorage remote sync works without legacy artifactRepo', () => {
    const status = getArtifactWorkspaceStatus('ws-storage-remote');
    const plan = planArtifactSync('ws-storage-remote', true);

    expect(status.artifactRepo).toEqual({ provider: 'gitlab', owner: 'acme', name: 'storage-artifacts' });
    expect(status.nextActions.join('\n')).toContain('peaks artifacts sync --workspace ws-storage-remote');
    expect(plan.remoteUrl).toBe('https://gitlab.com/acme/storage-artifacts.git');
  });

  test('getArtifactWorkspaceStatus returns unconfigured for unknown workspace', () => {
    const status = getArtifactWorkspaceStatus('nonexistent');
    expect(status.configured).toBe(false);
    expect(status.syncStatus).toBe('unknown');
    expect(status.workspaceId).toBe('nonexistent');
  });

  test('planArtifactSync returns error plan for unknown workspace', () => {
    const plan = planArtifactSync('nonexistent', true);
    expect(plan.workspaceId).toBe('nonexistent');
    expect(plan.remoteUrl).toBeNull();
    expect(plan.plannedCommands).toHaveLength(1);
  });

  test('getArtifactWorkspaceStatus treats local storage as configured without artifact repo', () => {
    const status = getArtifactWorkspaceStatus('ws-sw');
    expect(status.configured).toBe(true);
    expect(status.syncStatus).toBe('pending');
  });

  test('planArtifactSync keeps remote URL when workspace rootPath does not exist', () => {
    const plan = planArtifactSync('ws1', true);
    expect(plan.workspaceId).toBe('ws1');
    expect(plan.remoteUrl).toBe('https://github.com/smallmark1912/artifacts.git');
  });

  test('planArtifactSync dry-run returns planned commands', () => {
    const plan = planArtifactSync('nonexistent', true);
    expect(plan.dryRun).toBe(true);
    expect(plan.plannedCommands[0]).toContain('No artifact repo configured');
  });
});