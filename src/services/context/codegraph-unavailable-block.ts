// src/services/context/codegraph-unavailable-block.ts
//
// The `## Codegraph structure` block a dispatch carries when the codegraph index
// could not be read, and the normalizer that decides which block that is.
//
// WHY THIS IS NOT A SECOND FIELD NEXT TO `codegraphBlock`. The production defect
// was
//
//     codegraphBlock = preflight.available ? preflight.block : null;
//
// `buildCodegraphPreflightBlock` has ALWAYS reported WHY the read failed — its
// `{ available: false, note }` arm carries the upstream stderr/stdout summary —
// and that note was dropped on the floor, so every degraded RD dispatch injected
//
//   ## Codegraph structure
//
//   codegraph unavailable — proceeding on project-scan only.
//
// a line whose only difference from "index read fine" is the word "unavailable".
// Measured live cause on this machine: `unable to open database file` (the wasm
// backend cannot open the WAL-mode `.codegraph/codegraph.db`), which never reached
// a single dispatch record.
//
// So the reason travels IN the same value as the block: `preflight.available ?
// preflight.block : preflight.note` is one expression, and every failure branch of
// the preflight produces a non-empty note. A future edit cannot drop the reason
// without dropping the block too, which is loud instead of silent.
//
// The block shape is unchanged — a `## Codegraph structure` heading, the same
// "proceeding on project-scan only" sentence — so nothing downstream re-learns
// where to look. Only the reason is new.

/** Opens every codegraph block; the discriminator between a block and a bare note. */
export const CODEGRAPH_BLOCK_HEADING = '## Codegraph structure';

/** The sentence shared by the reasonless fallback and the reason-bearing block. */
export const CODEGRAPH_PROCEEDING = 'codegraph unavailable — proceeding on project-scan only.';

/**
 * The sentence the TRULY reasonless fallback renders.
 *
 * Load-bearing, not decoration: the pre-fix block said only "codegraph
 * unavailable", which is byte-for-byte what a reader saw whether upstream printed
 * `unable to open database file` or printed nothing at all. Naming the missing
 * reason makes "no reason exists" a claim the reader can check, and leaves "a
 * reason exists but the dispatch dropped it" with nowhere to hide.
 */
export const CODEGRAPH_REASON_MISSING =
  'No failure reason was obtained from the codegraph preflight.';

/** Opens the reason-bearing variant; asserted absent whenever no reason exists. */
export const CODEGRAPH_REASON_SENTENCE = 'Reason reported by the codegraph preflight: ';

/**
 * Render the block for an unavailable codegraph. `note` is the preflight's own
 * failure note, quoted rather than paraphrased — the point is that the next
 * reader sees `unable to open database file` instead of re-deriving it.
 *
 * The quote is whitespace-collapsed to one line so a multi-line upstream summary
 * cannot forge a markdown heading further down the prompt; it is otherwise
 * verbatim, upstream's own SGR color included. Rewriting the failure text here
 * would put peaks-loop's words where the cause belongs.
 */
export function renderCodegraphUnavailableBlock(note?: string | null): string {
  const reason = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  const body =
    reason.length === 0 ? CODEGRAPH_REASON_MISSING : `${CODEGRAPH_REASON_SENTENCE}${reason}`;
  return `${CODEGRAPH_BLOCK_HEADING}\n\n${CODEGRAPH_PROCEEDING} ${body}\n`;
}

/**
 * The ONE place a `codegraphBlock` value becomes text.
 *
 * - `null` (preflight ran, no reason obtained) → the explicit fallback.
 * - a string already opening with the heading → the pre-composed structure
 *   block, verbatim.
 * - any other string → an unavailable block quoting it as the reported reason.
 *   `buildCodegraphPreflightBlock`'s `{ available: false, note }` arm is the only
 *   production producer of that shape.
 */
export function resolveCodegraphBlock(value: string | null): string {
  if (value === null || value.trim().length === 0) return renderCodegraphUnavailableBlock(null);
  return value.startsWith(CODEGRAPH_BLOCK_HEADING) ? value : renderCodegraphUnavailableBlock(value);
}
