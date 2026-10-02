// tests/unit/lint/_monotonic-module-set.ts
//
// The pooled reader for `.husky/peaks-gate-baseline-monotonic.mjs` and its
// `.husky/monotonic/*.mjs` siblings (rid `2026-10-02-wave9-monotonic-split`).
//
// WHY A FILE OF ITS OWN. Slice 1 established the pattern in
// `gate-module-staging.test.ts`: the arms and readers that watch a SPLIT gate module
// live in helpers under `tests/`, not inside the capped collected files — the three
// `baseline-monotonicity*` guards sit at 472/477/499/496 raw against the 500 tests
// cap, and the headroom warning in this slice's brief exists because slice 1 nearly
// raised `fileSizeOverCap` by adding arms there. THIS FILE IS A `_`-prefixed helper:
// it carries no test cases; `monotonic-split.test.ts` collects the arms.
//
// WHY THE SET IS DERIVED BY WALK, NOT BY LIST. `hooksScopeFilesUnder` is the census's
// own rule over the tree, already the fixture's staging rule. Filtering it to
// "the entry plus whatever lives under `.husky/monotonic/`" reads the CURRENT tree,
// so a sibling added by a later slice joins every reader here with no edit — the
// second-copy defect (a hard-coded name list that goes stale the day the module set
// changes) is what this campaign files most often, and what the wave-7 and slice-1
// `ERR_MODULE_NOT_FOUND` incidents both were.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hooksScopeFilesUnder } from './_file-size-hooks-fixture.js';

/** The stable entry every import site names; it re-exports the public surface. */
export const MONOTONIC_ENTRY_REL = '.husky/peaks-gate-baseline-monotonic.mjs';
/** The directory the split hoisted the bodies into. */
export const MONOTONIC_DIR_PREFIX = '.husky/monotonic/';
/**
 * The canonical list's last row followed by the closing `]);` — the anchor
 * `baseline-monotonicity-seeding.test.ts` patches onto, kept as ONE pattern here so
 * the "which module carries the list" question is answered by the tree, not by a name.
 */
export const CEILING_LIST_TAIL_ANCHOR = / 'fileSizeExcessLines'\r?\n\]\);/;

/** The entry plus every walked sibling, in stable sorted order (entry first). */
export function monotonicModulePathsUnder(root: string): string[] {
  const walked = hooksScopeFilesUnder(root).filter(
    (rel) => rel === MONOTONIC_ENTRY_REL || rel.startsWith(MONOTONIC_DIR_PREFIX)
  );
  const entry = walked.indexOf(MONOTONIC_ENTRY_REL);
  if (entry > -1) walked.splice(entry, 1);
  return [MONOTONIC_ENTRY_REL, ...walked];
}

/** The pooled text of that set — what a pin about the module SET must read. */
export function monotonicModuleTextUnder(root: string): string {
  return monotonicModulePathsUnder(root)
    .map((rel) => readFileSync(join(root, rel), 'utf8'))
    .join('\n');
}

/**
 * The ONE module of the set whose text carries the canonical ceiling key list.
 * Throws unless exactly one does: zero is the staleness this helper exists to catch
 * (a reader aimed at a file that no longer holds the list), and two is the
 * second-copy defect M3 refuses. A caller that must PATCH the list (the seeding
 * fixture's fourteenth key) gets the right file without ever naming it.
 */
export function ceilingKeyListFileUnder(root: string): string {
  const hits = monotonicModulePathsUnder(root).filter((rel) =>
    CEILING_LIST_TAIL_ANCHOR.test(readFileSync(join(root, rel), 'utf8'))
  );
  const [holder] = hits;
  if (hits.length !== 1 || holder === undefined) {
    throw new Error(
      `CEILING_KEYS must live in exactly one module of the monotonic set — found ` +
        `${hits.length} (${hits.join(', ') || 'none'}) under ${root}`
    );
  }
  return holder;
}
