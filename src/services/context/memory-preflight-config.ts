import type { ProjectPreferences } from '../preferences/preferences-types.js';

export interface MemoryPreflightConfig {
  readonly enabled: boolean;
  readonly maxTokens: number;
  readonly listCap: number;
  readonly contentCacheBytes: number;
}

/**
 * Loose input type for `resolveMemoryPreflightConfig`. Accepts either a
 * full `ProjectPreferences` (e.g. the output of `loadPreferences()`) or
 * any object that at minimum carries `memoryPreflight`. Lets callers
 * pass a partial overlay literal — e.g. `{}` or `{ memoryPreflight: {...} }`
 * — without having to construct a fully-populated preferences fixture.
 *
 * Downstream tasks (orchestrator service, dispatch hook) should import
 * this alias rather than re-deriving the structural type.
 */
export type MemoryPreflightPrefsInput =
  | ProjectPreferences
  | Pick<ProjectPreferences, 'memoryPreflight'>;

const DEFAULTS = Object.freeze({
  enabled: true,
  maxTokens: 1200,
  listCap: 12,
  contentCacheBytes: 6000,
});

const LIST_CAP_MIN = 1;
const LIST_CAP_MAX = 50;

function asFiniteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

export function resolveMemoryPreflightConfig(
  prefs: MemoryPreflightPrefsInput
): MemoryPreflightConfig {
  const m = prefs.memoryPreflight ?? {};
  const listCapRaw = asFiniteInt(m.listCap, DEFAULTS.listCap);
  return {
    enabled: m.enabled === false ? false : DEFAULTS.enabled,
    maxTokens: m.maxTokens && m.maxTokens > 0 ? m.maxTokens : DEFAULTS.maxTokens,
    listCap: Math.min(LIST_CAP_MAX, Math.max(LIST_CAP_MIN, listCapRaw)),
    contentCacheBytes:
      m.contentCacheBytes && m.contentCacheBytes > 0
        ? m.contentCacheBytes
        : DEFAULTS.contentCacheBytes,
  };
}
