import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

let allWorkspaces: WorkspaceConfig[] = [];

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => workspaceServiceHome };
});

vi.mock('../../src/services/config/config-service.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/config/config-service.js')>('../../src/services/config/config-service.js');
  return {
    ...actual,
    getWorkspaceConfig: (id: string) => allWorkspaces.find((w) => w.workspaceId === id) ?? null,
    getWorkspaceConfigForPath: (_path?: string) => null
  };
});

function writeWorkspaceServiceConfig(): void {
  allWorkspaces = [
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
  ];
  mkdirSync(join(workspaceServiceHome, '.peaks'), { recursive: true });
  writeFileSync(join(workspaceServiceHome, '.peaks', 'config.json'), JSON.stringify({
    version: '0.1.0',
    currentWorkspace: null,
    workspaces: allWorkspaces,
    language: 'en',
    model: 'sonnet',
    economyMode: true,
    swarmMode: true,
    tokens: {},
    providers: { anthropic: { model: 'claude-opus-4-7' } },
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

    expect(getLocalArtifactPath(workspace)).toBe(resolve(workspace.rootPath, '.peaks', 'artifacts'));
  });

  test('getArtifactWorkspaceStatus treats missing artifactRepo as local storage', () => {
    const status = getArtifactWorkspaceStatus('ws-sw');

    expect(status.configured).toBe(true);
    expect(status.artifactRepo).toBeNull();
    expect(status.syncStatus).toBe('pending');
    expect(status.localPath).toBe(resolve(join(tmpdir(), 'peaks-local-target'), '.peaks', 'artifacts'));
    expect(status.nextActions.join('\n')).toContain('Local artifact storage ready');
  });

  test('planArtifactSync for default local storage returns local storage plan', () => {
    const plan = planArtifactSync('ws-sw', true);

    expect(plan.workspaceId).toBe('ws-sw');
    expect(plan.remoteUrl).toBeNull();
    expect(plan.localPath).toBe(resolve(join(tmpdir(), 'peaks-local-target'), '.peaks', 'artifacts'));
    expect(plan.plannedCommands.join('\n')).toContain('No remote repository is configured or required');
  });

  test('planArtifactSync returns sync plan when artifact path is inside the target repo', () => {
    const plan = planArtifactSync('ws1', true);

    expect(plan.workspaceId).toBe('ws1');
    expect(plan.remoteUrl).toBe('https://github.com/smallmark1912/artifacts.git');
    expect(plan.localPath).toBe(resolve(join(tmpdir(), 'peaks-legacy-target'), '.peaks', 'artifacts'));
    expect(plan.plannedCommands.join('\n')).toContain('# Sync plan for workspace ws1');
  });

  test('explicit local artifactStorage overrides legacy artifactRepo sync', () => {
    const status = getArtifactWorkspaceStatus('ws-local-overrides-legacy');
    const plan = planArtifactSync('ws-local-overrides-legacy', true);

    expect(status.artifactRepo).toBeNull();
    expect(status.configured).toBe(true);
    expect(status.nextActions.join('\n')).toContain('Local artifact storage ready');
    expect(plan.remoteUrl).toBeNull();
    expect(plan.plannedCommands.join('\n')).toContain('No remote repository is configured or required');
  });

  test('artifactStorage remote sync works without legacy artifactRepo', () => {
    const status = getArtifactWorkspaceStatus('ws-storage-remote');
    const plan = planArtifactSync('ws-storage-remote', true);

    expect(status.artifactRepo).toEqual({ provider: 'gitlab', owner: 'acme', name: 'storage-artifacts' });
    expect(status.configured).toBe(true);
    expect(status.nextActions.join('\n')).toContain('peaks artifacts sync --workspace ws-storage-remote --dry-run');
    expect(plan.remoteUrl).toBe('https://gitlab.com/acme/storage-artifacts.git');
    expect(plan.plannedCommands.join('\n')).toContain('# Sync plan for workspace ws-storage-remote');
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

  test('planArtifactSync returns sync plan when workspace rootPath does not exist', () => {
    const plan = planArtifactSync('ws1', true);
    expect(plan.workspaceId).toBe('ws1');
    expect(plan.remoteUrl).toBe('https://github.com/smallmark1912/artifacts.git');
    expect(plan.plannedCommands.join('\n')).toContain('# Sync plan for workspace ws1');
  });

  test('planArtifactSync dry-run returns planned commands', () => {
    const plan = planArtifactSync('nonexistent', true);
    expect(plan.dryRun).toBe(true);
    expect(plan.plannedCommands[0]).toContain('No artifact repo configured');
  });
});