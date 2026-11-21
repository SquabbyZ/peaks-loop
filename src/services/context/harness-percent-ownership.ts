/**
 * WHO owns the harness auto-compact PERCENT key — one predicate, one classifier.
 *
 * This module exists so the three sides that have to agree about ownership (the
 * writer, the rollback, the state report) cannot drift into three spellings of
 * the same question. It is also what keeps the write half under the file-size
 * cap, since every one of those sides needs this and nothing else from it.
 *
 * The percent key is `IdeCompactProfile.autoCompactPercentEnvVar` (declared per
 * adapter — no IDE names here) and its provenance marker is
 * `HARNESS_PERCENT_WRITTEN_KEY`, the twin of the window's.
 */

/**
 * WHO owns the harness auto-compact PERCENT key — one predicate, one classifier.
 *
 * This module exists so the three sides that have to agree about ownership (the
 * writer, the rollback, the state report) cannot drift into three spellings of
 * the same question. It also hosts the MED-2 bounded vocabulary below, which the
 * window module and the envelope views share.
 *
 * The percent key is `IdeCompactProfile.autoCompactPercentEnvVar` (declared per
 * adapter — no IDE names here) and its provenance marker is
 * `HARNESS_PERCENT_WRITTEN_KEY`, the twin of the window's.
 */

import { readSettingsObject, settingsEnvValue } from './harness-settings-file.js';

/**
 * MED-2 bounded vocabulary. A value here comes from a user-writable settings key
 * whose rows reach JSON envelopes and logs, so a secret mis-parked at it must not
 * travel: a plain integer (never a secret, and `150` out of band is the case the
 * user must see) is NAMED; anything else is a fixed phrase plus a CHARACTER
 * COUNT — no content, not even a prefix.
 */
const NAMED_INTEGER_MAX_DIGITS = 12;

/** Whole-content plain decimal integer of at most `NAMED_INTEGER_MAX_DIGITS`. */
export function isPlainIntegerSpelling(raw: unknown): boolean {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && String(Math.abs(raw)).length <= NAMED_INTEGER_MAX_DIGITS;
  }
  if (typeof raw !== 'string') return false;
  return new RegExp(`^-?\\d{1,${String(NAMED_INTEGER_MAX_DIGITS)}}$`).test(raw.trim());
}

/** How an unparseable settings value is described back (see above). */
export function boundedRawNote(raw: unknown): string {
  if (raw === undefined) return 'not set';
  if (typeof raw === 'number' && isPlainIntegerSpelling(raw)) return `the number ${String(raw)}`;
  if (typeof raw === 'string' && isPlainIntegerSpelling(raw)) return `the number ${raw.trim()}`;
  if (Array.isArray(raw)) return 'an array (not echoed here)';
  if (typeof raw === 'object' && raw !== null) return 'an object (not echoed here)';
  const length = typeof raw === 'string' ? raw.length : 1;
  return `a value that is not a number (${String(length)} chars, not echoed here)`;
}

/**
 * Provenance marker for the percent key, the twin of
 * `HARNESS_WINDOW_WRITTEN_KEY`: it records the value peaks-loop ITSELF last
 * wrote, so a value that differs is a human's own setting and is never
 * overwritten. Travels in the same write as the value it describes.
 */
export const HARNESS_PERCENT_WRITTEN_KEY = 'PEAKS_HARNESS_PERCENT_WRITTEN';

/**
 * The band the harness accepts for the percentage. It is a PERCENTAGE of the
 * window, so 1..100 — and, like the window band, out-of-band values are
 * REFUSED rather than clamped: a clamped write would put a different number in
 * the file from the one reported, which is the same two-numbers drift the
 * window band exists to prevent.
 */
export const HARNESS_COMPACT_PERCENT_MIN = 1;
/** See `HARNESS_COMPACT_PERCENT_MIN`. */
export const HARNESS_COMPACT_PERCENT_MAX = 100;

/**
 * THE SPELLING peaks-loop writes (and therefore the only one it reads back):
 * a plain decimal with NO leading zero beyond a lone `0`. `80.0`, `8e1`, `+80`,
 * `080` and `00080` all evaluate to an in-band number under `Number()`, but
 * none of them is a value this module can have written — `String(percent)`
 * emits `80` and nothing else — so accepting them would let a hand edit or
 * another tool masquerade as peaks-loop's own output. A value peaks-loop cannot
 * have written is reported as unreadable, which is the honest state, and the
 * `--reset` advice follows the OWNERSHIP of the value rather than this
 * spelling (see `harness-compact-threshold-ensure.ts`).
 *
 * Two spellings matter for ownership, not for the band:
 *   - a lone `0`: `String(0)` is `0`, so `0` IS a spelling peaks-loop can
 *     emit. Paired with its own marker it is `peaks-corrupt` (out of band,
 *     removable), which is why it must parse here.
 *   - a leading zero (`080`): `String(80)` never emits one, so it is NOT a
 *     spelling peaks-loop writes — it must not parse to `80` (that let it equal
 *     its marker and be overwritten). It is also not evidence of a takeover:
 *     beside a VALID marker `80` it is peaks-loop's own `80` mangled afterwards,
 *     so `isHarnessPercentRemovable` classifies it `peaks-corrupt` through the
 *     marker-parses arm, never `human`.
 */
const PLAIN_PERCENT_SPELLING = /^(?:0|[1-9]\d*)$/;

/** In the harness's percent band AND a whole number. */
function isPercentInBand(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= HARNESS_COMPACT_PERCENT_MIN &&
    value <= HARNESS_COMPACT_PERCENT_MAX
  );
}

/**
 * Parse a candidate percent. Whole integers 1..100 only (a number, or the
 * numeric string a JSON `env` block always carries, in the plain decimal
 * spelling `PLAIN_PERCENT_SPELLING` requires). Anything else — `0`, `101`,
 * `80.5`, `80.0`, `8e1`, `'abc'`, `''`, `null` — is null, so callers can
 * distinguish "absent" from "unusable" via the RAW value.
 */
export function parseHarnessCompactPercent(raw: unknown): number | null {
  if (typeof raw === 'number') return isPercentInBand(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!PLAIN_PERCENT_SPELLING.test(text)) return null;
  const parsed = Number(text);
  return isPercentInBand(parsed) ? parsed : null;
}

/**
 * THE WRITER'S OWNERSHIP PREDICATE — strict, and deliberately NOT the one the
 * rollback uses. See `percentOwnershipOf` for the pair.
 *
 * A value is the writer's to OVERWRITE only when `HARNESS_PERCENT_WRITTEN_KEY`
 * is present and BOTH sides parse to the same number.
 *
 * The asymmetry with `isHarnessPercentRemovable` is the point. Removing a value
 * deserves a wider rule than overwriting one: `--reset` is the documented
 * recovery from a broken value and the user asked for it, while a probe or an
 * init rewriting a value it cannot read would destroy the raw text the user
 * needs in order to see what went wrong. Widening THIS predicate is how a
 * background probe would silently replace a human's `eighty` — the exact
 * "peaks-loop overruled my setting" failure the provenance marker exists to
 * prevent.
 */
export function isHarnessPercentPeaksOwned(input: {
  readonly fileRaw: unknown;
  readonly markerRaw: unknown;
}): boolean {
  const file = parseHarnessCompactPercent(input.fileRaw);
  const marker = parseHarnessCompactPercent(input.markerRaw);
  return file !== null && marker === file;
}

/**
 * THE ROLLBACK'S OWNERSHIP PREDICATE — what `--reset` may REMOVE.
 *
 * Wider than `isHarnessPercentPeaksOwned` by exactly ONE shape, which proves the
 * value is a corruption of peaks-loop's own write rather than a human pin: the
 * marker parses while the VALUE does not. peaks-loop only ever writes
 * `String(n)` as its marker (a plain in-band integer), so a VALID numeric
 * marker beside an unreadable value can only be its own write mangled
 * afterwards — and that is the documented `--reset` recovery.
 *
 * No marker ⇒ human. A parseable value that differs from a parseable marker ⇒
 * human takeover. A marker that does not parse is NOT evidence of ownership in
 * any combination: an unreadable value beside it is the user's own (even when
 * the two strings are equal — a human who typed the same typo into both rows
 * proved nothing about peaks-loop), and it is KEPT. The earlier "both raws are
 * equal and unreadable" arm classified that pair `peaks-corrupt` and `--reset`
 * deleted a user value; it is gone.
 */
export function isHarnessPercentRemovable(input: {
  readonly fileRaw: unknown;
  readonly markerRaw: unknown;
}): boolean {
  if (input.fileRaw === undefined || input.markerRaw === undefined) return false;
  const file = parseHarnessCompactPercent(input.fileRaw);
  const marker = parseHarnessCompactPercent(input.markerRaw);
  if (file !== null) return marker === file;
  return marker !== null;
}

/**
 * WHO the percent value on disk belongs to — the five states, named once so the
 * rollback and the state report cannot describe the same file differently.
 *
 *   - `peaks`         — matches its marker: both sides parse to the same number
 *   - `peaks-corrupt` — marker present and parseable while the VALUE is not: a
 *                       corruption of peaks-loop's own write
 *   - `human`         — no marker, a parseable value that differs from its
 *                       marker (a takeover), or any value whose MARKER does not
 *                       parse (peaks-loop never wrote such a marker)
 *   - `stale-marker`  — the value was deleted by hand, the marker survived
 *   - `none`          — neither the value nor a marker
 */
export type HarnessPercentOwnership = 'peaks' | 'peaks-corrupt' | 'human' | 'stale-marker' | 'none';

/**
 * Classify one (value, marker) pair — the single answer to "may `--reset`
 * remove this, and what do we call it?".
 */
export function percentOwnershipOf(input: {
  readonly fileRaw: unknown;
  readonly markerRaw: unknown;
}): HarnessPercentOwnership {
  if (input.fileRaw === undefined && input.markerRaw === undefined) return 'none';
  if (input.fileRaw === undefined) return 'stale-marker';
  if (!isHarnessPercentRemovable(input)) return 'human';
  return parseHarnessCompactPercent(input.fileRaw) === null ? 'peaks-corrupt' : 'peaks';
}

/** What the file currently holds for the percent key, ownership included. */
export interface HarnessPercentState {
  readonly key: string;
  /**
   * A BOUNDED description of what the file holds, present only when the key
   * exists — never the raw string (MED-2). This state is printed as JSON and
   * folded into logs, and the value is user-writable, so a secret mis-parked
   * there must not travel. Its PRESENCE is what tells "holds something that
   * does not parse" from "absent"; see `boundedRawNote`.
   */
  readonly rawNote?: string;
  /** The parsed percent, or null when absent / unparseable. */
  readonly percent: number | null;
  readonly ownership: HarnessPercentOwnership;
}

/**
 * Read the percent half of the pair — the state-report counterpart of
 * `readHarnessWindowState`, so `peaks compact harness-window` can show BOTH
 * knobs it manages rather than only the window.
 */
export function readHarnessPercentState(
  settingsPath: string,
  percentKey: string
): HarnessPercentState {
  const settings = readSettingsObject(settingsPath);
  const raw = settingsEnvValue(settings, percentKey);
  const markerRaw = settingsEnvValue(settings, HARNESS_PERCENT_WRITTEN_KEY);
  // The raw value is bounded HERE, at the point it would leave the module:
  // deciding it once, at the source, means no caller can forget to map it.
  return {
    key: percentKey,
    ...(raw === undefined ? {} : { rawNote: boundedRawNote(raw) }),
    percent: parseHarnessCompactPercent(raw),
    ownership: percentOwnershipOf({ fileRaw: raw, markerRaw })
  };
}
