/**
 * Options for the generic fuzzy-match kernel.
 */
export interface FuzzyMatchOptions {
  /** Maximum number of matches to return. Default 6. */
  limit?: number;
  /** When true, matching is case-sensitive. Default false (smart-case). */
  caseSensitive?: boolean;
}

/**
 * A single fuzzy-match hit. `item` is the original entry; `score` is
 * normalized to [0, 1] with the top of the current batch at 1.0;
 * `positions` is the set of char indices in the searchable text that
 * contributed to the match.
 */
export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
  positions: number[];
}
