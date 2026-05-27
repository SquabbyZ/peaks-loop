import { describe, expect, test } from 'vitest';
import { getInstalledCapabilityIds } from '../../src/cli/commands/capability-commands.js';
import type { PeaksConfig } from '../../src/services/config/config-types.js';

function createConfig(): PeaksConfig {
  return {
    version: '0.1.0',
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
  test('returns empty installed capability IDs (workspace registry removed)', () => {
    const installedCapabilityIds = getInstalledCapabilityIds(createConfig());

    expect(installedCapabilityIds).toEqual([]);
  });
});
