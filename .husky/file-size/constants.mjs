// The shared constants this leg ratchets: the census tool, the tsx CLI, the four
// ceiling keys and their labels, the two whole-scope source strings, and the
// control-arm flag. Moved verbatim out of `.husky/peaks-gate-file-size.mjs`
// (rid `2026-10-02-wave9-file-size-split`); the entry re-exports them, so every
// caller keeps the same specifier. No import here: these are the leaf definitions.

/** The census tool: the only thing that imports the `.ts` policy and counts the scope. */
export const FS_CENSUS = 'scripts/lint/file-size-census.ts';
/** The census is TypeScript, so both callers run it through tsx. */
export const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';
/** The ceiling row this leg ratchets. */
export const FS_CEILING_KEY = 'fileSizeOverCap';
/** The label `check()` prints for the row. */
export const FS_ROW_LABEL = 'file-size over cap';
/**
 * The SECOND ceiling row this leg ratchets: the SUM of the lines over those caps,
 * not the count of the files carrying them.
 *
 * WHY IT HAD TO BE ITS OWN ROW (rid `2026-10-01-file-size-excess-row`, measured by
 * C wave 6). `fileSizeOverCap` counts FILES, so a hoist that lengthens an
 * already-over-cap file moves nothing it watches: wave 6 paid 67 lines of extra
 * excess (60,204 → 60,271) to buy 19 lint findings while `fileSizeOverCap` held at
 * 166 and `gate repo` exited 0. The number was printed in the row's scope note and
 * enforced by nothing. Folding it into the over-cap row would make one ceiling two
 * quantities — the conflation §3's per-class rows exist to prevent — so it gets its
 * own key, its own line, and this leg's already-shared measurement.
 */
export const FS_EXCESS_CEILING_KEY = 'fileSizeExcessLines';
/** The label `check()` prints for the excess row. */
export const FS_EXCESS_ROW_LABEL = 'file-size excess lines';
/** The string the census uses when it counted its own scope — i.e. the row itself. */
export const FS_WHOLE_SCOPE_SOURCE = 'git ls-files <policy dirs>';
/**
 * THE THIRD AND FOURTH ROWS THIS LEG RATCHETS: the same two quantities — files over
 * cap, lines over those caps — for the SECOND SCOPE, `.husky/`, the directory the
 * ratchet itself lives in (backlog §2.32, rid `2026-10-02-hooks-size-rows`).
 *
 * WHY THEY ARE NOT A FIFTH DIRECTORY IN THE FIRST SCOPE. `FILE_SIZE_SCOPE_DIRS`
 * covers `src`, `tests`, `packages` and `scripts`; `.husky` is in none of them, so
 * the files that implement this policy were measured by nothing — `peaks-gate.mjs`,
 * `peaks-gate-baseline.mjs` and `peaks-gate-baseline-monotonic.mjs` reached 1004 /
 * 750 / 662 raw lines in a day with no ceiling watching, while `prettierUnformatted`
 * stayed 0 because the prettier leg cannot see them either. Joining them to the main
 * rows at cap 300 would raise `fileSizeOverCap` 162 → 165 and `fileSizeExcessLines`
 * 54,318 → 55,834 (+1,516), which is a policy re-decision, and the monotonicity
 * guard refuses it correctly. So the invisible set gets its own measured pair, and
 * growth in the guard becomes a row that may only go DOWN.
 *
 * THE SAME THREE PROPERTIES AS THE PAIR ABOVE, OR LESS THAN NOTHING: seeded from the
 * census's own `hooks` block, re-derived against the inputs recorded beside them, and
 * unable to print one of the four numbers without the other three.
 */
export const FS_HOOKS_CEILING_KEY = 'fileSizeHooksOverCap';
/** The label `check()` prints for the hooks over-cap row. */
export const FS_HOOKS_ROW_LABEL = 'file-size hooks over cap';
/** The hooks scope's excess-lines row: the LINES over the hooks cap, not the files. */
export const FS_HOOKS_EXCESS_CEILING_KEY = 'fileSizeHooksExcessLines';
/** The label `check()` prints for the hooks excess row. */
export const FS_HOOKS_EXCESS_ROW_LABEL = 'file-size hooks excess lines';
/** The string the census uses when it counted the hooks scope itself. */
export const FS_HOOKS_WHOLE_SCOPE_SOURCE = 'git ls-files <hooks dirs>';

/**
 * The control-arm flag. A named-file list is not the row (see
 * `refuseScopedSubset`), so a caller that means to hand one in says so on purpose.
 */
export const FS_CONTROL_ARM_FLAG = '--control-arm';
