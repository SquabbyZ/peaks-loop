/**
 * Slice 2.1 sample — 4-dim UT split applied to a fictional TypeScript CLI
 * module. Mirrors the doc at
 * `.peaks/standards/typescript/testing.md` (canonical convention).
 *
 * Scope of this file:
 *   - Demonstrates the 4 `describe` blocks: render / behavior /
 *     integration / a11y — one per dimension, mutually exclusive.
 *   - Defines a tiny fictional SUT (fictionalConfigLoader) INLINE so the
 *     slice stays doc-only (no production source change). This matches
 *     the doc's "apply to NEW test files only" rule.
 *   - `pnpm vitest run tests/unit/_samples/sample-4dim-module.test.ts`
 *     should pass all 8 cases.
 *
 * 4-dim convention reminder (mirror of the doc):
 *   - render       → output shape only (return value / object keys)
 *   - behavior     → input → output / state transitions / branches
 *   - integration  → mocks the boundary (fs / process / network)
 *   - a11y         → user-visible signal (error message text / exit code)
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ─── Fictional SUT (inline so the sample is self-contained) ────────────

export interface FictionalConfig {
  readonly name: string;
  readonly port: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class FictionalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FictionalConfigError';
  }
}

/**
 * Load a config from a JSON file. Throws FictionalConfigError when the
 * file is missing. Returns the parsed config otherwise. Real impl would
 * JSON.parse + validate keys; the sample keeps the body short to focus
 * the test on the 4-dim split.
 */
export function fictionalConfigLoader(filePath: string, _env: NodeJS.ProcessEnv): FictionalConfig {
  if (!existsSync(filePath)) {
    throw new FictionalConfigError(`config file not found: ${filePath}`);
  }
  return { name: 'sample', port: 8080, logLevel: 'info' };
}

// ─── Shared fixture: write 1 valid config file for render/behavior ─────

let tmpDir = '';
let validConfigPath = '';

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-4dim-sample-'));
  validConfigPath = join(tmpDir, 'valid.json');
  writeFileSync(validConfigPath, JSON.stringify({ name: 'real', port: 9090, logLevel: 'debug' }), 'utf8');
});

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 4-dim describe blocks ─────────────────────────────────────────────

describe('render — output shape of fictionalConfigLoader()', () => {
  it('returns an object with exactly 3 keys (name, port, logLevel)', () => {
    const cfg = fictionalConfigLoader(validConfigPath, {});
    expect(Object.keys(cfg).sort()).toEqual(['logLevel', 'name', 'port']);
  });

  it('returns a FictionalConfig (readonly fields preserved)', () => {
    const cfg = fictionalConfigLoader(validConfigPath, {});
    expect(cfg).toMatchObject({
      name: expect.any(String),
      port: expect.any(Number),
      logLevel: expect.stringMatching(/^(debug|info|warn|error)$/),
    });
  });
});

describe('behavior — input → output transitions of fictionalConfigLoader()', () => {
  it('happy path: valid file + valid env returns the parsed config', () => {
    const cfg = fictionalConfigLoader(validConfigPath, {});
    expect(cfg.port).toBeGreaterThan(0);
  });

  it('boundary: returned port is finite (boundary detection)', () => {
    const cfg = fictionalConfigLoader(validConfigPath, {});
    expect(Number.isFinite(cfg.port)).toBe(true);
  });

  it('control flow: missing file throws FictionalConfigError', () => {
    expect(() => fictionalConfigLoader(join(tmpDir, 'never-exists.json'), {})).toThrow(FictionalConfigError);
  });
});

describe('integration — boundary with the file system', () => {
  it('reads a real JSON config file from disk', () => {
    const cfg = fictionalConfigLoader(validConfigPath, {});
    expect(cfg.name).toBe('sample'); // inline impl returns hard-coded sample
  });

  it('does not write to the file system (read-only boundary)', () => {
    const before = existsSync(validConfigPath);
    fictionalConfigLoader(validConfigPath, {});
    const after = existsSync(validConfigPath);
    expect(after).toBe(before); // file untouched
  });
});

describe('a11y — user-visible error signal of fictionalConfigLoader()', () => {
  it('error message names the missing file path (human-actionable)', () => {
    const missing = join(tmpDir, 'missing-a11y.json');
    expect(() => fictionalConfigLoader(missing, {})).toThrow(
      /config file not found: .*missing-a11y\.json/
    );
  });

  it('error class is named FictionalConfigError (catchable by callers)', () => {
    const missing = join(tmpDir, 'another-missing.json');
    try {
      fictionalConfigLoader(missing, {});
      expect.fail('expected throw');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(FictionalConfigError);
      expect((e as Error).name).toBe('FictionalConfigError');
    }
  });
});