/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the comment /
 * vocabulary-member machinery from `./promotion-artifact-evidence.ts` so that
 * module clears the 300 raw-line cap. These are the declarations the hard-floor
 * reader is built ON (comment masking, comment spans, the member shape, the
 * by-literal merge and the memory-citation pattern); the reader itself
 * (`collectMembers` / `vocabularyMembers` / `hardFloorFailure`) stays where it
 * was, importing these. No body, doc comment or regex changed.
 */

/**
 * One pattern, used by BOTH the masker and the doc reader, so a comment can
 * never be blanked by one and read as a doc by the other.
 */
const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** Comments are blanked to spaces, which keeps every offset in the file valid. */
export function maskComments(text: string): string {
  return text.replace(COMMENT_RE, (comment) => ' '.repeat(comment.length));
}

export type CommentSpan = { start: number; end: number; text: string };

export function commentSpans(source: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  COMMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMENT_RE.exec(source)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return spans;
}

export type VocabularyMember = {
  literal: string;
  doc: string;
  /**
   * R10: does this member sit in the declaration that ENFORCES — the
   * `HARD_FLOOR_CATEGORIES` array `isHardFloorCategory` reads? A member of the
   * `HardFloorCategory` union alone is a type; it pauses nothing, so it is not
   * evidence that a rule is a hard floor.
   */
  enforcing: boolean;
};

/**
 * R10 — one entry per literal, and `enforcing` is only ever set by the array.
 *
 * Reading the two declarations as one flat member list let a member of the
 * `HardFloorCategory` union ALONE satisfy this check while
 * `isHardFloorCategory` — and therefore `shouldPauseAtGate` — did not recognise
 * it. The gate reported BACKED for a hard floor that paused nothing. Splitting
 * the provenance of `enforcing` out of the member list is what makes the two
 * agree: what the predicate accepts is exactly what the array contains.
 *
 * The docs are joined across occurrences rather than kept per-declaration,
 * because a category's doc belongs to the CATEGORY. This repo's own layer-C
 * promotion cites `.peaks/memory/2026-06-28-full-auto-boundary.md` from the
 * comment beside the UNION member of `commit-boundary-side-effect`, while the
 * ARRAY is what enforces it; reading the doc from one declaration only would
 * make that citation unreadable — a false negative on a file already known good.
 */
export function mergeByLiteral(members: readonly VocabularyMember[]): VocabularyMember[] {
  const merged = new Map<string, VocabularyMember>();
  for (const member of members) {
    const previous = merged.get(member.literal);
    merged.set(member.literal, {
      literal: member.literal,
      doc: [previous?.doc, member.doc].filter((doc) => doc !== undefined && doc !== '').join('\n'),
      enforcing: (previous?.enforcing ?? false) || member.enforcing
    });
  }
  return [...merged.values()];
}

/** A memory cited by path, the way this repo cites one (`mode-gate.ts:41`). */
const MEMORY_CITATION_RE = /\.peaks\/memory\/([A-Za-z0-9._-]+)\.md/g;

export function citedMemories(doc: string): string[] {
  return Array.from(doc.matchAll(MEMORY_CITATION_RE), (match) => match[1] as string);
}
