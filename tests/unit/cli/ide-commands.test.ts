/**
 * `peaks ide model --current` (Slice 2026-07-09 add-zcode-adapter, C.8).
 *
 * Verifies the CLI surface that wraps `detectCurrentIdeModel()`. Two
 * key behaviors to lock down:
 *
 *   1. With a fixture z-code config (via env), the JSON envelope
 *      reports `modelId = "M3"` and `detected = true`.
 *   2. With no fixture (the default z-code config path under the
 *      mocked tmpdir does not exist), the CLI reports `modelId = null`
 *      and `detected = false` — i.e. graceful degradation, no
 *      exception, no exit code 1.
 *
 * Both behaviors are required for the slice-C acceptance criteria
 * (verify-pipeline gate expects `peaks ide model --current` to be
 * runnable end-to-end in a real z-code environment AND in CI).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, parseJsonOutput, runCommand } from '../cli-program-test-utils.js';

let tmpDir: string;
const ORIGINAL_CONFIG_PATH = process.env.PEAKS_ZCODE_CONFIG_PATH;
const ORIGINAL_ACTIVE_PROVIDER = process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-cli-ide-'));
});

afterEach(() => {
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.PEAKS_ZCODE_CONFIG_PATH;
  else process.env.PEAKS_ZCODE_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  if (ORIGINAL_ACTIVE_PROVIDER === undefined) delete process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID;
  else process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID = ORIGINAL_ACTIVE_PROVIDER;
  rmSync(tmpDir, { recursive: true, force: true });
});

type IdeModelCurrentData = {
  modelId: string | null;
  detected: boolean;
  registeredAdapters: readonly string[];
};

describe('peaks ide model --current', () => {
  it('CLI-1: returns M3 via fixture (matches real z-code user config)', async () => {
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

    const result = await runCommand(['ide', 'model', '--current', '--json'], {
      PEAKS_ZCODE_CONFIG_PATH: cfgPath,
    });
    const output = parseJsonOutput<IdeModelCurrentData>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.modelId).toBe('M3');
    expect(output.data.detected).toBe(true);
    expect(output.data.registeredAdapters).toContain('zcode');
  });

  it('CLI-2: with no fixture present, returns detected=false (graceful degradation)', async () => {
    // tmpDir exists but no config.json inside it → adapter returns undefined.
    const result = await runCommand(['ide', 'model', '--current', '--json'], {
      PEAKS_ZCODE_CONFIG_PATH: join(tmpDir, 'no-such-file.json'),
    });
    const output = parseJsonOutput<IdeModelCurrentData>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.modelId).toBeNull();
    expect(output.data.detected).toBe(false);
  });

  it('CLI-3: missing verb → structured MISSING_VERB error envelope', async () => {
    const result = await runCommand(['ide', 'model', '--json']);
    const output = parseJsonOutput<{
      registeredAdapters?: readonly string[];
    }>(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('MISSING_VERB');
    // Even on error, the envelope surfaces the registered adapter
    // list so the LLM caller can decide what to do next.
    expect(output.data.registeredAdapters ?? []).toContain('zcode');
  });

  it('CLI-4: `peaks ide` registered at top-level (no nested conflict)', () => {
    const harness = createHarness();
    const ideCmd = harness.program.commands.find((c) => c.name() === 'ide');
    expect(ideCmd).toBeDefined();
    expect(ideCmd?.description()).toContain('IDE adapter');
  });

  it('CLI-5: env override (PEAKS_ZCODE_ACTIVE_PROVIDER_UUID) wins over auto-detect', async () => {
    const fixture = {
      provider: {
        'builtin:zai': { name: 'Z.ai', enabled: true, models: { 'GLM-5.2': {} } },
        'override-uuid': { name: 'Override', models: { 'OVERRIDE-Model': {} } },
      },
    };
    const cfgPath = join(tmpDir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify(fixture), 'utf8');

    const result = await runCommand(['ide', 'model', '--current', '--json'], {
      PEAKS_ZCODE_CONFIG_PATH: cfgPath,
      PEAKS_ZCODE_ACTIVE_PROVIDER_UUID: 'override-uuid',
    });
    const output = parseJsonOutput<IdeModelCurrentData>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.modelId).toBe('OVERRIDE-Model');
    expect(output.data.detected).toBe(true);
  });
});
