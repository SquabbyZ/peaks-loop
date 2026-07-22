import { describe, expect, it, test } from 'vitest';
import {
  resolveMemoryPreflightConfig,
  type MemoryPreflightConfig,
} from '../../../../src/services/context/memory-preflight-config.js';
import { DEFAULT_PREFERENCES } from '../../../../src/services/preferences/preferences-types.js';

describe('resolveMemoryPreflightConfig', () => {
  test('defaults when preference key is absent', () => {
    const cfg: MemoryPreflightConfig = resolveMemoryPreflightConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxTokens).toBe(1200);
    expect(cfg.listCap).toBe(12);
    expect(cfg.contentCacheBytes).toBe(6000);
  });

  test('partial prefs overlay defaults', () => {
    const cfg = resolveMemoryPreflightConfig({
      memoryPreflight: { enabled: false, maxTokens: 800, listCap: 5, contentCacheBytes: 2000 },
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxTokens).toBe(800);
    expect(cfg.listCap).toBe(5);
    expect(cfg.contentCacheBytes).toBe(2000);
  });

  test('invalid maxTokens falls back to default', () => {
    const cfg = resolveMemoryPreflightConfig({ memoryPreflight: { maxTokens: -3 } });
    expect(cfg.maxTokens).toBe(1200);
  });

  test('listCap clamped to [1, 50]', () => {
    expect(resolveMemoryPreflightConfig({ memoryPreflight: { listCap: 0 } }).listCap).toBe(1);
    expect(resolveMemoryPreflightConfig({ memoryPreflight: { listCap: 9999 } }).listCap).toBe(50);
  });

  // Locks the two default blocks together: the standalone DEFAULTS in
  // memory-preflight-config.ts and the DEFAULT_PREFERENCES.memoryPreflight
  // block in preferences-types.ts must produce the same resolved
  // configuration. If either side drifts, this test fails loudly.
  it('DEFAULT_PREFERENCES.memoryPreflight produces the same config as an empty input', () => {
    const fromDefaults = resolveMemoryPreflightConfig(DEFAULT_PREFERENCES);
    const fromEmpty = resolveMemoryPreflightConfig({});
    expect(fromDefaults).toEqual(fromEmpty);
  });
});
