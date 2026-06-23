import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_PREFERENCES,
  FANOUT_MODES,
  isFanoutMode,
  PREFERENCES_SCHEMA_VERSION,
  type ProjectPreferences,
} from './preferences-types.js';

const PREFS_REL_PATH = '.peaks/preferences.json';

export { DEFAULT_PREFERENCES, PREFERENCES_SCHEMA_VERSION };
export type { ProjectPreferences } from './preferences-types.js';

export function preferencesPath(projectRoot: string): string {
  return join(projectRoot, PREFS_REL_PATH);
}

export function loadPreferences(projectRoot: string): ProjectPreferences {
  const filePath = preferencesPath(projectRoot);
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_PREFERENCES);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `PREFERENCES_JSON_INVALID: failed to parse ${filePath}: ${(err as Error).message}`
    );
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>).schema_version !== PREFERENCES_SCHEMA_VERSION
  ) {
    throw new Error(
      `PREFERENCES_SCHEMA_MISMATCH: expected schema_version=${PREFERENCES_SCHEMA_VERSION} in ${filePath}, got ${(raw as Record<string, unknown> | null)?.schema_version}`
    );
  }
  // Slice 2026-06-23-audit-p0-cleanup: fail fast on a stale fanout mode
  // value (e.g. hand-edited "parallel") so the consumer never sees a
  // value outside the documented closed set. Fall back to the default
  // rather than throwing — callers can opt to honor the saved intent
  // (default fan-out) without crashing.
  const rawObj = raw as Record<string, unknown>;
  if (
    typeof rawObj.fanout === 'object' &&
    rawObj.fanout !== null &&
    !Array.isArray(rawObj.fanout)
  ) {
    const fanoutObj = rawObj.fanout as Record<string, unknown>;
    if ('defaultMode' in fanoutObj && !isFanoutMode(fanoutObj.defaultMode)) {
      const known = FANOUT_MODES.join(' | ');
      throw new Error(
        `PREFERENCES_FANOUT_INVALID: fanout.defaultMode must be one of ${known} (got ${JSON.stringify(fanoutObj.defaultMode)}) in ${filePath}`
      );
    }
  }
  return mergePreferences(DEFAULT_PREFERENCES, raw as Partial<ProjectPreferences>);
}

export function savePreferences(
  projectRoot: string,
  overrides: Partial<ProjectPreferences>
): ProjectPreferences {
  const filePath = preferencesPath(projectRoot);
  const current = loadPreferences(projectRoot);
  const merged = mergePreferences(current, overrides);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

function mergePreferences(
  base: ProjectPreferences,
  overrides: Partial<ProjectPreferences>
): ProjectPreferences {
  const definedEntries = Object.entries(overrides).filter(
    ([, value]) => value !== undefined
  );
  // Shallow merge at the top level, BUT merge the `fanout` object
  // deeply so a partial override like `{"fanout": {"perTouchpoint": {...}}}`
  // does not silently drop `defaultMode`. Slice
  // 2026-06-23-audit-p0-cleanup: today the fanout schema is 1 level
  // deep, so shallow merge happens to be safe — but the field is
  // likely to grow (perTouchpoint / perRole are obvious next additions),
  // and a future bug fix should not silently regress opt-out callers
  // that already specified `defaultMode` in their preferences.json.
  const shallow = {
    ...base,
    ...Object.fromEntries(definedEntries),
  };
  const overrideFanout = (overrides as { fanout?: unknown }).fanout;
  if (
    overrideFanout !== undefined &&
    typeof overrideFanout === 'object' &&
    overrideFanout !== null &&
    !Array.isArray(overrideFanout)
  ) {
    shallow.fanout = {
      ...base.fanout,
      ...(overrideFanout as Partial<typeof base.fanout>)
    };
  }
  return {
    ...shallow,
    schema_version: PREFERENCES_SCHEMA_VERSION,
  };
}
