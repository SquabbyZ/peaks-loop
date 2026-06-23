import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_PREFERENCES,
  FANOUT_MODES,
  isFanoutMode,
  PREFERENCES_SCHEMA_VERSION,
  type HeadroomPreferences,
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
  // Slice 2026-06-24-audit-5th-p2: fail fast on any fanout mode value
  // outside the closed set `['fan-out']`. The previous 'serial' opt-out
  // was removed by user direction — a saved `defaultMode = 'serial'`
  // (or a hand-edited unknown value) now throws at load rather than
  // being silently coerced, so callers see the break loudly and can
  // remove the block from preferences.json. Migration of legacy v2
  // preferences.json files with `fanout = {defaultMode: 'serial'}` is
  // handled by `migratePreferences` further down — that path rewrites
  // to `defaultMode: 'fan-out'` before `loadPreferences` re-reads.
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
        `PREFERENCES_FANOUT_INVALID: fanout.defaultMode must be one of ${known} (got ${JSON.stringify(fanoutObj.defaultMode)}) in ${filePath}. The 'serial' opt-out was removed in 2.8.4 — remove the fanout block to use the fan-out default.`
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
  // Slice 2026-06-23-audit-4th #A2: use tmp + rename so a crash
  // mid-write cannot leave a zero-byte or half-written preferences
  // file. Before the fix, a power-cut or OOM-kill between
  // writeFileSync's open and the final byte would leave
  // .peaks/preferences.json unreadable, and the next loadPreferences
  // would throw PREFERENCES_JSON_INVALID with no recovery path.
  // The tmp+rename pattern matches dispatch-record-writer.ts:409-420
  // and shared-channel.ts:336-349.
  writeAtomic(filePath, merged);
  return merged;
}

/**
 * Atomic write helper for preferences.json. Writes to `<path>.tmp-<pid>-<ts>`
 * and renames over the target. On Windows, `rename` is atomic for files
 * on the same volume; on POSIX, `rename(2)` is atomic by spec.
 */
export function writeAtomic(filePath: string, prefs: ProjectPreferences): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
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

/**
 * Slice 2026-06-23-audit-4th #C1: migrate a legacy preferences.json
 * (any `schema_version` older than PREFERENCES_SCHEMA_VERSION) to the
 * current shape. Returns the migrated object + a list of changes
 * applied (for surfacing in the CLI envelope and the migration log).
 *
 * The v1 → v2 mapping fills in the `headroom.perTouchpoint` sub-keys
 * that v1 didn't track: each touchpoint gets the v1 `headroom.defaultMode`
 * (or 'balanced' if absent), and `compressMinBytes` is preserved
 * verbatim. v1's `agentShieldPrompt` and `loopAutonomousEnabled` were
 * already present, so they carry through unchanged. The `fanout` field
 * is new in v2 — it defaults to `{ defaultMode: 'fan-out' }` so the
 * pre-v2 behavior (peak-solo SKILL instructed fan-out when ≥ 2 leaves)
 * is preserved.
 */
export type MigrateResult = {
  readonly fromVersion: string;
  readonly toVersion: typeof PREFERENCES_SCHEMA_VERSION;
  readonly migrated: ProjectPreferences;
  readonly changes: readonly string[];
  readonly written: boolean;
};

export function migratePreferences(
  projectRoot: string,
  opts: { write?: boolean; now?: () => Date } = {}
): MigrateResult | null {
  const filePath = preferencesPath(projectRoot);
  if (!existsSync(filePath)) {
    return null;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `PREFERENCES_JSON_INVALID: failed to parse ${filePath}: ${(err as Error).message}`
    );
  }
  const fromVersion = typeof raw.schema_version === 'string'
    ? raw.schema_version
    : 'unknown';
  if (fromVersion === PREFERENCES_SCHEMA_VERSION) {
    return {
      fromVersion,
      toVersion: PREFERENCES_SCHEMA_VERSION,
      migrated: mergePreferences(DEFAULT_PREFERENCES, raw as Partial<ProjectPreferences>),
      changes: [],
      written: false
    };
  }

  const changes: string[] = [];
  // v1 → v2: headroom.perTouchpoint fill-in (v1 only had defaultMode).
  const headroomRaw = (raw.headroom ?? {}) as Record<string, unknown>;
  const defaultMode = isHeadroomModeString(headroomRaw.defaultMode)
    ? headroomRaw.defaultMode
    : 'balanced';
  const perTouchpoint: HeadroomPreferences['perTouchpoint'] = {
    subAgentDispatch: defaultMode,
    memorySearch: defaultMode,
    retrospectiveSearch: defaultMode,
    doctorScan: defaultMode,
    doctorRoute: 'conservative'
  };
  changes.push(
    `headroom.perTouchpoint filled in with defaultMode='${defaultMode}' (v1 lacked per-touchpoint overrides)`
  );
  if (typeof headroomRaw.compressMinBytes === 'number') {
    changes.push(`headroom.compressMinBytes preserved at ${headroomRaw.compressMinBytes}`);
  } else {
    changes.push(`headroom.compressMinBytes defaulted to 4096`);
  }
  // v1 → v2: fanout block was absent; v2 needs it. Default to the
  // pre-v2 behavior (fan-out when ≥ 2 leaves).
  if (raw.fanout === undefined) {
    changes.push(`fanout.defaultMode set to 'fan-out' (matches pre-v2 default behavior)`);
  } else if (
    typeof raw.fanout === 'object' &&
    raw.fanout !== null &&
    !Array.isArray(raw.fanout) &&
    (raw.fanout as { defaultMode?: unknown }).defaultMode === 'serial'
  ) {
    // Slice 2026-06-24-audit-5th-p2: 2.8.3-era preferences.json files
    // that opted into serial dispatch must be migrated to fan-out on
    // load. The user's directive ("禁止单 sub-agent") makes the serial
    // opt-out a breaking change for any project that used it.
    changes.push(
      `fanout.defaultMode rewrote 'serial' → 'fan-out' (the 'serial' opt-out was removed in 2.8.4; single-sub-agent dispatch is no longer permitted when DAG has >= 2 leaves)`
    );
  } else {
    changes.push(`fanout block preserved from v1`);
  }

  // Apply the migration through mergePreferences so the result is a
  // fully-valid v2 ProjectPreferences.
  const migrated = mergePreferences(DEFAULT_PREFERENCES, {
    ...(raw as Partial<ProjectPreferences>),
    headroom: {
      enabled: typeof headroomRaw.enabled === 'boolean' ? headroomRaw.enabled : true,
      defaultMode,
      perTouchpoint,
      compressMinBytes: typeof headroomRaw.compressMinBytes === 'number'
        ? headroomRaw.compressMinBytes
        : 4096
    },
    fanout: typeof raw.fanout === 'object' && raw.fanout !== null && !Array.isArray(raw.fanout)
      ? ((raw.fanout as { defaultMode?: unknown }).defaultMode === 'serial'
          ? { defaultMode: 'fan-out' as const }
          : (raw.fanout as ProjectPreferences['fanout']))
      : { defaultMode: 'fan-out' }
  });

  let written = false;
  if (opts.write === true) {
    writeAtomic(filePath, migrated);
    written = true;
  }
  return {
    fromVersion,
    toVersion: PREFERENCES_SCHEMA_VERSION,
    migrated,
    changes,
    written
  };
}

function isHeadroomModeString(value: unknown): value is 'balanced' | 'aggressive' | 'conservative' {
  return value === 'balanced' || value === 'aggressive' || value === 'conservative';
}
