import { describe, expect, test } from 'vitest';
import { getInstalledCapabilityIds } from '../../src/cli/commands/capability-commands.js';
import type { PeaksConfig } from '../../src/services/config/config-types.js';

function createConfig(currentWorkspace: string | null): PeaksConfig {
  return {
    version: '0.1.0',
    currentWorkspace,
    workspaces: [{ workspaceId: 'ws-a', name: 'Workspace A', rootPath: '/tmp/ws-a', installedCapabilityIds: ['context7.docs-lookup'] }],
    language: 'en',
    model: 'sonnet',
    economyMode: true,
    swarmMode: true,
    tokens: {},
    providers: {},
    proxy: {}
  };
}

describe('capability commands helpers', () => {
  test('returns installed capability IDs for the current workspace', () => {
    const installedCapabilityIds = getInstalledCapabilityIds(createConfig('ws-a'));

    expect(installedCapabilityIds).toEqual(['context7.docs-lookup']);
    installedCapabilityIds.push('mutated');
    expect(getInstalledCapabilityIds(createConfig('ws-a'))).toEqual(['context7.docs-lookup']);
  });

  test('returns no installed capability IDs when the current workspace is absent', () => {
    expect(getInstalledCapabilityIds(createConfig(null))).toEqual([]);
    expect(getInstalledCapabilityIds(createConfig('missing'))).toEqual([]);
  });
});
