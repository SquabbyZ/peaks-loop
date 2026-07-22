import type { ProjectPreferences } from '../preferences/preferences-types.js';

export interface MemoryPreflightConfig {
  readonly enabled: boolean;
  readonly maxTokens: number;
  readonly listCap: number;
  readonly contentCacheBytes: number;
}

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
  prefs: ProjectPreferences
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
