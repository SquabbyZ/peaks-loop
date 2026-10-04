/**
 * The canonical ceiling key list and every audit taken against it. M3 of the
 * wave 9 split: `CEILING_KEYS` is ONE list in ONE file — no sibling restates it,
 * and `tests/unit/lint/monotonic-split.test.ts` fails if one ever does.
 */
import { displayValue, isCeilingVector } from './internal.mjs';

/**
 * THE CANONICAL CEILING KEY LIST — the fifteen rows the ratchet is allowed to
 * carry, each named exactly once.
 *
 * WHY ONE LIST AND NOT TWO. `.husky/peaks-gate-baseline.mjs` assembles the
 * `ceilings` object it writes, and until this slice nothing anywhere constrained
 * which keys that object could hold: `grep -rn "eslintNotLintedFiles|
 * prettierUnparsableFiles" tests/ scripts/ src/` came back with hits in prose only,
 * so a fourteenth row, a renamed row or a deleted row was accepted by construction
 * — and "accepted" is exactly what a ratchet calls a weakening it cannot see. This
 * list is the sanctioned set; the comparison between this list and any vector is
 * SET EQUALITY (`canonicalKeyProblems`), never a count of `>= 13`, because a count
 * lets a junk row and a missing row cancel each other out.
 *
 * `tests/unit/lint/baseline-monotonicity.test.ts` arm C1 pins this list against the
 * published artifact AND against `git show HEAD:…`, and
 * `tests/unit/lint/baseline-monotonicity-head-anchor.test.ts` arm H-RA4 pins it
 * against what a real run writes, so adding a ceiling in one place and not the
 * other is a red test rather than a new number in the baseline. C1 reads the
 * artifact at HEAD too, so the two rows `2026-10-02-hooks-size-rows` adds here
 * (`fileSizeHooksOverCap`, `fileSizeHooksExcessLines`) stay red there until the
 * seeding regeneration lands in a commit — which is the intended ordering, not a
 * weakening: the list grew with the generator's `ceilings` object in the same
 * change, and only a run of the generator may put the numbers in the artifact.
 *
 * The order is the generator's own assembly order, so a diff of the two reads alike.
 * The two hooks rows sit before `fileSizeExcessLines` for the same reason the
 * generator does: `tests/unit/lint/baseline-monotonicity-seeding.test.ts` patches a
 * copy of this list onto its LAST row, and an appended key un-anchors that guard.
 */
export const CEILING_KEYS = Object.freeze([
  'eslintFindings',
  'eslintErrors',
  'eslintPhantomFindings',
  'eslintCoverageGapFiles',
  'eslintSyntaxErrorFiles',
  'eslintNotLintedFiles',
  'prettierUnformatted',
  'prettierUnparsableFiles',
  'tscErrors',
  // THE COMMENT-DEBT ROWS: the dead-reference total (comments naming a path that
  // resolves nowhere) and the narrative total (comments about the work rather than the
  // code), measured over the enforced scope by `scripts/lint/comment-hygiene-detector.ts`.
  // They sit with the other whole-tree totals and BEFORE `fileSizeExcessLines`, because
  // the seeding fixture arms anchor their patch-on-a-copy on the LAST row of this list.
  'commentDeadReferences',
  'commentNarrativeLines',
  'silentWarningCatchReturnNull',
  'silentWarningEmptyCatch',
  'fileSizeOverCap',
  'fileSizeHooksOverCap',
  'fileSizeHooksExcessLines',
  'fileSizeExcessLines'
]);

/** `CEILING_KEYS` as membership, because the audit asks `has?` once per row read. */
const CEILING_KEY_SET = new Set(CEILING_KEYS);

/**
 * Why `value` is not a ceiling, or `null` when it is one.
 *
 * `Number.isInteger` is the whole trip: it answers false for `NaN`, for
 * `±Infinity` and for a fraction, and true for every legal ceiling including 0.
 * `0` is legal — a row at zero is what a fully cleared debt looks like, and it is
 * the number the `prettierUnformatted` ceiling sat at when 2026-10-01 raised it.
 */
export function ceilingProblem(value) {
  if (typeof value !== 'number') {
    return `is ${value === null ? 'null' : typeof value}, not a number`;
  }
  if (!Number.isInteger(value)) return `is not a finite integer (${displayValue(value)})`;
  if (value < 0) return `is negative (${displayValue(value)})`;
  return null;
}

/**
 * What `ceilings` gets wrong against `CEILING_KEYS`, as rows the caller renders.
 *
 * `side` names the vector the way an operator reads it (“HEAD artifact”, “the
 * artifact on disk”, “measured by this run”), because the two sides of this audit
 * have different remedies and a message that does not say which one is wrong sends
 * the operator to edit the wrong file.
 *
 * `allowMissing` is the anchor's exemption and nobody else's: HEAD's artifact is
 * allowed not to carry a canonical row yet, because that is how a new ceiling gets
 * seeded (row 4 — `fileSizeExcessLines` on 2026-10-01) once the key is on the list
 * and in the generator. The measurement and the artifact on disk get no such pass:
 * a canonical row either side does not carry is a row going missing from the
 * ratchet, which is the loudest weakening there is.
 *
 * `skipKeys` is NOT an exemption, it is a de-duplicator, and it is only ever passed
 * for the artifact on disk: a deferred row `settleDeferredAdded` has already refused
 * names that key with both sides' numbers and the remedy that fits it, and printing a
 * second verdict for the same row under a second heading is the "two overlapping
 * answers" shape this file's own comment refuses. Every other problem the same vector
 * carries still reports.
 */
export function canonicalKeyProblems(side, ceilings, options = {}) {
  if (!isCeilingVector(ceilings)) {
    throw new TypeError(`canonicalKeyProblems: the ${side} ceilings must be an object`);
  }
  const allowMissing = options.allowMissing === true;
  const skip = options.skipKeys instanceof Set ? options.skipKeys : new Set(options.skipKeys ?? []);
  const problems = [];
  const notCanonical =
    `is not one of the ${CEILING_KEYS.length} canonical ceiling keys, so no slice has ` +
    'sanctioned it — add it to CEILING_KEYS and to the generator in the same change, ' +
    'or remove it';
  for (const [key, value] of Object.entries(ceilings)) {
    if (skip.has(key)) continue;
    if (!CEILING_KEY_SET.has(key)) {
      problems.push({ key, side, problem: notCanonical });
      continue;
    }
    const why = ceilingProblem(value);
    if (why !== null) {
      problems.push({ key, side, problem: `ceiling ${displayValue(value)} ${why}` });
    }
  }
  if (!allowMissing) {
    for (const key of CEILING_KEYS) {
      if (!Object.hasOwn(ceilings, key)) {
        problems.push({
          key,
          side,
          problem:
            'is a canonical ceiling row this vector is missing — every row of the ' +
            'ratchet is measured or the ratchet has a hole in it'
        });
      }
    }
  }
  return problems;
}

/**
 * Rows on the canonical list that `ceilings` does not carry. Exported rather than
 * inlined because the generator needs the same list twice: once to tell an anchor
 * that is short (a row awaiting its first seeding) from an anchor that is empty
 * (an absence, which only `--seed` may write over), and once to refuse a
 * measurement that stopped reporting a sanctioned row.
 */
export function missingCanonicalKeys(ceilings) {
  if (!isCeilingVector(ceilings)) {
    throw new TypeError('missingCanonicalKeys: the ceilings must be an object');
  }
  return CEILING_KEYS.filter((key) => !Object.hasOwn(ceilings, key));
}

/**
 * Rows the working copy carries that HEAD does not — the ones whose verdict the
 * measurement decides. A brand-new ceiling is legitimate exactly once: when the key is
 * on the canonical list, this run measures it, HEAD has never carried it, and the file
 * on disk does not carry it either. What the disk copy says about such a row is not a
 * verdict, it is a claim: `settleDeferredAdded` is where this run's number decides
 * whether it was measured or typed (backlog §2.35).
 *
 * Each row carries the value the disk holds, so the caller can compare it with the one
 * this run measures without reading the artifact a second time.
 *
 * `workingCopy` is `null` when the artifact is absent, unreadable or unparseable —
 * nothing pre-seeded from a file that carries nothing.
 */
export function unseedableKeys(head, workingCopy) {
  if (!isCeilingVector(head)) {
    throw new TypeError('unseedableKeys: the HEAD ceilings must be an object');
  }
  if (workingCopy === null) return [];
  if (!isCeilingVector(workingCopy)) {
    throw new TypeError('unseedableKeys: the working-copy ceilings must be an object or null');
  }
  const rows = [];
  for (const [key, value] of Object.entries(workingCopy)) {
    if (Object.hasOwn(head, key)) continue;
    rows.push({
      key,
      side: 'the working copy',
      disk: value,
      problem:
        `the working copy carries ${displayValue(value)} under a key HEAD does not have, ` +
        'so this run has to measure it before the row means anything'
    });
  }
  return rows;
}
