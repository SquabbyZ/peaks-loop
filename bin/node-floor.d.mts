/**
 * Types for `bin/node-floor.mjs`.
 *
 * The file is deliberately plain `.mjs` — it runs before `dist/` is imported, so it cannot
 * itself come from the build it is guarding against. The repo's convention for a `.mjs` a
 * test imports under `tsc` is a hand-written sibling `.d.mts` (see
 * `scripts/dist-freshness.d.mts`), and the arms in
 * `tests/unit/cli/node-floor.test.ts` are what keep this signature from drifting from the
 * implementation, since nothing typechecks the `.mjs` body itself.
 */

/** The major Node version at which `node:sqlite` is importable without a flag. */
export const MIN_NODE_MAJOR: number;

/**
 * A short reason string when `version` is below the floor; undefined when it is not, or
 * when no version was passed at all (an absent version is not evidence of an old Node).
 */
export function nodeFloorProblem(version: string): string | undefined;

/** The full operator-facing message: what is wrong, and what to do about it. */
export function nodeFloorSentence(version: string): string;
