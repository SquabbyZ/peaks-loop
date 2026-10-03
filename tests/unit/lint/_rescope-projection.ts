// tests/unit/lint/_rescope-projection.ts
//
// The rescope projection shared by `baseline-split-equivalence.test.ts` (and read
// by no collector on its own — this is a `_`-prefixed helper, the division
// `_file-size-hooks-fixture.ts` uses: machinery here, scenarios there).
//
// WHY THE EQUIVALENCE TEST NEEDS A PROJECTION (rid `2026-10-03-w10-rescope-a`).
// That file's claim is about the SPLIT: eleven modules deciding and writing exactly
// what the pinned 799-line monolith decided. The rescope is a DELIBERATE behaviour
// change the split side now carries, and only it, across exactly four surfaces:
//   1. the artifact gains a `shadow` block (reported, never gated);
//   2. `scope.dirs` moves from the typed four-dir enumeration to the list
//      DERIVED from the root-`src` plus `packages/<name>/src` rule (plus the
//      `scope.rule` note);
//   3. stderr gains the one `out-of-scope (not gated, owner decision 2026-10-03)`
//      line the generator prints on every measured run;
//   4. stderr gains the shadow-move check's lines (rid `2026-10-03-shadow-move-rider`
//      W1) — inactive / unchanged / moved-down / one WARNING per risen row / the
//      compared-populations line. Stderr only: no artifact byte, no exit code.
// Those surfaces are the rescope's own contract, pinned positively by
// `baseline-rescope-guard.test.ts` and `lint-file-list-parity.test.ts`. The
// equivalence legs normalise them away so EVERY OTHER byte and line is still
// compared strictly — a projection that removed a whole report section would be
// the laundering this slice exists to refuse. The arms that assert the projection
// is small live in `tests/unit/lint/rescope-projection-bounded.test.ts`: behavior
// `a planted decision sentence that is NOT on the declared list survives the
// projection, so the two stderr sides stay different`, and render
// `every alternative in the projection regexes corresponds to a line the generator
// can actually emit` + `every shadow line the generator can emit is covered by the
// projection`. The fixture's tracked files are all `src/` (its shadow block is
// zeros and its ceilings agree unprojected).

/** The generator's one shadow stderr line, in any run's wording tail. */
export const SHADOW_STDERR_LINE =
  /^out-of-scope \(not gated, owner decision 2026-10-03\):.*\n/gm;

/**
 * The shadow-move check's lines (rid `2026-10-03-shadow-move-rider`, W1): the
 * inactive / unchanged / moved-down statements, the per-row rise WARNING, and the
 * one line that names both populations it compared. Every one of them is stderr-only
 * and adds no byte to the artifact, which is what makes them projectable on the same
 * contract as the line above. Pinned positively by
 * `tests/unit/lint/shadow-move-warning.test.ts`.
 */
export const SHADOW_MOVE_STDERR_LINE =
  /^(?:WARNING: shadow moved up: |shadow-move check: |shadow unchanged: |shadow moved down: | {2}compared: this run ).*\n/gm;

/** stderr with the rescope's shadow note and the shadow-move check removed. A no-op for the monolith side. */
export function projectStderr(text: string): string {
  return text.replace(SHADOW_STDERR_LINE, '').replace(SHADOW_MOVE_STDERR_LINE, '');
}

/**
 * The artifact bytes under the rescope projection: `shadow` removed, `scope`
 * neutralised. Anything else — ceilings, files rows, note, inputs — is still
 * compared byte for byte. Non-JSON placeholders (the no-artifact sentinel) pass
 * through untouched.
 */
export function projectArtifact(text: string): string {
  if (!text.startsWith('{')) return text;
  const doc = JSON.parse(text) as Record<string, unknown>;
  delete doc.shadow;
  doc.scope = null;
  return JSON.stringify(doc);
}
