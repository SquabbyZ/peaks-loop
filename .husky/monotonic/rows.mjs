/**
 * `.husky/monotonic/rows.mjs` — THE PER-FILE ROWS AS PART OF THE RATCHET (rid
 * `rid-count-ceiling-exemption-table`, F-1 of the review).
 *
 * THE HOLE THIS CLOSES. `.husky/gate/findings-table.mjs` makes the artifact's per-file
 * rows the gate's assertion: a file the table names may hold at most what its row names,
 * and a file it does not name may hold none. The generator's guard compared `CEILING_KEYS`
 * only, and the per-file rows in `files` are not ceilings — so a TOTAL-NEUTRAL RESHUFFLE
 * (A 1 → 0, B 0 → 1) raised no total, `node .husky/peaks-gate-baseline.mjs` rewrote
 * A = 0 / B = 1, and `repo` mode then compared B(1) with its own NEW row(1) and went
 * GREEN. The gate refused the reshuffle by name; the regeneration the gate's own sentence
 * recommends was the command that laundered it. Measured before this module existed:
 * `compareCeilings` over two reshuffled ceilings returns `ok: true`, and no module under
 * `.husky/` read a previous per-file map at all — the anchor parsed `files` for its KEYS
 * (`headFiles`, the rescope leaving-set) and threw the values away.
 *
 * THE RULE IS THE CEILING RULE APPLIED TO THE OTHER HALF OF THE TABLE: A ROW MAY ONLY GO
 * DOWN. Only a rise refuses. A descent is what the whole ratchet is for and is reported;
 * and a row ABSENT on either side is not compared, because a file joining the scope has no
 * previous number to rise above and one leaving it is the rescope trip's business
 * (`scopeDifference` in `.husky/baseline/rescope.mjs`), not this one's.
 *
 * WHY NOT LET THE TOTAL CATCH IT. `eslintFindings` IS the sum of these rows, and a sum
 * cannot see a reshuffle — that is the entire defect this rid exists to remove. The
 * comparison therefore has to happen where the rows are written, which is here.
 *
 * WHAT THIS DOES NOT DO, STATED RATHER THAN LEFT TO BE FOUND: a NAME is not an IDENTITY.
 * The table is keyed by path, so findings that MOVE between two paths — a rename onto a
 * name that tolerates more, or a file split in two — are judged per path: the old path's
 * row descends (allowed) and the new path's row is absent at HEAD on the run the move
 * happens (not compared), while the total stays flat. The gate is silent for the same
 * reason, measured: `judgeLintRow({ file: 'src/moved-here.ts', measured: { findings: 3 },
 * allowed: { eslint: 5 } })` returns NO failure, because the row it landed on tolerates 3.
 * Tracking identity across renames is a different slice; `.husky/gate/findings-table.mjs`
 * states the same limit from the gate's side.
 */
import { bullet } from './internal.mjs';

/** The two per-row quantities the gate judges, in the artifact's own spelling. */
const ROW_KEYS = ['eslint', 'eslintErrors'];

/** A row's count, or `null` when the row is not an object or carries no integer. */
function readCount(row, key) {
  if (row === null || typeof row !== 'object') return null;
  const value = row[key];
  return Number.isInteger(value) ? value : null;
}

/**
 * The per-file comparison, in the same shape `compareCeilings` uses: the buckets a
 * caller renders plus the count of quantities actually compared, so a run that compared
 * nothing is visible rather than silent.
 *
 * `malformed` is the fail-closed half. A row present on both sides that carries no
 * integer for a quantity this comparison reads cannot be compared, and skipping it would
 * be the reading that turns a breach into a pass — the same posture `judgeLintRow` takes
 * at the gate for the same shape.
 */
export function compareRowCounts(previousRows, nextRows) {
  const raised = [];
  const lowered = [];
  const malformed = [];
  let compared = 0;
  for (const [file, next] of Object.entries(nextRows ?? {})) {
    const before = previousRows?.[file];
    if (before === undefined) continue;
    for (const key of ROW_KEYS) {
      const from = readCount(before, key);
      const to = readCount(next, key);
      if (from === null || to === null) {
        malformed.push({ file, key });
        continue;
      }
      compared++;
      if (to > from) raised.push({ file, key, previous: from, next: to });
      else if (to < from) lowered.push({ file, key, previous: from, next: to });
    }
  }
  return { raised, lowered, malformed, compared };
}

/**
 * The refusal body for a raised or unreadable row, or `null` when the comparison is
 * clean. The caller wraps it in the generator's one `REFUSING to write …` shape, so an
 * operator reads one sentence per reason this generator may not write.
 */
export function describeRowFailure({ raised = [], malformed = [] }) {
  if (raised.length === 0 && malformed.length === 0) return null;
  const blocks = [];
  if (raised.length > 0) {
    const shown = raised
      .slice(0, 10)
      .map((row) => `${row.file} (${row.key}): ${row.previous} → ${row.next}`);
    blocks.push(
      `  PER-FILE ROWS RAISED — ${raised.length} row(s) in the artifact's \`files\` table ` +
        'moved UP. These rows are what `repo` mode asserts, not a count that absorbs them, ' +
        'so a total-neutral reshuffle (one row down, another up) is exactly the shape the ' +
        'totals cannot see and this refuses:\n' +
        bullet(shown) +
        (raised.length > shown.length ? `\n  … and ${raised.length - shown.length} more` : '')
    );
  }
  if (malformed.length > 0) {
    const shown = malformed.slice(0, 10).map((row) => `${row.file} (${row.key})`);
    blocks.push(
      `  PER-FILE ROWS UNREADABLE — ${malformed.length} row(s) carried no integer where ` +
        'this comparison reads one, so no descent can be measured against them:\n' +
        bullet(shown) +
        (malformed.length > shown.length
          ? `\n  … and ${malformed.length - shown.length} more`
          : '')
    );
  }
  return (
    `${blocks.join('\n\n')}\n\n` +
    '  Fix the regression and re-run `node .husky/peaks-gate-baseline.mjs`: a row descends\n' +
    '  by itself when the measurement does. Re-pointing a row UPWARD clears the gate that\n' +
    '  made the reshuffle visible, which is why this guard refuses it rather than the sum.'
  );
}

/** The descent, printed on the runs that may write — the shrink is why the table exists. */
export function describeRowNote(lowered) {
  if (lowered === undefined || lowered.length === 0) return null;
  const files = [...new Set(lowered.map((row) => row.file))];
  const shown = files.slice(0, 3).join(', ');
  return (
    `rows: ${lowered.length} per-file row(s) descended across ${files.length} file(s) ` +
    `(${shown}${files.length > 3 ? ', …' : ''}) — the table may only shrink, and this is the shrink.`
  );
}
