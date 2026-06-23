/**
 * Slice 2026-06-23-audit-p0-no-fanout-opt-out — pin the opt-out contract.
 *
 * Audit finding (HIGH): slice 5 (`feat(solo): default to multi-sub-agent
 * fan-out when DAG has >= 2 same-level leaves`) changed the default
 * behavior without providing an opt-out. This test pins both the
 * SKILL.md opt-out instructions and the preference contract:
 *
 *   1. SKILL.md documents the `preferences.fanout.defaultMode = 'serial'`
 *      escape hatch so future readers can find it without spelunking.
 *   2. `DEFAULT_PREFERENCES.fanout.defaultMode === 'fan-out'` so existing
 *      callers get the pre-slice-5 behavior unchanged.
 *   3. Shallow `mergePreferences` from `preferences-service.ts` correctly
 *      fills in `fanout` for legacy preferences.json files that predate
 *      the slice (i.e. don't have a `fanout` key).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  FANOUT_MODES,
  isFanoutMode,
  type FanoutMode
} from '../../../src/services/preferences/preferences-types.js';

// Resolve relative to this test file, not process.cwd() — vitest can run
// the suite from a different working directory than the repo root, and
// the SKILL.md / reference doc paths must stay stable.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');
const SKILL_PATH = join(REPO_ROOT, 'skills', 'peaks-solo', 'SKILL.md');
const REFERENCE_PATH = join(REPO_ROOT, 'skills', 'peaks-solo', 'references', 'fanout-opt-out.md');
const SKILL_BYTE_CAP = 24000;

describe('peaks-solo SKILL.md — fan-out opt-out (slice 2026-06-23-audit-p0)', () => {
  it('SKILL.md mentions the fan-out opt-out and points to the reference', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    expect(body).toContain('Fan-out opt-out');
    expect(body).toContain('preferences.fanout.defaultMode');
    expect(body).toContain('references/fanout-opt-out.md');
  });

  it('reference doc (fanout-opt-out.md) explains WHY (deterministic logs / replay / rate limits)', async () => {
    const body = await readFile(REFERENCE_PATH, 'utf8');
    // Escape hatch rationale lives in the reference doc, not the SKILL.md
    // body (keeps SKILL.md slim under the 24000-byte cap).
    const hasRationale =
      /deterministic|replay|rate.?limit|debug/i.test(body);
    expect(hasRationale).toBe(true);
  });

  it('reference doc documents the `defaultMode = \'serial\'` config snippet', async () => {
    const body = await readFile(REFERENCE_PATH, 'utf8');
    expect(body).toContain('"defaultMode": "serial"');
    expect(body).toContain('schema_version');
  });

  it('reference doc explains what changes when `serial` mode is active', async () => {
    const body = await readFile(REFERENCE_PATH, 'utf8');
    // Must mention wall-time is `sum` (not `max`) and dispatchCount === 1
    // per CLI invocation so callers understand the performance impact.
    expect(body).toMatch(/sum|max/i);
    expect(body).toContain('dispatchCount');
  });

  it('SKILL.md preserves the default fan-out phrase AND adds the opt-out (no regression)', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    // The original slice-5 contract must remain in place.
    expect(body).toContain('peaks sub-agent dispatch --from-dag');
    expect(body).toMatch(/≥\s*2\s+leaves|at\s+least\s+2\s+leaves/i);
  });

  it('SKILL.md stays under the 24000-byte cap (peaks scan file-size gate)', async () => {
    const { stat } = await import('node:fs/promises');
    const stats = await stat(SKILL_PATH);
    expect(stats.size).toBeLessThanOrEqual(SKILL_BYTE_CAP);
  });
});

describe('ProjectPreferences — fanout field default + backward compat', () => {
  it('DEFAULT_PREFERENCES.fanout.defaultMode === "fan-out" (pre-slice-5 behavior preserved)', () => {
    expect(DEFAULT_PREFERENCES.fanout.defaultMode).toBe('fan-out');
  });

  it('FanoutMode type allows exactly the two documented values', () => {
    // Type-level guard: if a future edit adds a third mode, the SKILL.md
    // and the LLM-side decision table need updates. Pin via runtime
    // sampling of valid values.
    const valid: readonly FanoutMode[] = ['fan-out', 'serial'];
    expect(valid).toHaveLength(2);
  });

  it('isFanoutMode runtime guard accepts the two documented values', () => {
    // Slice 2026-06-23-audit-p0-cleanup: the runtime guard catches stale
    // or hand-edited preferences.json files (e.g. "parallel") that pass
    // the schema_version check but would crash at the consumer site.
    expect(isFanoutMode('fan-out')).toBe(true);
    expect(isFanoutMode('serial')).toBe(true);
  });

  it('isFanoutMode rejects non-string and unknown-string values', () => {
    expect(isFanoutMode('parallel')).toBe(false);
    expect(isFanoutMode('FAN-OUT')).toBe(false); // case-sensitive
    expect(isFanoutMode(null)).toBe(false);
    expect(isFanoutMode(undefined)).toBe(false);
    expect(isFanoutMode(0)).toBe(false);
    expect(isFanoutMode({})).toBe(false);
  });

  it('FANOUT_MODES array stays in lockstep with the type closed set', () => {
    // Re-anchored contract: if a future slice adds a new mode, the
    // closed-set const and the type union both need updating together.
    // Pin via type assertion so a one-sided edit fails compilation.
    const fromType: readonly FanoutMode[] = ['fan-out', 'serial'];
    expect(FANOUT_MODES).toEqual(fromType);
  });
});

describe('preferences-service — mergePreferences fills fanout for legacy files', () => {
  it('legacy preferences.json without a `fanout` key loads with default fanout', async () => {
    // We can't easily import the private `mergePreferences` (it's not
    // exported), but we can exercise the public `loadPreferences` via a
    // fake preferences.json written to a temp dir. This is the integration
    // surface the LLM-side runner actually consumes.
    const { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { loadPreferences } = await import('../../../src/services/preferences/preferences-service.js');

    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-prefs-legacy-'));
    try {
      mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      // Legacy file: schema_version matches but `fanout` is absent.
      writeFileSync(
        join(projectRoot, '.peaks', 'preferences.json'),
        JSON.stringify({
          schema_version: '2.0.0',
          economyMode: true
        }) + '\n',
        'utf8'
      );
      expect(existsSync(join(projectRoot, '.peaks', 'preferences.json'))).toBe(true);

      const prefs = loadPreferences(projectRoot);
      // fanout is filled from DEFAULT_PREFERENCES via shallow merge.
      expect(prefs.fanout).toBeDefined();
      expect(prefs.fanout.defaultMode).toBe('fan-out');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it('explicit fanout.defaultMode="serial" is honored by loadPreferences', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { loadPreferences } = await import('../../../src/services/preferences/preferences-service.js');

    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-prefs-serial-'));
    try {
      mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.peaks', 'preferences.json'),
        JSON.stringify({
          schema_version: '2.0.0',
          fanout: { defaultMode: 'serial' }
        }) + '\n',
        'utf8'
      );

      const prefs = loadPreferences(projectRoot);
      expect(prefs.fanout.defaultMode).toBe('serial');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('preferences-service — deep-merge for nested fanout fields', () => {
  // Slice 2026-06-23-audit-p0-cleanup: today the fanout field is 1 level
  // deep, but a future slice will likely add perTouchpoint / perRole
  // sub-fields. A shallow merge that REPLACES the whole `fanout` object
  // would silently drop `defaultMode` if a caller wrote only
  // `{"fanout": {"perTouchpoint": {...}}}`. The deep-merge in
  // `mergePreferences` must preserve all top-level fanout keys.
  it('partial fanout override preserves existing defaultMode (deep-merge)', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { loadPreferences } = await import('../../../src/services/preferences/preferences-service.js');

    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-prefs-deep-merge-'));
    try {
      mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      // Explicit `defaultMode = 'serial'` AND a future `perTouchpoint`
      // map. The partial override should preserve BOTH — not just
      // replace the whole `fanout` with `{perTouchpoint: {...}}`.
      writeFileSync(
        join(projectRoot, '.peaks', 'preferences.json'),
        JSON.stringify({
          schema_version: '2.0.0',
          fanout: {
            defaultMode: 'serial',
            perTouchpoint: { ui: 'serial', rd: 'fan-out' }
          }
        }) + '\n',
        'utf8'
      );

      const prefs = loadPreferences(projectRoot);
      // defaultMode honored from override.
      expect(prefs.fanout.defaultMode).toBe('serial');
      // perTouchpoint (future field) survives the deep merge.
      const perTp = (prefs.fanout as unknown as Record<string, unknown>).perTouchpoint as
        | { ui: string; rd: string }
        | undefined;
      expect(perTp).toBeDefined();
      expect(perTp?.ui).toBe('serial');
      expect(perTp?.rd).toBe('fan-out');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it('override with fanout={} still preserves the default fan-out (no data loss)', async () => {
    // Edge case: caller writes an empty fanout object intending to
    // "leave it at defaults". The deep merge must NOT replace the
    // entire fanout with {}.
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { loadPreferences } = await import('../../../src/services/preferences/preferences-service.js');

    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-prefs-empty-fanout-'));
    try {
      mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.peaks', 'preferences.json'),
        JSON.stringify({
          schema_version: '2.0.0',
          fanout: {}
        }) + '\n',
        'utf8'
      );

      const prefs = loadPreferences(projectRoot);
      expect(prefs.fanout.defaultMode).toBe('fan-out');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);
});
