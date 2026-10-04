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

/**
 * The comment-hygiene LEG's two lines (declared surface 7, rid
 * `2026-10-04-comment-rows-under-ratchet`): the progress note and the measurement
 * sentence. The pinned monolith has no such leg, so it cannot print either, and the
 * numbers they carry are ceilings the reference side does not sanction. Stderr only:
 * no exit code, and the artifact delta is surface 8 below.
 */
export const COMMENT_HYGIENE_STDERR_LINE =
  /^(?:running the comment-hygiene detector\.\.\.|comment-hygiene: dead-reference=).*\n/gm;

/**
 * The row COUNT inside the seed disclaimer (declared surface 9). `all 15 row(s)` on the
 * reference side and `all 17 row(s)` on the split side are the same sentence about
 * different eras of `CEILING_KEYS`; the sentence itself — the thing an operator must not
 * lose — is kept, only the number is normalised. Pinned positively by
 * `baseline-monotonicity-head-anchor.test.ts` (H5a writes it).
 */
export const SEED_RUN_ROW_COUNT = /all \d+ row\(s\) are ceilings/g;

/**
 * The era projection (declared surfaces 7 to 10) — the smallest thing that makes a
 * pre-split program and today's program comparable, rid `2026-10-04-comment-rows-under-ratchet`.
 *
 * The two sides of `baseline-split-equivalence.test.ts` run against ONE fixture and ONE
 * anchor, and the anchor is what the reference program measures — it must be, or the three
 * attack states are two different disk shapes. So the side that sanctions rows the
 * reference program has no leg for legitimately reports them as `NEWLY SEEDED`, and opens
 * its note with `2 row(s) moved` where the reference side opens with `every ceiling held`.
 * Those are decision sentences, not decoration, so this is not something a regex may
 * swallow: an era bullet is removed ONLY when its key is in `eraRows` — the rows the
 * canonical list gained after the reference commit, read off two `CEILING_KEYS` literals —
 * a note is dropped only when EVERY bullet under it is an era row, and the moved-count is
 * decremented by what was actually removed. A planted moved-row that is not an era row
 * keeps its bullet, its header, its count and the resulting difference. Proved by
 * `rescope-projection-bounded.test.ts`.
 */
export function projectEraRows(text: string, eraRows: readonly string[]): string {
  const stripped = text.replace(COMMENT_HYGIENE_STDERR_LINE, '');
  if (eraRows.length === 0) return stripped;
  const era = new Set(eraRows);
  const lines = stripped.split('\n');
  const kept: string[] = [];
  let eraMoved = 0;
  const isEraBullet = (line: string): boolean =>
    /^ {4}- ([A-Za-z][A-Za-z0-9]*)[^:]*: /.test(line) &&
    era.has(/^ {4}- ([A-Za-z][A-Za-z0-9]*)/.exec(line)?.[1] as string);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (isEraBullet(line)) {
      eraMoved += 1;
      continue;
    }
    // A `NEWLY SEEDED` / `CLEARED` header owns the bullet run directly under it
    // (`.husky/monotonic/notes.mjs` builds them as one note). Drop the header only when
    // that whole run is era rows; one non-era bullet keeps the note intact.
    if (/^ {2}(?:NEWLY SEEDED|CLEARED) — \d+ (?:row|ceiling)\(s\)/.test(line)) {
      let run = 0;
      while (lines[i + 1 + run] !== undefined && /^ {4}- /.test(lines[i + 1 + run] ?? '')) {
        run += 1;
      }
      const everyBulletIsEra =
        run > 0 &&
        lines.slice(i + 1, i + 1 + run).every((b) => {
          const key = /^ {4}- ([A-Za-z][A-Za-z0-9]*)/.exec(b)?.[1];
          return key !== undefined && era.has(key);
        });
      if (everyBulletIsEra) {
        eraMoved += run;
        i += run;
        continue;
      }
    }
    kept.push(line);
  }
  if (eraMoved === 0) return kept.join('\n');
  return kept
    .join('\n')
    .replace(/^monotonicity: (\d+) row\(s\) moved(?= —)/gm, (_all, count: string) => {
      const left = Number(count) - eraMoved;
      return left <= 0
        ? 'monotonicity: every ceiling held'
        : `monotonicity: ${String(left)} row(s) moved`;
    });
}

/**
 * stderr under every declared surface. `eraRows` defaults to none, which is the whole
 * comparison a same-era test needs; only the era-crossing guard passes rows, and
 * `rescope-projection-bounded.test.ts` is what keeps that second argument honest.
 */
export function projectStderr(text: string, eraRows: readonly string[] = []): string {
  const base = text
    .replace(SHADOW_STDERR_LINE, '')
    .replace(SHADOW_MOVE_STDERR_LINE, '')
    .replace(LEG_MEASURE_STDERR_LINE, '')
    .replace(SCOPE_GROWTH_STDERR_LINE, '')
    .replace(SEED_RUN_ROW_COUNT, 'all N row(s) are ceilings');
  return projectEraRows(base, eraRows);
}

/**
 * The artifact bytes under the rescope projection: `shadow` removed, `scope`
 * neutralised. Anything else — ceilings, files rows, note, inputs — is still
 * compared byte for byte. Non-JSON placeholders (the no-artifact sentinel) pass
 * through untouched.
 *
 * `dropCeilingKeys` (declared surface 8) removes named keys from the `ceilings` block,
 * and NOTHING MAY CALL IT WITH A TYPED LIST: the caller passes the rows the canonical
 * list gained after the reference commit, derived from the two `CEILING_KEYS` literals
 * (`ceilingKeysInText` reads both). That is what makes the projection the smallest true
 * one for an era comparison — a row that is in both eras is still compared byte for byte,
 * and a row the reference side cannot measure is named in the bound arm of
 * `rescope-projection-bounded.test.ts` rather than silently dropped.
 */
export function projectArtifact(text: string, dropCeilingKeys: readonly string[] = []): string {
  if (!text.startsWith('{')) return text;
  const doc = JSON.parse(text) as Record<string, unknown>;
  delete doc.shadow;
  doc.scope = null;
  if (dropCeilingKeys.length > 0) {
    const rows = doc.ceilings as Record<string, unknown> | undefined;
    if (rows !== undefined) {
      for (const key of dropCeilingKeys) delete rows[key];
      doc.ceilings = rows;
    }
  }
  return JSON.stringify(doc);
}
