/**
 * Sanitised text for persisted evidence.
 *
 * Page text and a repo-declared route marker are both untrusted: a title is
 * chosen by the tested page, and the marker by a tracked JSON file. Both reach
 * a persisted `DesignCheckResult.message`, a terminal and an artifact, so
 * before either is echoed it loses its control bytes — C0 (which includes ESC,
 * and therefore the ANSI and OSC introducers), DEL and C1 — and is capped so an
 * unbounded designlang payload cannot paste a whole page into the evidence.
 *
 * Matching still runs on the full collapsed text; only the ECHO is capped, so a
 * marker that appears late in a long title is still observed.
 */

/**
 * Control bytes, matched by Unicode category rather than by a literal range: a
 * hand-written `\x00-\x1f` class is a lint error (`no-control-regex`) precisely
 * because such a range in a pattern is usually a bug, and `\p{Cc}` names exactly
 * what is meant — C0 (ESC and its ANSI/OSC introducers included), DEL and C1.
 */
const CONTROL_BYTES = /\p{Cc}/gu;

/** The C0 escape introducer and the one-byte C1 CSI introducer. */
const ESC = '\u001b';
const CSI_C1 = '\u009b';

/**
 * One WHOLE terminal control sequence: a CSI (ESC `[`, or the one-byte C1
 * introducer) through its final byte, or an OSC (ESC `]`) through BEL or the
 * string terminator. Removing the whole sequence before the byte-level strip is
 * what keeps `ESC[2J` from echoing as the printable tail ` [2J`: replacing each
 * `\p{Cc}` byte alone turns only the introducer into a space and leaves `[2J`.
 * The introducers are interpolated from named constants, so the source holds no
 * statically visible control byte (`no-control-regex`). Matching and echo both
 * read the result of this one implementation (`plainText`).
 */
const CONTROL_SEQUENCE = new RegExp(
  `(?:${ESC}\\[|${CSI_C1})[0-?]*[ -/]*[@-~]|${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?`,
  'g'
);

/** One echoed surface: at most this many characters, ellipsis included. */
export const EVIDENCE_SNIPPET_MAX = 120;

/** One whole block detail: at most this many characters, ellipsis included. */
export const EVIDENCE_DETAIL_MAX = 300;

/**
 * Strip whole control sequences, then remaining control bytes, and collapse
 * whitespace. Matching and echo both read this, so a sequence cannot survive in
 * one as printable text while it is removed from the other.
 */
export function plainText(value: string): string {
  return value
    .replace(CONTROL_SEQUENCE, '')
    .replace(CONTROL_BYTES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut `value` to `max` characters, counting the ellipsis as one. */
function capped(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** One page-controlled surface, safe to echo and bounded to 120 characters. */
export function evidenceSnippet(value: string): string {
  return capped(plainText(value), EVIDENCE_SNIPPET_MAX);
}

/** One whole block detail, bounded so the evidence cannot carry a page. */
export function capDetail(detail: string): string {
  return capped(detail, EVIDENCE_DETAIL_MAX);
}
