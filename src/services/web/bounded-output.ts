/**
 * Byte-aware output caps for `peaks web` (slice S1, AC2).
 *
 * `capText` is the only absolute guarantee in the snapshot pipeline: the
 * pruner (`snapshot-pruner.ts`) bounds node count and depth, but only a byte
 * ceiling bounds the rendered string. These are module constants, not options
 * (tech-doc §12).
 */

/** Hard ceiling for page text returned by `peaks web text`. */
export const MAX_TEXT_BYTES = 8192;

/** Hard ceiling for the rendered snapshot returned by `peaks web snap`. */
export const MAX_SNAP_BYTES = 4096;

/** Maximum number of real (non-marker) nodes emitted by the pruner. */
export const MAX_SNAP_NODES = 120;

/** Maximum tree depth emitted by the pruner. */
export const MAX_SNAP_DEPTH = 6;

export interface CappedText {
  readonly text: string;
  readonly truncated: boolean;
  /** UTF-8 bytes removed from the input. `0` when nothing was truncated. */
  readonly droppedBytes: number;
}

/** The marker appended to a truncated payload. Counted INSIDE the ceiling. */
function truncationMarker(droppedBytes: number): string {
  return `\n…[truncated ${droppedBytes} bytes]`;
}

/**
 * Cut `text` down to at most `capBytes` UTF-8 bytes.
 *
 * Three properties the AC2 tests pin:
 *   - the returned string's byte length is **never** greater than `capBytes`
 *     (the truncation marker is reserved out of the budget, not added on top);
 *   - a multi-byte codepoint is never split (the cut backs off the UTF-8
 *     continuation bytes), so the result is always valid UTF-8;
 *   - the cut lands on a line boundary when one exists, so the caller never
 *     gets a half-line.
 */
export function capText(text: string, capBytes: number): CappedText {
  const total = Buffer.byteLength(text, 'utf8');
  if (total <= capBytes) {
    return { text, truncated: false, droppedBytes: 0 };
  }

  // Reserve the WIDEST possible marker (the one whose byte count equals the
  // whole input) so the ceiling holds on the first pass: the reported marker
  // can only be narrower than the reserved one.
  const reservedMarkerBytes = Buffer.byteLength(truncationMarker(total), 'utf8');
  if (capBytes < reservedMarkerBytes) {
    // The marker alone would blow the ceiling. The invariant is unconditional,
    // so for a cap too narrow to hold it the whole payload goes.
    return { text: '', truncated: true, droppedBytes: total };
  }
  const kept = cutAtLineBoundary(text, capBytes - reservedMarkerBytes);
  const droppedBytes = total - Buffer.byteLength(kept, 'utf8');
  return { text: kept + truncationMarker(droppedBytes), truncated: true, droppedBytes };
}

/**
 * Largest valid-UTF-8 byte prefix of `text` at or below `budget`, backed off
 * to the last line break. `text` without any newline keeps the raw byte cut.
 */
function cutAtLineBoundary(text: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }
  const bytes = Buffer.from(text, 'utf8');
  let end = Math.min(budget, bytes.length);
  // A continuation byte (0b10xxxxxx) at the cut point means the codepoint that
  // started earlier would be split, so walk back until it is not one.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  const prefix = bytes.subarray(0, end).toString('utf8');
  const lastBreak = prefix.lastIndexOf('\n');
  return lastBreak > 0 ? prefix.slice(0, lastBreak) : prefix;
}
