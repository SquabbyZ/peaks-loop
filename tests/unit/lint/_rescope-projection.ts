// tests/unit/lint/_rescope-projection.ts
//
// The rescope projection shared by `baseline-split-equivalence.test.ts` (and read
// by no collector on its own — this is a `_`-prefixed helper, the division
// `_file-size-hooks-fixture.ts` uses: machinery here, scenarios there).
//
// WHY THE EQUIVALENCE TEST NEEDS A PROJECTION (rid `2026-10-03-w10-rescope-a`).
// That file's claim is about the SPLIT: eleven modules deciding and writing exactly
// what the pinned 799-line monolith decided. The rescope is a DELIBERATE behaviour
// change the split side now carries, and only it, across exactly three surfaces:
//   1. the artifact gains a `shadow` block (reported, never gated);
//   2. `scope.dirs` moves from the typed four-dir enumeration to the list
//      DERIVED from the root-`src` plus `packages/<name>/src` rule (plus the
//      `scope.rule` note);
//   3. stderr gains the one `out-of-scope (not gated, owner decision 2026-10-03)`
//      line the generator prints on every measured run.
// Those surfaces are the rescope's own contract, pinned positively by
// `baseline-rescope-guard.test.ts` and `lint-file-list-parity.test.ts`. The
// equivalence legs normalise them away so EVERY OTHER byte and line is still
// compared strictly — a projection that removed a whole report section would be
// the laundering this slice exists to refuse, so the arms that assert the
// projection is small live next door, and the fixture's tracked files are all
// `src/` (its shadow block is zeros and its ceilings agree unprojected).

/** The generator's one shadow stderr line, in any run's wording tail. */
export const SHADOW_STDERR_LINE =
  /^out-of-scope \(not gated, owner decision 2026-10-03\):.*\n/gm;

/** stderr with the rescope's shadow note removed. A no-op for the monolith side. */
export function projectStderr(text: string): string {
  return text.replace(SHADOW_STDERR_LINE, '');
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
