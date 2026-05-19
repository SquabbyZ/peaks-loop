import { describe, expect, test } from 'vitest';
import { getArtifactWorkspaceStatus, planArtifactSync } from '../../src/services/artifacts/workspace-service.js';

describe('workspace service', () => {
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

  test('getArtifactWorkspaceStatus returns configured=false when workspace has no artifact repo', () => {
    // Current workspace ws-sw exists in HOME config but /ws1 path doesn't exist
    // getCurrentWorkspaceConfig will return null because the workspace rootPath doesn't exist
    const status = getArtifactWorkspaceStatus('ws-sw');
    expect(status.configured).toBe(false);
    expect(status.syncStatus).toBe('unknown');
  });

  test('planArtifactSync returns unknown when workspace rootPath does not exist', () => {
    // ws1 exists but rootPath /ws1 doesn't exist
    const plan = planArtifactSync('ws1', true);
    expect(plan.workspaceId).toBe('ws1');
    expect(plan.remoteUrl).toBeNull();
  });

  test('planArtifactSync dry-run returns planned commands', () => {
    const plan = planArtifactSync('nonexistent', true);
    expect(plan.dryRun).toBe(true);
    expect(plan.plannedCommands[0]).toContain('No artifact repo configured');
  });
});