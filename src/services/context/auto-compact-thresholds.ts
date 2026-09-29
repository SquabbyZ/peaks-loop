/**
 * Auto-compact threshold ratios and the `CompactTrigger` decision shape.
 *
 * Split out of `auto-compact-types.ts` (file-size cap campaign) so the shared
 * types module stays under the raw-line cap. `auto-compact-types.ts`
 * re-exports every name declared here, so existing importers keep using
 * `./auto-compact-types.js` unchanged.
 */

export const AUTO_COMPACT_SOFT_WARN_RATIO = 0.5;
// Part 22: auto-fire threshold (was 0.85 pre-compact zone where
// the LLM had to decide; LLM misjudged 0.85–0.95 and only fired
// at 0.95, which let the LLM time the run anyway). Lowered to
// 0.80 so peaks-loop auto-fires compact without LLM involvement
// — the LLM keeps working, peaks-loop preempts when ratio crosses
// the new threshold.
export const AUTO_COMPACT_AUTO_FIRE_RATIO = 0.8;
export const AUTO_COMPACT_PRE_COMPACT_RATIO = 0.85;
export const AUTO_COMPACT_RED_LINE_RATIO = 0.95;
export const AUTO_COMPACT_THRESHOLD_RATIO = AUTO_COMPACT_AUTO_FIRE_RATIO;

/** Single source of truth for "what should we do at ratio X?" */
export type CompactTrigger =
  | { kind: 'none' }
  | { kind: 'soft-warn'; ratio: number; message: string }
  /**
   * Part 22: auto-fire zone (0.80 ≤ ratio < 0.85). peaks-loop
   * preempts and runs `peaks code auto-compact` itself
   * without LLM involvement. The LLM is not asked to "decide";
   * the toolkit is applied synchronously.
   */
  | { kind: 'auto-fire'; ratio: number; message: string }
  /**
   * Pre-compact zone (0.85 ≤ ratio < 0.95): LLM-runner can still
   * pre-empt the compact for one in-flight sub-agent or one
   * todo row, but peaks-loop flags this as the last safe
   * window. Kept for backward compat; in practice peaks-loop
   * auto-fired at 0.80 already.
   */
  | { kind: 'pre-compact'; ratio: number; message: string; toolkitReady: true }
  /**
   * Red line (ratio ≥ 0.95): peaks-loop asks the harness to compact and says
   * it is waiting. Dispatch is NOT blocked — see `redLineRequested`.
   */
  | { kind: 'red-line'; ratio: number; message: string };
