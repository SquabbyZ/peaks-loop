/**
 * The decision table and the anchor parser — the pure comparison itself.
 */
import { displayValue, isCeilingVector } from './internal.mjs';
import { ceilingProblem } from './keys.mjs';
import { COUPLED_SIZE_RISE } from './size-couple.mjs';

/** How each side of the comparison is named in the text an operator reads. */
const SIDES = { previous: 'previous artifact', measured: 'measured by this run' };

/**
 * The one pair this table trades: the count may rise when the excess lines are strictly
 * lower in the SAME comparison. The rule, its reason, why it is not a back door and the
 * limit it knowingly accepts are argued once, in the contract comment of
 * `.husky/peaks-gate-baseline-monotonic.mjs` — the entry every import site names — and the
 * two key NAMES live in `size-couple.mjs`, which is one home for one fact rather than a copy
 * of the list. (`size-couple.mjs`'s own header records why it is not this file and not
 * `keys.mjs`; both were tried, and each broke a different existing guard.)
 */
const { rises: COUPLED_RISE, falls: COUPLED_FALL } = COUPLED_SIZE_RISE;

/**
 * The coupled pair as a predicate. Both rows must be present on both sides — they are
 * already known to be ceilings, because both sides came out of `keepValid` — and the
 * fall must be STRICT: equal is not a fall, higher is not a fall, and a row this run
 * stopped measuring is not a number a descent can be measured against. Every one of
 * those three shapes therefore leaves `fileSizeOverCap` in `raised`, where the old
 * rule put it.
 */
const isCoupledRise = (key, before, after) =>
  key === COUPLED_RISE &&
  Object.hasOwn(before, COUPLED_FALL) &&
  Object.hasOwn(after, COUPLED_FALL) &&
  after[COUPLED_FALL] < before[COUPLED_FALL];

/**
 * The decision table, as data.
 *
 * `previous` is the anchor — the `ceilings` block of HEAD's copy of the artifact, or
 * `{}` for a seed run, which is what makes every row come back as `added` and
 * therefore as *reported*. It is NOT the working-tree file: that file is the thing a
 * weakening edits, and since repair cycle 1 it is audited separately
 * (`workingCopyTrip`). `next` is what this run measured. Returns the seven buckets the
 * caller renders; `ok` is `false` exactly when `raised`, `removed` or `invalid` has a
 * row in it — `coupledRise` is the one bucket that does not refuse, and it carries the
 * pair of numbers that earned it.
 *
 * Throws on a vector that is not an object. That is deliberate: `null` reaching here
 * would be an unreadable anchor routed past the `--seed` trip, and a comparison that
 * treated it as "no previous ceilings" would re-baseline a corrupt ratchet with
 * nobody opting in.
 */
export function compareCeilings(previous, next) {
  if (!isCeilingVector(previous)) {
    throw new TypeError(
      'compareCeilings: the previous ceilings must be an object — an absent or unreadable ' +
        'artifact is the --seed row of the decision table, not an empty one'
    );
  }
  if (!isCeilingVector(next)) {
    throw new TypeError('compareCeilings: the measured ceilings must be an object');
  }

  const invalid = [];
  const keepValid = (side, source) => {
    const usable = {};
    for (const [key, value] of Object.entries(source)) {
      const why = ceilingProblem(value);
      if (why === null) usable[key] = value;
      else invalid.push({ key, side: SIDES[side], value: displayValue(value), why });
    }
    return usable;
  };
  const before = keepValid('previous', previous);
  const after = keepValid('measured', next);

  const raised = [];
  const coupledRise = [];
  const lowered = [];
  const added = [];
  for (const [key, value] of Object.entries(after)) {
    if (!Object.hasOwn(before, key)) {
      added.push({ key, next: value });
      continue;
    }
    const ceiling = before[key];
    if (value > ceiling) {
      if (isCoupledRise(key, before, after)) {
        coupledRise.push({
          key,
          previous: ceiling,
          next: value,
          justifiedBy: {
            key: COUPLED_FALL,
            previous: before[COUPLED_FALL],
            next: after[COUPLED_FALL]
          }
        });
      } else {
        raised.push({ key, previous: ceiling, next: value });
      }
    } else if (value < ceiling) lowered.push({ key, previous: ceiling, next: value });
  }
  const removed = Object.keys(before)
    .filter((key) => !Object.hasOwn(after, key))
    .map((key) => ({ key, previous: before[key] }));

  return {
    ok: raised.length === 0 && removed.length === 0 && invalid.length === 0,
    raised,
    coupledRise,
    lowered,
    added,
    removed,
    invalid
  };
}

/**
 * The previous artifact's `ceilings`, or the reason there is none.
 *
 * A file that is empty, unreadable, not JSON, or JSON without a `ceilings` object
 * all come back as `problem` with `ceilings: null` — never as `{}`. Callers must
 * treat `null` as "do not write" and only `--seed` as permission to write anyway.
 */
export function parsePreviousArtifact(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ceilings: null, problem: 'is empty or unreadable' };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    const first = String(err.message).split('\n')[0];
    return { ceilings: null, problem: `is not parseable JSON (${first})` };
  }
  if (!isCeilingVector(document)) {
    return { ceilings: null, problem: `is ${displayValue(document)}, not a JSON object` };
  }
  if (!isCeilingVector(document.ceilings)) {
    return { ceilings: null, problem: 'has no ceilings object' };
  }
  return { ceilings: document.ceilings, problem: null };
}
