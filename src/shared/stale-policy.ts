/**
 * stale-policy — pure helper for stale detection and filtering on memory
 * and (future) retrospective entries.
 *
 * Slice 023 (R3) applies this to memory only (`peaks project memories:show`
 * and the underlying `readMemoryIndex` load path). The retrospective index
 * loader shares the same shape (`updatedAt: string`) and will be wired to
 * the same helper in a future slice.
 *
 * Behavior:
 *   - `isStale(updatedAt)` returns true when (now - updatedAt) >
 *     thresholdDays * 86_400_000. Strict greater-than: a 30-day-old
 *     entry is NOT stale.
 *   - `applyStalePolicy(entries)` adds `stale: boolean` and
 *     `ageDays: number` to every entry (computed at CLI load time, never
 *     persisted to source `.md` files) and filters out entries where
 *     `stale === true` unless `includeStale: true` is passed.
 *   - Missing `updatedAt` is treated as fresh (`stale: false`,
 *     `ageDays: 0`); we never throw, so older index.json entries that
 *     lack the field stay loadable.
 */

export interface StalePolicyOptions {
  /** Reference clock (ms since epoch). Defaults to Date.now(). Injected for testability. */
  now?: number;
  /** Threshold in days. Default 30. */
  thresholdDays?: number;
  /** When true, keep stale entries in the returned array (with `stale: true` set). Default false. */
  includeStale?: boolean;
}

export interface StaleAnnotated<T> {
  stale: boolean;
  ageDays: number;
}

export type StaleAnnotatedEntry<T> = T & StaleAnnotated<T>;

export interface StalePolicyResult<T> {
  /** Filtered array, with stale entries removed (unless includeStale=true). */
  entries: StaleAnnotatedEntry<T>[];
  /** Count of entries dropped as stale. */
  droppedCount: number;
  /** Total count before filtering. */
  totalCount: number;
}

export const DAY_MS = 86_400_000;
export const DEFAULT_STALE_DAYS = 30;

/**
 * Returns true when the entry is older than `thresholdDays`. Strict
 * greater-than: an entry exactly at the threshold is NOT stale.
 *
 * A missing or unparseable `updatedAt` is treated as fresh (false). This
 * is the "defensive — older index.json entries may lack the field" rule
 * from PRD R4.
 */
export function isStale(updatedAt: string | undefined | null, options: StalePolicyOptions = {}): boolean {
  const parsed = parseUpdatedAt(updatedAt);
  if (parsed === null) return false;
  const now = options.now ?? Date.now();
  const thresholdDays = options.thresholdDays ?? DEFAULT_STALE_DAYS;
  return now - parsed > thresholdDays * DAY_MS;
}

/**
 * Age in days between `updatedAt` and `now` (default Date.now()).
 * Returns 0 for a missing / unparseable `updatedAt`.
 */
export function ageInDays(updatedAt: string | undefined | null, now: number = Date.now()): number {
  const parsed = parseUpdatedAt(updatedAt);
  if (parsed === null) return 0;
  return Math.max(0, Math.floor((now - parsed) / DAY_MS));
}

/**
 * Apply the stale policy to a list of entries. Each entry is augmented
 * with `stale: boolean` and `ageDays: number` (immutably — a fresh
 * object is returned per entry). Stale entries are dropped from
 * `entries` unless `includeStale: true` is passed.
 */
export function applyStalePolicy<T extends { updatedAt?: string | null }>(
  entries: T[],
  options: StalePolicyOptions = {}
): StalePolicyResult<T> {
  const now = options.now ?? Date.now();
  const thresholdDays = options.thresholdDays ?? DEFAULT_STALE_DAYS;
  const includeStale = options.includeStale ?? false;

  const annotated: StaleAnnotatedEntry<T>[] = entries.map((entry) => {
    const parsed = parseUpdatedAt(entry.updatedAt ?? null);
    if (parsed === null) {
      return { ...entry, stale: false, ageDays: 0 };
    }
    const stale = now - parsed > thresholdDays * DAY_MS;
    const ageDays = Math.max(0, Math.floor((now - parsed) / DAY_MS));
    return { ...entry, stale, ageDays };
  });

  const filtered = includeStale
    ? annotated
    : annotated.filter((entry) => !entry.stale);

  return {
    entries: filtered,
    droppedCount: annotated.length - filtered.length,
    totalCount: annotated.length
  };
}

function parseUpdatedAt(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}
