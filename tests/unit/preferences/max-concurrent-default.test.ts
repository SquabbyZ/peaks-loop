/**
 * Slice 2026-06-24-efficiency-4p-bundle / G3 (P1.1)
 *
 * Locks DEFAULT_PREFERENCES.swarmSpeculative.maxConcurrent at 3 and proves
 * that explicit user overrides in `.peaks/preferences.json` still win
 * over the bumped default (preserved behavior — backward compatibility).
 *
 * Coverage target: new code branch ≥ 90%.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_SCHEMA_VERSION,
  loadPreferences,
  migratePreferences,
  preferencesPath,
  savePreferences,
} from '../../../src/services/preferences/preferences-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-mc-'));
}

function writePrefs(project: string, payload: Record<string, unknown>): void {
  const dir = join(project, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify(payload, null, 2));
}

describe('AC-3 swarmSpeculative.maxConcurrent default = 3', () => {
  // (a) No file → defaults yield maxConcurrent === 3
  test('loadPreferences returns maxConcurrent=3 when no preferences file exists', () => {
    const project = makeProject();
    try {
      const prefs = loadPreferences(project);
      expect(prefs.swarmSpeculative.maxConcurrent).toBe(3);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // (b) Explicit user override maxConcurrent=2 wins over default 3
  test('explicit maxConcurrent=2 in preferences.json overrides default', () => {
    const project = makeProject();
    try {
      writePrefs(project, {
        schema_version: PREFERENCES_SCHEMA_VERSION,
        swarmSpeculative: { enabled: true, maxConcurrent: 2, minHitRate: 0.5 },
      });
      const prefs = loadPreferences(project);
      expect(prefs.swarmSpeculative.maxConcurrent).toBe(2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // (c) Any positive integer accepted (here 4)
  test('explicit maxConcurrent=4 is preserved verbatim', () => {
    const project = makeProject();
    try {
      writePrefs(project, {
        schema_version: PREFERENCES_SCHEMA_VERSION,
        swarmSpeculative: { enabled: true, maxConcurrent: 4, minHitRate: 0.5 },
      });
      const prefs = loadPreferences(project);
      expect(prefs.swarmSpeculative.maxConcurrent).toBe(4);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // (d) Schema mismatch → PREFERENCES_SCHEMA_MISMATCH (no silent bypass)
  test('schema_version mismatch throws PREFERENCES_SCHEMA_MISMATCH (no bypass)', () => {
    const project = makeProject();
    try {
      writePrefs(project, {
        schema_version: '1.0.0',
        swarmSpeculative: { enabled: true, maxConcurrent: 7, minHitRate: 0.5 },
      });
      expect(() => loadPreferences(project)).toThrow(/PREFERENCES_SCHEMA_MISMATCH/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // (e) After migratePreferences — written file carries maxConcurrent=3
  test('migratePreferences --write produces maxConcurrent=3 in the file', () => {
    const project = makeProject();
    try {
      writePrefs(project, {
        schema_version: '1.0.0',
        // No swarmSpeculative override → migration fills in defaults
      });
      const result = migratePreferences(project, { write: true });
      expect(result).not.toBeNull();
      expect(result?.written).toBe(true);
      expect(result?.migrated.swarmSpeculative.maxConcurrent).toBe(3);
      // On-disk file reflects the new default
      expect(existsSync(preferencesPath(project))).toBe(true);
      const onDisk = JSON.parse(readFileSync(preferencesPath(project), 'utf8'));
      expect(onDisk.swarmSpeculative.maxConcurrent).toBe(3);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // (f) DEFAULT_PREFERENCES constant itself locks maxConcurrent=3
  test('DEFAULT_PREFERENCES.swarmSpeculative.maxConcurrent is locked at 3', () => {
    expect(DEFAULT_PREFERENCES.swarmSpeculative.maxConcurrent).toBe(3);
  });

  // (g) savePreferences round-trip: defaults persist with no override
  test('savePreferences preserves maxConcurrent=3 when no override given', () => {
    const project = makeProject();
    try {
      const merged = savePreferences(project, {});
      expect(merged.swarmSpeculative.maxConcurrent).toBe(3);
      const reread = loadPreferences(project);
      expect(reread.swarmSpeculative.maxConcurrent).toBe(3);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});