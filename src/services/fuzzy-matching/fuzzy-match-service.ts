import { Fzf, type FzfResultItem } from 'fzf';
import type { FuzzyMatchOptions, FuzzyMatchResult } from './types.js';

/**
 * Default limit for fuzzy-match. Aligned with the spec's "--limit default 6".
 */
const DEFAULT_LIMIT = 6;

/**
 * String-overload: when `items` is an array of strings, the searchable text
 * is the string itself. No keyFn is required.
 */
export function fuzzyMatch<T extends string>(
  query: string,
  items: T[],
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult<T>[] {
  return fuzzyMatchWithKey(query, items, { ...options, keyFn: (item: T) => item });
}

/**
 * Object-overload: caller provides a `keyFn` that extracts the searchable
 * text from each item. The keyFn is invoked once per item per call; the
 * caller is responsible for ensuring the result is stable (e.g., don't
 * concatenate mutable fields).
 */
export function fuzzyMatchWithKey<T>(
  query: string,
  items: T[],
  options: FuzzyMatchOptions & { keyFn: (item: T) => string }
): FuzzyMatchResult<T>[] {
  const { keyFn } = options;
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (items.length === 0) return [];

  // Empty query: surface all items (capped at limit) with neutral score and
  // empty positions. Useful for "list" or "preview" use cases where the
  // caller wants a deterministic top-N without a query.
  if (query === '') {
    return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  }

  const fzf = new Fzf(items, {
    selector: keyFn,
    limit,
    // Per spec: default is case-insensitive (NOT fzf's smart-case).
    // The user explicitly opts into case-sensitive via caseSensitive:true.
    casing: options.caseSensitive === true ? 'case-sensitive' : 'case-insensitive',
    // normalize:true (default) strips diacritics; fzf returns more matches
    // for non-ASCII text this way, which is what we want for
    // bilingual (zh-CN + en) memory entries.
  });

  const raw: FzfResultItem<T>[] = fzf.find(query);
  if (raw.length === 0) return [];

  // fzf-for-js score is "higher = better". Normalize so the top of the
  // current batch is exactly 1.0 and others are in [0, 1].
  // When the top score is 0 (degenerate — exact-character-only query that
  // still matched somehow), fall back to 1.0 to avoid divide-by-zero.
  const topScore = raw[0]?.score ?? 1;
  const denom = topScore > 0 ? topScore : 1;

  return raw.slice(0, limit).map((entry: FzfResultItem<T>) => {
    const score = topScore > 0 ? Number((entry.score / denom).toFixed(4)) : 1;
    // positions is a Set<number> in fzf-for-js; convert to a sorted array
    // so the JSON envelope is stable and human-readable.
    const positions = [...entry.positions].sort((a, b) => a - b);
    return { item: entry.item, score, positions };
  });
}
