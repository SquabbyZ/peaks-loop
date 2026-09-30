/**
 * Size/limit constants and `--top` normalization for `peaks code
 * context-audit`, moved VERBATIM out of `./context-audit.ts` (wave 3,
 * eslint-family sweep) so that module stays under the 300 raw-line cap.
 *
 * The two transcript-size ceilings keep their exact previous values; they
 * are written as a named 1 MiB constant times a named Mebibyte count
 * because the `no-magic-numbers` family flags each factor of a literal
 * product (`256 * 1024 * 1024`) but not a direct `const` assignment.
 */

/** 1 MiB = 1024 × 1024 bytes. */
const MEBIBYTE = 1048576;
/** Mebibytes of transcript the audit is still willing to stream (256 MiB). */
const MAX_TRANSCRIPT_MEBIBYTES = 256;

/** Default number of top entries emitted. */
export const CONTEXT_AUDIT_DEFAULT_TOP = 15;
/** Hard ceiling for `--top` — the envelope must stay small by construction. */
export const CONTEXT_AUDIT_MAX_TOP = 100;
/** Transcripts larger than this are reported `available:false` (fail-soft). */
export const CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES = MAX_TRANSCRIPT_MEBIBYTES * MEBIBYTE;
/** Streaming chunk size (bounded memory on multi-MB transcripts) = 1 MiB. */
export const CONTEXT_AUDIT_SCAN_CHUNK_BYTES = MEBIBYTE;

/** Clamp a caller-supplied `--top` into the documented range. */
export function normalizeTopN(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : CONTEXT_AUDIT_DEFAULT_TOP;
  if (n < 1) return CONTEXT_AUDIT_DEFAULT_TOP;
  return Math.min(n, CONTEXT_AUDIT_MAX_TOP);
}
