/**
 * THE ONE COUPLED PAIR — the two ceiling rows this ratchet trades (rid-039).
 *
 * `rises` may go UP when, and only when, `falls` is STRICTLY lower in the same comparison.
 * The rule, its reason, why it is not a back door and the limit it knowingly accepts are
 * argued once, in the contract comment of `.husky/peaks-gate-baseline-monotonic.mjs`; the
 * decision table that enforces them (`compare.mjs`) reads the two names from here.
 *
 * WHY THE NAMES HAVE A FILE OF THEIR OWN, when two better-looking homes exist. Both were
 * tried and both are closed, measured rather than guessed:
 *
 *   1. NOT IN `keys.mjs`, beside the list. That file's export surface cannot grow any more.
 *      `baseline-split-equivalence.test.ts` compares the pre-split reference program with
 *      this tree, and it does that by pinning `.husky/monotonic/keys.mjs` to the era blob
 *      while sharing every OTHER module — so a symbol `keys.mjs` gained afterwards is one
 *      the reference side cannot resolve. Measured 2026-10-09, with the pair declared in
 *      `keys.mjs`: the reference side died at module load with
 *      `does not provide an export named 'COUPLED_SIZE_RISE'` and the whole file went red.
 *      Pinning `compare.mjs` to that era instead is not available either — the directory
 *      did not exist at the anchor commit.
 *
 *   2. NOT IN `compare.mjs`, the module that reads them. The same reader of the list is a
 *      reader of the POOLED module text: the arms that pin the canonical list's own row
 *      order read the walk as one string and answer "which row comes first" with
 *      `indexOf`. `compare.mjs` is pooled a full file BEFORE `keys.mjs`, so a key literal
 *      there becomes the first occurrence in the pool and moves those indices — measured
 *      2026-10-09, with the pair declared in `compare.mjs`: `monotonic-split.test.ts` and
 *      `file-size-hooks-seeding.test.ts` both went red on the pooled order, for a reason
 *      that had nothing to do with the rows they pin.
 *
 * THIS FILE IS THE THIRD HOME AND IT COSTS NOTHING: it carries no list, exports only the
 * pair, and is pooled AFTER `keys.mjs` by name — so the list's rows stay the first
 * occurrence of every key literal in the pool, and today's decision table may import it
 * because it is today's file on both sides of that comparison. The name is load-bearing:
 * renaming it to anything sorting before `keys.mjs` re-arms defect 2, loudly, through the
 * same two arms.
 */
export const COUPLED_SIZE_RISE = Object.freeze({
  rises: 'fileSizeOverCap',
  falls: 'fileSizeExcessLines'
});
