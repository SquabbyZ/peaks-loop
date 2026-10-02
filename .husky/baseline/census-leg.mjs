/**
 * `.husky/baseline/census-leg.mjs` — the file-size census run and its four
 * fail-closed refusals (rid `2026-10-02-wave9-generator-split`, HEAD lines
 * 541–614 wrapped as `measureCensusLeg()`).
 *
 * WHY THE SPECIFIER SPELLING MOVED (HEAD's 59–62, restated because the cut made
 * the old sentence false). HEAD imported the shared leg as `./` from `.husky/`;
 * this module sits one directory deeper, so it reads
 * `../peaks-gate-file-size.mjs`. The REASON for the two spellings is unchanged
 * and still worth stating: `.husky/peaks-gate.mjs` is run from a scratch copy by
 * the parity test's control arm and has to resolve its helper from one level
 * under the repo root, while this generator and its modules are only ever run
 * from inside `.husky/`. One measurement path, two legal anchors — not drift.
 */
import {
  FS_HOOKS_WHOLE_SCOPE_SOURCE,
  FS_WHOLE_SCOPE_SOURCE,
  measureFileSizeOverCap
} from '../peaks-gate-file-size.mjs';

import { OUT_PATH, ROOT, rel } from './paths.mjs';

/** All four hooks/whole-scope rows, refused unless the census counted whole scopes. */
export function measureCensusLeg() {
  // ---- file-size census ------------------------------------------------------
  // The third measured-only ceiling, and the one this slice exists to add. The
  // policy — 300 raw lines for `src`/`packages`/`scripts`, 500 for the root
  // `tests/` tree — lives in `src/services/scan/file-size-policy.ts`; the census is
  // the only tool that imports it and counts the whole scope, so the ceiling and
  // the gate's own reading of `fileSizeOverCap` come from ONE measurement path.
  // Nothing here may type the number: 174 is what this run's census reported, and a
  // literal would freeze the ceiling in place of the count — the same defect the
  // silent-warning legs were added to end.
  //
  // THE SAME ENVELOPE SEEDS THE SECOND FILE-SIZE ROW, `fileSizeExcessLines` — the
  // LINES over those caps, which `overCap` cannot see (rid `2026-10-01-file-size-excess-row`;
  // C wave 6 paid 67 excess lines to buy 19 lint findings while the file count held).
  // It is copied off `size.env.excessLines` under the same rule: never typed.
  //
  // FAIL-CLOSED on the same terms as the silent-warning step below: a census that
  // cannot run, or that counted no file, aborts the run BEFORE anything is written.
  // Writing a zero here would seed a ceiling of zero for a number that was never
  // measured, and the ratchet could then never be satisfied again.
  //
  // THE MEASUREMENT PATH IS SHARED with the gate (`.husky/peaks-gate-file-size.mjs`,
  // F5 of the repair cycle). These two callers used to carry near-verbatim copies of
  // the spawn and its four refusal conditions, already drifted on one option; the
  // ceiling and the row the gate compares must come from one code path, not two that
  // happen to look alike.
  console.error('running the file-size census...');
  const size = measureFileSizeOverCap([], ROOT);
  if (size.failure !== null) {
    console.error(
      `\nREFUSING to write ${rel(OUT_PATH)}: ${size.failure}.\n` +
        '  Nothing has been written; the existing ceilings are untouched.\n'
    );
    process.exit(1);
  }
  const sizeBuckets = Object.entries(size.env.byDir ?? {})
    .map(([dir, totals]) => `${dir} ${totals.files}`)
    .join(', ');
  console.error(
    `file-size: ${size.env.overCap} of ${size.env.scope.countedFiles} file(s) over the policy cap ` +
      `(${size.env.caps.defaultCap}/${size.env.caps.testsCap} raw lines; ${sizeBuckets}; ` +
      `${size.env.excessLines} excess lines)`
  );
  // THE SECOND SCOPE IS PRINTED WITH ITS OWN INPUTS, not folded into the line above:
  // `.husky/` has its own cap, its own enumeration and its own rows (§2.32), and a
  // reader of this run has to be able to tell the two populations apart.
  console.error(
    `file-size hooks: ${size.env.hooks.overCap} of ${size.env.hooks.scope.countedFiles} file(s) ` +
      `over the hooks cap (${size.env.hooks.caps.hooksCap} raw lines in ${size.env.hooks.scope.source}; ` +
      `${size.env.hooks.excessLines} excess lines)`
  );

  // The ceiling describes the ROW, so it may only be seeded from the census's own
  // whole-scope run. An explicit-path run counts whatever it is handed.
  if (size.env.scope.source !== FS_WHOLE_SCOPE_SOURCE) {
    console.error(
      `\nREFUSING to write ${rel(OUT_PATH)}: the census reported source ` +
        `"${size.env.scope.source}" instead of "${FS_WHOLE_SCOPE_SOURCE}", so its overCap is not ` +
        'the number the gate ratchets.\n  Nothing has been written; the existing ceilings are ' +
        'untouched.\n'
    );
    process.exit(1);
  }
  // THE HOOKS ROWS ARE SEEDED ON THE SAME TERM (§2.32): a hooks block counted from a
  // named file list describes those files, not the `.husky/` scope, and a ceiling
  // seeded from it would be a permission nobody measured.
  if (size.env.hooks.scope.source !== FS_HOOKS_WHOLE_SCOPE_SOURCE) {
    console.error(
      `\nREFUSING to write ${rel(OUT_PATH)}: the census reported hooks source ` +
        `"${size.env.hooks.scope.source}" instead of "${FS_HOOKS_WHOLE_SCOPE_SOURCE}", so its ` +
        'hooks counts are not the numbers the gate ratchets.\n  Nothing has been written; the ' +
        'existing ceilings are untouched.\n'
    );
    process.exit(1);
  }
  return size;
}
