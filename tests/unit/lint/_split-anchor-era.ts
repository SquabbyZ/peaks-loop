// tests/unit/lint/_split-anchor-era.ts
//
// The ERA half of `baseline-split-equivalence.test.ts`, in a file of its own.
//
// WHY A FILE OF ITS OWN. That test is a collected, capped file under `tests/` (500 raw
// lines, 498 at the commit before the comment rows landed) and the era question grew it:
// a pinned reference program needs its own canonical key list, the rows that list gained
// since, and the projection bound that says what may therefore be ignored. The pattern is
// `_monotonic-module-set.ts` and `_file-size-hooks-walk.ts`: the machinery lives here, the
// scenarios live there, and a sibling arm (`rescope-projection-bounded.test.ts`) reads the
// same helpers so nothing here is a second copy of a decision.
//
// WHY THE ERA IS A REAL THING AND NOT A WORKAROUND. The reference side is `77b711ff`'s
// 799-line monolith: the last commit whose generator entry is the file the wave-9 split cut.
// A monolith handed TODAY's `CEILING_KEYS` is not that program any more — it is a program
// told to sanction rows its own legs cannot measure, and it answers by refusing
// (`NOT THE CANONICAL CEILING SET`), which is what took ten arms red here when
// `commentDeadReferences` and `commentNarrativeLines` landed (rid
// `2026-10-04-comment-rows-under-ratchet`). Pinning the entry AND the list keeps the
// comparison between two complete, self-consistent programs, and leaves exactly one
// difference between them: the rows the ratchet gained in the meantime.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { gitBlobAt, rowsGainedBetween } from './_file-size-hooks-walk.js';
import { ceilingKeysInText } from './_monotonic-module-set.js';

/** The generator entry, as both sides name it. */
export const GENERATOR_REL = '.husky/peaks-gate-baseline.mjs';
/** The canonical ceiling key list. */
export const KEYS_REL = '.husky/monotonic/keys.mjs';
/**
 * `c6de09a6` IS the split, so its parent is the last commit whose
 * `peaks-gate-baseline.mjs` is still the monolith the split was cut from. `HEAD` cannot be
 * the anchor: landing the split is exactly what moves `HEAD` off the monolith, which is the
 * self-destructing-anchor defect cycle 1 had.
 */
export const PRE_SPLIT_ANCHOR_SHA = '77b711ff';
/** The files the reference side reads AS THE ANCHOR COMMIT SAW THEM. Everything else is shared. */
export const ANCHOR_ERA_FILES: readonly string[] = [GENERATOR_REL, KEYS_REL];

const blobs = new Map<string, string>();

/** One era-pinned file's bytes, read out of git once and memoised. */
export function anchorBlob(rel: string): string {
  const known = blobs.get(rel);
  if (known !== undefined) return known;
  const blob = gitBlobAt(PRE_SPLIT_ANCHOR_SHA, rel, REPO_ROOT);
  blobs.set(rel, blob);
  return blob;
}

/**
 * The rows the canonical list gained after the anchor — the ONLY rows this comparison is
 * allowed to ignore, and the ONLY ones the projection may swallow. Read from two
 * `CEILING_KEYS` literals (the anchor's own, and the tree's), never typed: a typed pair
 * would read green the day a row lands and red the day one is corrected.
 */
export function eraRows(): readonly string[] {
  return rowsGainedBetween(
    ceilingKeysInText(anchorBlob(KEYS_REL), `${PRE_SPLIT_ANCHOR_SHA}:${KEYS_REL}`),
    ceilingKeysInText(readFileSync(join(REPO_ROOT, KEYS_REL), 'utf8'), 'the working tree')
  );
}
