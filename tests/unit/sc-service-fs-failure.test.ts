import { describe, expect, test, vi } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';

let currentWorkspace: WorkspaceConfig | null = {
  workspaceId: 'ws-sc',
  name: 'SC Workspace',
  rootPath: '/tmp/ws-sc',
  artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo' },
  installedCapabilityIds: []
};

vi.mock('../../src/services/config/config-service.js', () => ({
  getCurrentWorkspaceConfig: () => currentWorkspace,
  getWorkspaceConfigForPath: (_path?: string) => currentWorkspace
}));

vi.mock('../../src/services/artifacts/workspace-service.js', () => ({
  getArtifactRemoteRepo: (workspace: WorkspaceConfig) => workspace.artifactRepo ?? null,
  getLocalArtifactPath: (workspace: WorkspaceConfig) => `${workspace.rootPath}.peaks-artifacts`,
  getArtifactWorkspaceStatus: () => ({
    workspaceId: currentWorkspace?.workspaceId ?? 'unknown',
    localPath: currentWorkspace ? `${currentWorkspace.rootPath}.peaks-artifacts` : '.peaks-artifacts',
    configured: Boolean(currentWorkspace?.artifactRepo),
    syncStatus: 'pending',
    lastSync: null,
    hasLocalChanges: false,
    artifactRepo: currentWorkspace?.artifactRepo ?? null,
    nextActions: []
  })
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: () => true,
    lstatSync: () => ({ isSymbolicLink: () => false }),
    readFileSync: () => {
      throw new Error('cannot read current-change');
    }
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[]) => {
    if (command === 'git' && args[0] === '--version') return 'git version 2.0.0';
    if (command === 'git' && args[0] === 'rev-parse') return 'abc123def456\n';
    throw new Error('unexpected command');
  }
}));

const { getChangeTraceabilityStatus } = await import('../../src/services/sc/sc-service.js');

describe('sc service filesystem failures', () => {
  test('returns null change id when current-change file cannot be read', () => {
    expect(getChangeTraceabilityStatus().sessionId).toBeNull();
  });
});
