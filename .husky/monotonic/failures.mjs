/**
 * The refusal texts, kept beside the rule they explain.
 */
import { bullet } from './internal.mjs';
import { CEILING_KEYS } from './keys.mjs';

// ---------------------------------------------------------------------------
// The text. Kept here so the rule and the sentence that explains it cannot
// drift apart, and so the generator's own block stays a call site.
// ---------------------------------------------------------------------------

const RULE = 'every ceiling may only go DOWN, and this run asks to move the ratchet up';

/**
 * The body of the refusal, naming every weakening this run measured. `null` when
 * the decision is clean. The caller wraps it in the generator's existing
 * `REFUSING to write …` idiom, so the operator reads one shape for every reason
 * this generator may not write.
 */
export function describeMonotonicityFailure(decision) {
  if (decision.ok) return null;
  const blocks = [];
  if (decision.raised.length > 0) {
    blocks.push(
      `  RAISED — ${decision.raised.length} ceiling(s) above the number they are the ceiling OF. ` +
        'A raise is a regression to fix, not a number to commit:\n' +
        bullet(decision.raised.map((row) => `${row.key}: ${row.previous} → ${row.next}`))
    );
  }
  if (decision.removed.length > 0) {
    blocks.push(
      `  REMOVED — ${decision.removed.length} ceiling row(s) the previous artifact carried and ` +
        'this run does not measure. Dropping a row is the loudest possible weakening:\n' +
        bullet(decision.removed.map((row) => `${row.key}: it held ${row.previous}`))
    );
  }
  if (decision.invalid.length > 0) {
    blocks.push(
      `  INVALID — ${decision.invalid.length} value(s) that are not finite non-negative integers, ` +
        'so no descent can be measured against them:\n' +
        bullet(decision.invalid.map((row) => `${row.key} (${row.side}): ${row.value} ${row.why}`))
    );
  }
  return (
    `${RULE}.\n\n${blocks.join('\n\n')}\n\n` +
    '  Fix the regression and re-run `node .husky/peaks-gate-baseline.mjs`: a ceiling descends\n' +
    '  by itself when the measurement does. Editing a ceiling to clear this, or deleting its row,\n' +
    '  is the weakening this guard exists to refuse.'
  );
}

/**
 * The canonical-key refusal. `null` when the vector agrees with the list.
 *
 * WHY IT NAMES THE SIDE. The two sides of this audit have different remedies — a row
 * missing from the measurement means a leg stopped being measured, a row missing from
 * HEAD means a ceiling awaiting its first seeding, a row missing from the artifact on
 * disk means somebody deleted it — and a message that says only "unexpected key"
 * sends the operator to edit whichever file happened to be open.
 */
export function describeCanonicalKeyFailure(problems) {
  if (problems.length === 0) return null;
  return (
    `  NOT THE CANONICAL CEILING SET — ${problems.length} disagreement(s) with the ` +
    `${CEILING_KEYS.length} sanctioned rows:\n` +
    bullet(problems.map((row) => `${row.key} (${row.side}): ${row.problem}`)) +
    '\n\n' +
    '  `CEILING_KEYS` here and the `ceilings` object in .husky/peaks-gate-baseline.mjs are\n' +
    '  one list read two ways, compared by SET EQUALITY. A row in one and not the other is\n' +
    '  the `13 rows, two places` defect this refuses; land both halves in the same change.'
  );
}
