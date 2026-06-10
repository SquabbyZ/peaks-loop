import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_PREFERENCES,
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
  return {
    ...base,
    ...Object.fromEntries(definedEntries),
    schema_version: PREFERENCES_SCHEMA_VERSION,
  };
}
