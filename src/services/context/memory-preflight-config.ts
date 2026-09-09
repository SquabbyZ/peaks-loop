import type { ProjectPreferences } from '../preferences/preferences-types.js';

export interface MemoryPreflightConfig {
  readonly enabled: boolean;
  /**
   * Back-compat (slice 2026-07-22): the original single budget knob.
   * Semantics are unchanged — it is the *token* cap, converted to bytes
   * as `maxTokens * 4` when `maxBytes` is not set. Do NOT drop this key:
   * existing `.peaks/preferences.json` files set it.
   */
  readonly maxTokens: number;
  /** Back-compat: hot-tier item cap fallback when `hotItemCap` is absent. */
  readonly listCap: number;
  readonly contentCacheBytes: number;

  // ── Slice 2026-09-09-memory-retrieval: tiered budget ──────────────────
  /** Hard byte cap on the composed block. Defaults to `maxTokens * 4`. */
  readonly maxBytes: number;
  /** Max hot (standing rule / feedback) items injected. Default 10. */
  readonly hotItemCap: number;
  /** Max warm (project / reference) items injected; 0 disables warm. Default 4. */
  readonly warmItemCap: number;
  /**
   * Warm relevance gate: minimum number of distinct task-title tokens
   * (length >= 4, stopwords removed) that must literally occur in the memo
   * text before it is warm-eligible. 1 (default) means "at least one task
   * word appears in the memo"; raise it to tighten the gate. Hot entries
   * ignore this gate — they are always eligible.
   */
  readonly warmMinTokenHits: number;
  /**
   * Soft wall-clock budget (ms) for the whole selection step. When exceeded
   * the preflight degrades to hot-only (or unranked hot) rather than
   * blocking a dispatch. 0 forces the hot-only path deterministically.
   */
  readonly selectionTimeBudgetMs: number;
  /**
   * Gate for inlining memo *bodies* (via `cacheMemoContent`). Off by
   * default: the preflight emits a compact index and the sub-agent drills
   * down with `Read` against `sourcePath`.
   */
  readonly includeBodies: boolean;
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
  hotItemCap: 10,
  warmItemCap: 4,
  warmMinTokenHits: 1,
  selectionTimeBudgetMs: 200,
  includeBodies: false,
});

const LIST_CAP_MIN = 1;
const LIST_CAP_MAX = 50;
const ITEM_CAP_MAX = 100;

function asFiniteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveMemoryPreflightConfig(
  prefs: MemoryPreflightPrefsInput
): MemoryPreflightConfig {
  const m = prefs.memoryPreflight ?? {};
  const listCapRaw = asFiniteInt(m.listCap, DEFAULTS.listCap);
  const listCap = clamp(listCapRaw, LIST_CAP_MIN, LIST_CAP_MAX);
  const maxTokens = m.maxTokens && m.maxTokens > 0 ? m.maxTokens : DEFAULTS.maxTokens;
  return {
    enabled: m.enabled === false ? false : DEFAULTS.enabled,
    maxTokens,
    listCap,
    contentCacheBytes:
      m.contentCacheBytes && m.contentCacheBytes > 0
        ? m.contentCacheBytes
        : DEFAULTS.contentCacheBytes,
    // `maxBytes` wins when explicitly set; otherwise the legacy token cap
    // is preserved verbatim (maxTokens * 4 bytes).
    maxBytes:
      m.maxBytes && m.maxBytes > 0 ? Math.trunc(m.maxBytes) : maxTokens * 4,
    // `hotItemCap` falls back to the legacy `listCap` only when the caller
    // explicitly set `listCap`; otherwise the tiered default (10) applies.
    hotItemCap: clamp(
      m.hotItemCap !== undefined
        ? asFiniteInt(m.hotItemCap, DEFAULTS.hotItemCap)
        : m.listCap !== undefined
          ? listCap
          : DEFAULTS.hotItemCap,
      LIST_CAP_MIN,
      ITEM_CAP_MAX
    ),
    warmItemCap: clamp(
      asFiniteInt(m.warmItemCap, DEFAULTS.warmItemCap),
      0,
      ITEM_CAP_MAX
    ),
    warmMinTokenHits: clamp(
      asFiniteInt(m.warmMinTokenHits, DEFAULTS.warmMinTokenHits),
      1,
      ITEM_CAP_MAX
    ),
    selectionTimeBudgetMs: clamp(
      asFiniteNumber(m.selectionTimeBudgetMs, DEFAULTS.selectionTimeBudgetMs),
      0,
      10_000
    ),
    includeBodies:
      m.includeBodies === true ? true : DEFAULTS.includeBodies,
  };
}
