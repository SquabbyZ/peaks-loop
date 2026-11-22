/**
 * WHO owns the harness auto-compact WINDOW key — the rollback's classifier.
 *
 * The percent half has had this question answered in one place since the pair
 * was introduced (`harness-percent-ownership.ts`). The window half did not: the
 * rollback deleted `delete nextEnv[location.envVar]` unconditionally, so
 * `--reset` removed a hand-set window even though its own documentation
 * promised that a genuine human pin is always kept. This module is that
 * promise, in the same five states and with the same shape as the percent's, so
 * the two halves of one rollback cannot disagree about what "peaks-loop wrote
 * this" means.
 *
 * It sits in its own module rather than in `harness-window-config.ts` because
 * that file is already over the raw-line cap and its excess is gated; the
 * predicate needs only the marker constant and the token parser from it.
 */

import { HARNESS_WINDOW_WRITTEN_KEY, parseHarnessWindowTokens } from './harness-window-config.js';

export { HARNESS_WINDOW_WRITTEN_KEY };

/**
 * WHO the window value on disk belongs to — the five states the percent half
 * already names, so a reader who knows one knows the other.
 *
 *   - `peaks`         — the value parses and equals its provenance marker
 *   - `peaks-corrupt` — the marker parses while the VALUE does not (peaks-loop
 *                       writes only `String(tokens)`, so a VALID numeric marker
 *                       beside an unreadable value is its own write mangled
 *                       afterwards)
 *   - `human`         — a value with no marker, one that differs from its
 *                       marker (a takeover), one whose MARKER does not parse,
 *                       or one whose value or marker is in a spelling peaks-loop
 *                       never writes (`1e6`, `00100000`, `+1000000`): an
 *                       unreadable-or-unwritable marker is never evidence that
 *                       peaks-loop wrote here, even when both raws are equal
 *   - `stale-marker`  — the value was deleted by hand, the marker survived
 *   - `none`          — neither the value nor a marker
 */
export type HarnessWindowOwnership = 'peaks' | 'peaks-corrupt' | 'human' | 'stale-marker' | 'none';

/**
 * THE SPELLING peaks-loop writes for this pair — a plain decimal with no leading
 * zero beyond a lone `0`. This is the window's counterpart of the percent half's
 * `PLAIN_PERCENT_SPELLING` (see `harness-percent-ownership.ts`) and it lives
 * beside the window's ownership predicate for the same reason: it answers an
 * OWNERSHIP question, not a parsing one.
 *
 * Why ownership needs it when the parser does not. `parseHarnessWindowTokens` is
 * deliberately lenient — `Number()` accepts `1e6`, `00100000`, `+1000000` and
 * `1000000.0`, and the reader needs that reach to compare a value the harness
 * may hold — while the writer only ever emits `String(tokens)`, plain digits.
 * Classifying by the lenient parse alone therefore treated a spelling peaks-loop
 * could never have produced as its own, and `--reset` DELETED a value that was
 * not peaks-loop's to remove (`1e6` beside marker `1000000` reproduced it).
 *
 * A value or a marker in any other spelling is not evidence of peaks-loop's
 * ownership: the rollback keeps it. Its relation to the percent half is one
 * asymmetry, stated rather than implied — a percent VALUE in an odd spelling is
 * still `peaks-corrupt` (removable), because its parser refuses the spelling at
 * all, so a readable marker beside it can only be a mangled peaks write. The
 * window's parser accepts the spelling and then compares it, which is what made
 * `1e6` equal `1000000` in the first place; the gate has to sit between those
 * two steps, and the result is `human` (kept).
 */
const PLAIN_WINDOW_SPELLING = /^(?:0|[1-9]\d*)$/;
/**
 * One raw value uses the plain spelling `String(tokens)` produces.
 *
 * A NUMBER has exactly one spelling `String()` can give it — the plain decimal
 * of a positive integer — which is precisely what the token parser accepts, so
 * delegating there keeps the two from drifting. The STRING branch is the one
 * this gate exists for: a string can carry `1e6` or `00100000`, spellings no
 * `String(tokens)` ever emits, and the parser would happily read them.
 *
 * The ORDER of the two tests is load-bearing. Applied to the WHOLE string, the
 * regex would demand that the padding itself be digits, so `' 1000000 '` would
 * be rejected even though the parser trims it; applied to the trimmed text it
 * accepts the padded spelling, and that is the spelling the writer's own read
 * path resolves to. The `typeof` test comes FIRST so a number is never handed
 * to `RegExp.prototype.test` (`String(1_000_000)` would pass, but nothing
 * proves the number was an integer).
 */
function isPlainWindowSpelling(raw: unknown): boolean {
  if (typeof raw === 'number') return parseHarnessWindowTokens(raw) !== null;
  const text = typeof raw === 'string' ? raw.trim() : '';
  return PLAIN_WINDOW_SPELLING.test(text);
}

/**
 * THE ROLLBACK'S RULE — what `--reset` may REMOVE.
 *
 * Deliberately the same asymmetry as `isHarnessPercentRemovable`: removing a
 * value the user explicitly asked to roll back deserves a wider rule than
 * overwriting one. A window with NO marker is the user's own pin and is never
 * removed; a marker proves peaks-loop wrote here, so a mangled value beside it
 * is a corruption of peaks-loop's own write rather than a human's setting.
 *
 * The proof must be a VALID marker: peaks-loop writes only `String(tokens)`, so
 * an unparseable marker is not one of its writes and the window beside it is the
 * user's — kept, even when both rows hold the same typo.
 *
 * The proof must also be in the SPELLING peaks-loop writes — on BOTH rows. A
 * marker of `1e6` is not a write of this module even though `Number()` reads it
 * as 1000000, and a value of `1e6` equals a marker of `1000000` only because the
 * parser is lenient. Neither is evidence of ownership, so the pair is `human`
 * and is KEPT. An UNPARSEABLE value beside a plain, valid marker still proves
 * corruption of peaks-loop's own write (`500k` beside `1000000`) and stays
 * removable — that recovery is the feature.
 */
function isWindowRemovable(input: {
  readonly fileRaw: unknown;
  readonly markerRaw: unknown;
}): boolean {
  // No absent-side guard: an absent `markerRaw` fails the spelling test below,
  // and an absent `fileRaw` has already returned `stale-marker` in the caller.
  // The guard that used to sit here could not fire, which is why it is gone.
  // The marker is the only evidence that peaks-loop wrote here, so it must be
  // both readable AND plain-spelled before it can authorise a removal.
  if (!isPlainWindowSpelling(input.markerRaw)) return false;
  const marker = parseHarnessWindowTokens(input.markerRaw);
  // Plain-spelled yet unreadable (`0` — in the spelling, outside the positive
  // band): still not a write of this module, so no ownership either.
  if (marker === null) return false;
  const file = parseHarnessWindowTokens(input.fileRaw);
  // Unreadable beside a plain, valid marker: peaks-loop's own write mangled
  // afterwards — the documented `--reset` recovery (`peaks-corrupt`).
  if (file === null) return true;
  // Readable but in a spelling this module cannot have written: not its value.
  // UNLIKE the percent half, which cannot parse such a value at all and so
  // reaches `peaks-corrupt` through the marker arm, the window's lenient parser
  // reads it and would compare it equal — the decision is made one line later.
  if (!isPlainWindowSpelling(input.fileRaw)) return false;
  return marker === file;
}

/**
 * Classify one (value, marker) pair — the single answer to "may `--reset`
 * remove this window, and what do we call it?".
 *
 * `markerRaw !== undefined` with no value is `stale-marker` rather than `none`:
 * the marker IS peaks content and a rollback that left it behind would claim
 * ownership of whatever the user writes into the key next.
 */
export function windowOwnershipOf(input: {
  readonly fileRaw: unknown;
  readonly markerRaw: unknown;
}): HarnessWindowOwnership {
  if (input.fileRaw === undefined && input.markerRaw === undefined) return 'none';
  if (input.fileRaw === undefined) return 'stale-marker';
  if (!isWindowRemovable(input)) return 'human';
  return parseHarnessWindowTokens(input.fileRaw) === null ? 'peaks-corrupt' : 'peaks';
}
