/**
 * `.husky/baseline/leg-scope.mjs` — the per-leg POPULATION records inside the
 * artifact's `scope` block, and the comparison that decides whether one of them
 * moving is a boundary event (rid `2026-10-03-silent-warning-scope`, backlog §2.43).
 *
 * WHY A LEG'S POPULATION IS A BOUNDARY AND NOT A DETAIL. The rescope guard
 * (`rescope.mjs`, backlog §2.42) compares `scope.dirs`, and that caught the one
 * boundary move it was written for: narrowing the enforced file set drops rows and
 * lowers every ceiling at once, which is a shrunken denominator, not a reduction in
 * debt. It cannot see the OTHER kind. The silent-warning rows ratcheted a population
 * of the leg's own making — a filesystem walk of `src/`, 905 files — inside a 943-file
 * scope. Widening that leg to the scope every other leg uses moves `scope.dirs` by
 * nothing at all and moves the two ceilings 41 → 49 and 59 → 68, because the 17
 * swallows it surfaces were always there. A guard that reads only `dirs` calls that
 * `RAISED`, the escape hatch refuses to engage, and the honest options left are
 * hand-editing the artifact or marking the sites with a grace comment — clearing a
 * gate with a prose note, which is the thing this campaign refuses over and over.
 *
 * So a leg's population is recorded in `scope` as `{ source, scannedFiles }`, this
 * module compares those records, and a moved record is a boundary event: `--rescope`
 * engages, the refusal without the flag names WHICH leg moved and BOTH counts, and
 * only the rows belonging to that leg may rise (`.husky/baseline/decide.mjs`).
 *
 * A per-leg record is METADATA, not a sixteenth ceiling: `CEILING_KEYS` stays the
 * fifteen it is and the set-equality audit in `.husky/monotonic/keys.mjs` still owns
 * that list.
 */

import { SW_CEILING_KEYS, SW_SCOPE_KEY } from '../peaks-gate-silent-warning.mjs';

/**
 * The ceiling rows each leg record explains. Derived from the leg's own module
 * (`SW_SCOPE_KEY` / `SW_CEILING_KEYS`), never restated here, so the waiver cannot be
 * handed a row the leg does not measure — which is the `13 rows, two places` defect
 * in the one place it would matter most.
 */
const LEG_ROWS = Object.freeze({ [SW_SCOPE_KEY]: SW_CEILING_KEYS });

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The label a refusal uses for a leg key: `silentWarning` → `silent-warning`. */
export function legLabel(leg) {
  return leg.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
}

/**
 * Which legs either block names. A record is any `scope` entry that carries an
 * integer `scannedFiles`, so a second leg can become a boundary event by recording
 * itself the same way — no edit here, and nothing that reads as a ceiling.
 */
export function legScopeNames(...scopes) {
  const names = new Set();
  for (const scope of scopes) {
    if (!isRecord(scope)) continue;
    for (const [key, value] of Object.entries(scope)) {
      if (isRecord(value) && Number.isInteger(value.scannedFiles)) names.add(key);
    }
  }
  return [...names].sort();
}

/** What one block recorded for one leg, or `null` when it recorded nothing. */
export function legPopulation(scope, leg) {
  const record = isRecord(scope) ? scope[leg] : null;
  if (!isRecord(record) || !Number.isInteger(record.scannedFiles)) return null;
  return record.scannedFiles;
}

/**
 * Which leg populations moved between HEAD's record and this run's measurement.
 *
 * `from: null` means HEAD carried no record for that leg — and UNKNOWN is not zero
 * and not "equal". An absent record cannot prove a population stood still, so it
 * cannot make a rise look legal; the same posture `isShadowBlock()` takes for an
 * absent shadow block in `rescope.mjs` (§2.41: "nothing recorded" and "recorded as
 * nothing" are different facts).
 */
export function legScopeMoves(headScope, newScope) {
  const moves = [];
  for (const leg of legScopeNames(headScope, newScope)) {
    const from = legPopulation(headScope, leg);
    const to = legPopulation(newScope, leg);
    if (from !== null && from === to) continue;
    moves.push({ leg, from, to });
  }
  return moves;
}

/** The one line a refusal or a note uses for one moved leg, naming both counts. */
export function describeLegScopeMove(move) {
  const from =
    move.from === null ? 'unknown (HEAD records no population for this leg)' : String(move.from);
  const to = move.to === null ? 'unknown (this run measured none)' : String(move.to);
  return `${legLabel(move.leg)} leg population: ${from} -> ${to}`;
}

/** Which leg a ceiling row belongs to; `null` is the gate-wide population. */
export function legOfCeilingKey(key) {
  for (const [leg, rows] of Object.entries(LEG_ROWS)) {
    if (rows.includes(key)) return leg;
  }
  return null;
}

/**
 * Does the boundary this run moved explain a ceiling rising from
 * `previous` to `next`? Three parts, and the third is the one that keeps the waiver
 * from becoming a licence:
 *   - the flag was passed AND the scope block really differs (the caller checked);
 *   - the row's OWN leg population moved. A row the artifact attributes to no leg
 *     belongs to the gate-wide population, so `dirs` or the measured file count
 *     moving is what explains it;
 *   - and the new number is this run's measurement, never a number the operator
 *     asked for (the caller only ever waives rows the measurement itself produced).
 */
export function raiseIsBoundary({ key, moves, gatePopulationMoved }) {
  const leg = legOfCeilingKey(key);
  if (leg === null) return gatePopulationMoved;
  return moves.some((move) => move.leg === leg);
}
