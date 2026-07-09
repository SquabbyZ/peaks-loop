/**
 * zcode-adapter runtime model detection (Slice 2026-07-09 add-zcode-adapter, C.7).
 *
 * Strategy: the adapter reads `~/.zcode/v2/config.json` synchronously
 * via `fs.readFileSync`. We inject a fixture file via the env var
 * `PEAKS_ZCODE_CONFIG_PATH`. Resolution logic is exposed via
 * `resolveZcodeCurrentModel` so we can test the pure parsing logic
 * without touching disk at all (Karpathy guideline #2 — Simplicity
 * First: do NOT introduce cache / timeout machinery in this slice).
 *
 * Per SC-3 §3.5 T-1 ~ T-12 (extended for Slice C).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectZcodeCurrentModel,
  resolveZcodeCurrentModel,
  defaultZcodeConfigPath,
} from '../../../src/services/ide/adapters/zcode-adapter.js';

const ORIGINAL_CONFIG_PATH = process.env.PEAKS_ZCODE_CONFIG_PATH;
const ORIGINAL_ACTIVE_PROVIDER = process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID;

describe('resolveZcodeCurrentModel (pure parsing)', () => {
  it('R-1: returns undefined when config has no `provider` field', () => {
    expect(resolveZcodeCurrentModel({})).toBeUndefined();
    expect(resolveZcodeCurrentModel(null)).toBeUndefined();
    expect(resolveZcodeCurrentModel(undefined)).toBeUndefined();
  });

  it('R-2: returns undefined when `provider` is empty', () => {
    expect(resolveZcodeCurrentModel({ provider: {} })).toBeUndefined();
  });

  it('R-3: env-var override (P1) wins when provided UUID exists', () => {
    const config = {
      provider: {
        'builtin:zai': {
          name: 'Z.ai',
          enabled: true,
          models: { 'GLM-5.2': {} },
        },
        'cust-uuid-1': {
          name: 'CustomProvider',
          enabled: true,
          models: { 'Cust-Model': {} },
        },
      },
    };
    expect(resolveZcodeCurrentModel(config, 'cust-uuid-1')).toBe('Cust-Model');
  });

  it('R-4: env-var override falls through when UUID does NOT exist', () => {
    const config = {
      provider: {
        'cust-uuid-1': { name: 'X', enabled: true, models: { 'Y-Model': {} } },
      },
    };
    // env override points to nothing → fall through to P2 (non-builtin)
    expect(resolveZcodeCurrentModel(config, 'missing')).toBe('Y-Model');
  });

  it('R-5: P2 — prefers a non-builtin provider when no env override', () => {
    const config = {
      provider: {
        'builtin:bigmodel': {
          name: 'bigmodel',
          enabled: true,
          models: { 'GLM-X': {} },
        },
        'custom-uuid-aaa': {
          name: 'Custom',
          enabled: true,
          models: { 'Z1-Model': {} },
        },
      },
    };
    expect(resolveZcodeCurrentModel(config)).toBe('Z1-Model');
  });

  it('R-6: P3 — falls back to first enabled provider when no non-builtin', () => {
    const config = {
      provider: {
        'builtin:zai': { name: 'Z', enabled: false, models: { 'GLM-OFF': {} } },
        'builtin:zai-start-plan': {
          name: 'P',
          enabled: true,
          models: { 'GLM-Active': {} },
        },
      },
    };
    expect(resolveZcodeCurrentModel(config)).toBe('GLM-Active');
  });

  it('R-7: P4 — falls back to first provider when nothing is enabled', () => {
    const config = {
      provider: {
        'builtin:zai': { name: 'Z', enabled: false, models: { 'GLM-ALL-OFF': {} } },
      },
    };
    expect(resolveZcodeCurrentModel(config)).toBe('GLM-ALL-OFF');
  });

  it('R-8: user fixture — resolves "M3" (slice-C verification scenario)', () => {
    // Mirrors the real z-code config seen on the host during Slice C:
    //   - builtin providers with `enabled: false`
    //   - one user-installed non-builtin provider with `enabled: undefined`
    //   - first model id should win
    const config = {
      provider: {
        'builtin:bigmodel': {
          name: 'Bigmodel - API Key',
          kind: 'anthropic',
          enabled: false,
          models: { 'GLM-5.2': {}, 'GLM-5-Turbo': {} },
        },
        'builtin:zai': { name: 'Z.ai - API Key', kind: 'anthropic', enabled: true, models: { 'GLM-5.2': {} } },
        '32a71410-df2f-4a13-9143-19571fd16fb0': {
          name: 'Minimax-199',
          kind: 'anthropic',
          models: { M3: {}, 'M2.7': {} },
        },
      },
    };
    expect(resolveZcodeCurrentModel(config)).toBe('M3');
  });

  it('R-9: skips a provider that has no `models` key (defensive)', () => {
    const config = {
      provider: {
        'broken-uuid': { name: 'Broken' /* no models */ },
        'good-uuid': { name: 'Good', models: { 'GOOD-Model': {} } },
      },
    };
    expect(resolveZcodeCurrentModel(config)).toBe('GOOD-Model');
  });
});

describe('detectZcodeCurrentModel (env-controlled fixture file)', () => {
  let tmpDir: string;
  let previousPath: string | undefined;
  let previousActive: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'peaks-zcode-detect-'));
    previousPath = process.env.PEAKS_ZCODE_CONFIG_PATH;
    previousActive = process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID;
  });

  afterEach(() => {
    if (previousPath === undefined) delete process.env.PEAKS_ZCODE_CONFIG_PATH;
    else process.env.PEAKS_ZCODE_CONFIG_PATH = previousPath;
    if (previousActive === undefined) delete process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID;
    else process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID = previousActive;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('D-1: returns undefined when PEAKS_ZCODE_CONFIG_PATH points nowhere', async () => {
    process.env.PEAKS_ZCODE_CONFIG_PATH = join(tmpDir, 'no-such-file.json');
    expect(await detectZcodeCurrentModel()).toBeUndefined();
  });

  it('D-2: reads the fixture file at PEAKS_ZCODE_CONFIG_PATH and resolves "M3"', async () => {
    const fixture = {
      provider: {
        'builtin:zai': { name: 'Z.ai', enabled: true, models: { 'GLM-5.2': {} } },
        '32a71410-df2f-4a13-9143-19571fd16fb0': {
          name: 'Minimax-199',
          models: { M3: {}, 'M2.7': {} },
        },
      },
    };
    const cfgPath = join(tmpDir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify(fixture), 'utf8');
    process.env.PEAKS_ZCODE_CONFIG_PATH = cfgPath;
    expect(await detectZcodeCurrentModel()).toBe('M3');
  });

  it('D-3: malformed JSON → undefined (defensive)', async () => {
    const cfgPath = join(tmpDir, 'config.json');
    writeFileSync(cfgPath, '{ this is not valid json', 'utf8');
    process.env.PEAKS_ZCODE_CONFIG_PATH = cfgPath;
    expect(await detectZcodeCurrentModel()).toBeUndefined();
  });

  it('D-4: PEAKS_ZCODE_ACTIVE_PROVIDER_UUID wins over auto-detection', async () => {
    const fixture = {
      provider: {
        'builtin:zai': { name: 'Z.ai', enabled: true, models: { 'GLM-5.2': {} } },
        'other-uuid': { name: 'Other', models: { 'Other-Model': {} } },
      },
    };
    const cfgPath = join(tmpDir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify(fixture), 'utf8');
    process.env.PEAKS_ZCODE_CONFIG_PATH = cfgPath;
    process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID = 'other-uuid';
    expect(await detectZcodeCurrentModel()).toBe('Other-Model');
  });
});

describe('defaultZcodeConfigPath', () => {
  it('P-1: returns a path under ~/.zcode/v2/config.json', () => {
    const p = defaultZcodeConfigPath();
    expect(p).toMatch(/[/\\]\.zcode[/\\]v2[/\\]config\.json$/);
  });
});

afterEach(() => {
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.PEAKS_ZCODE_CONFIG_PATH;
  else process.env.PEAKS_ZCODE_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  if (ORIGINAL_ACTIVE_PROVIDER === undefined) delete process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID;
  else process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID = ORIGINAL_ACTIVE_PROVIDER;
});
