// tests/unit/lint/_rescope-projection.ts
//
// The rescope projection shared by `baseline-split-equivalence.test.ts` (and read
// by no collector on its own — this is a `_`-prefixed helper, the division
// `_file-size-hooks-fixture.ts` uses: machinery here, scenarios there).
//
// WHY THE EQUIVALENCE TEST NEEDS A PROJECTION (rid `2026-10-03-w10-rescope-a`).
// That file's claim is about the SPLIT: eleven modules deciding and writing exactly
// what the pinned 799-line monolith decided. The rescope is a DELIBERATE behaviour
// change the split side now carries, and only it, across five surfaces (4/5 added by
// rid `2026-10-03-silent-warning-scope`):
//   1. the artifact gains a `shadow` block (reported, never gated);
//   2. `scope.dirs` moves from the typed four-dir enumeration to the list
//      DERIVED from the root-`src` plus `packages/<name>/src` rule (plus the
//      `scope.rule` note, and since §2.43 the per-leg populations under it);
//   3. stderr gains the one `out-of-scope (not gated, owner decision 2026-10-03)`
//      line the generator prints on every measured run;
//   4. stderr gains the shadow-move check's lines (rid `2026-10-03-shadow-move-rider`
//      W1) — inactive / unchanged / moved-down / one WARNING per risen row / the
//      compared-populations line. Stderr only: no artifact byte, no exit code.
//   5. stderr's silent-warning measurement line changes wording, because the leg
//      measures the enforced scope now and can say `== the enforced scope` — the
//      monolith measures its own `src/` walk and cannot.
//   6. stderr gains the §2.50 growth statement (`scope grew: 943 -> 950 (7 entered,
//      0 left the scope)`), printed by `decide.mjs` on every pure-growth run the
//      monolith would have refused. Stderr only: no artifact byte beyond `scope`
//      (surface 2), no exit code (the monotonicity rule still stops any rise).
//      Pinned positively by `tests/unit/lint/baseline-scope-growth-vs-shrink.test.ts`.
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
export const SHADOW_STDERR_LINE = /^out-of-scope \(not gated, owner decision 2026-10-03\):.*\n/gm;

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

/**
 * The silent-warning LEG's measurement sentence — declared surface 5 (rid
 * `2026-10-03-silent-warning-scope`, backlog §2.43). The slice's whole point is that
 * this leg now measures the enforced scope instead of a `src/` walk of its own, and
 * it says so in a sentence the pinned monolith cannot print because the monolith has
 * no such claim to make. Both sides' diagnostic is the leg's measurement line, both
 * start `silent-warning: catch-return-null=`, and both are stderr-only: no artifact
 * byte beyond `scope` (already surface 2), no ceiling (the fifteen are unchanged),
 * no exit code. Pinned positively by
 * `tests/unit/lint/silent-warning-scope-leg.test.ts`.
 */
export const LEG_MEASURE_STDERR_LINE = /^silent-warning: catch-return-null=.*\n/gm;

/**
 * The §2.50 growth statement (declared surface 6) — printed by `decide.mjs` via
 * `scopeGrowthLine` in `.husky/baseline/leg-scope.mjs` when the watched population
 * grew with nothing leaving. Stderr-only, split-side-only: the pinned monolith
 * refuses that state outright and can print no such sentence.
 */
export const SCOPE_GROWTH_STDERR_LINE = /^scope grew:.*\n/gm;

/** stderr with the rescope's shadow note and the shadow-move check removed. A no-op for the monolith side. */
export function projectStderr(text: string): string {
  return text
    .replace(SHADOW_STDERR_LINE, '')
    .replace(SHADOW_MOVE_STDERR_LINE, '')
    .replace(LEG_MEASURE_STDERR_LINE, '')
    .replace(SCOPE_GROWTH_STDERR_LINE, '');
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
