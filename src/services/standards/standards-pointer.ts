/**
 * `src/services/standards/standards-pointer.ts`
 *
 * The `@AGENTS.md` pointer line, and the rules that govern it.
 *
 * WHY A MODULE OF ITS OWN. The pointer is not prose — it is a SYNTAX CONTRACT
 * with another tool. Claude Code imports `@AGENTS.md` only when the path
 * stands on a line of its own, unbackticked and unquoted, and it imports it
 * only once: a second occurrence loads the body twice. Every mistake here is
 * SILENT. The file still reads fine, the managed block still says
 * "Constitution: AGENTS.md", and the import simply does not happen — which is
 * how a managed block ends up making a claim that is true for every tool
 * except the one it was written for.
 *
 * THE THREE RULES, IN ONE PLACE:
 *   1. A pointer is a WHOLE LINE. A prose mention of `@AGENTS.md` — backticked,
 *      quoted, or mid-sentence — is not a pointer.
 *   2. There is at most ONE. A file that already carries one is never given
 *      a second.
 *   3. It travels with the managed block: a file that has the block has the
 *      pointer too, so the block's claim is never made to a reader that
 *      cannot act on it.
 *
 * The spelling lives in `standards-render-agents.ts`, next to the renderer
 * that prints it, and is re-exported here — so the writer that adds the line
 * and the planner that looks for it cannot disagree about what the line is.
 */

import { CLAUDE_MD_POINTER_LINE } from './standards-render-agents.js';

export { CLAUDE_MD_POINTER_LINE };

/**
 * True when the file already carries the pointer on a line of its own.
 *
 * A whole-line match, NOT `indexOf('@AGENTS.md')`: a prose mention would
 * satisfy a substring search, the writer would then skip the real pointer,
 * and Claude Code would end up with no import at all.
 */
export function hasPointerLine(content: string): boolean {
  return content.split('\n').some((line) => line.trim() === CLAUDE_MD_POINTER_LINE);
}

/** What the pointer line contributes to one file's write plan. */
export type PointerPlan = {
  /** The file must be given the pointer line. */
  readonly needed: boolean;
  /** The line to add; empty when none is needed. */
  readonly line: string;
};

/**
 * The pointer line's contribution to one file's write plan.
 *
 * `pointerLine` is `null` for the body file: `AGENTS.md` needs no import, and
 * a body that pointed at itself would be circular.
 */
export function planPointer(content: string, pointerLine: string | null): PointerPlan {
  if (pointerLine === null) return { needed: false, line: '' };
  if (hasPointerLine(content)) return { needed: false, line: '' };
  return { needed: true, line: pointerLine };
}

/**
 * The review suggestion a `review` state owes the operator.
 *
 * The managed block says the constitution lives in `AGENTS.md`; without the
 * pointer line Claude Code never reads that file, so the block's claim is
 * true for every other tool and false for the one it was written for. A review
 * state writes nothing, so this is where the operator is told.
 */
export function pointerReviewSuggestion(relativePath: string): string {
  return (
    `Existing ${relativePath} has no standalone \`${CLAUDE_MD_POINTER_LINE}\` line: ` +
    `the managed block's constitution claim does not reach Claude Code until that line is added.`
  );
}

/** The suggestions a `review` state owes the operator. */
export function reviewSuggestions(relativePath: string, needsPointer: boolean): readonly string[] {
  return [
    `Existing ${relativePath} already has a managed standards block. Review the managed block manually before changing it.`,
    ...(needsPointer ? [pointerReviewSuggestion(relativePath)] : [])
  ];
}

/**
 * The whitespace-insensitive form of a text: every run of whitespace around a
 * line break collapses into the line break itself.
 *
 * It is used ONLY for comparisons, never for what is written. The writer owns
 * the bytes; the comparison owns the question "are these the same lines?".
 */
function normalizeLines(text: string): string {
  return text.replace(/\s*\n\s*/g, '\n');
}

/**
 * Does the text that follows the managed block's start marker still count as
 * "the block this writer would write"?
 *
 * The managed block may be followed by the pointer line, with any number of
 * blank lines between the two, and the file still counts as up to date — the
 * block is the same block, and the pointer is where it belongs. Anything else
 * after the block is the user's own text, and the user's own text is a
 * review, never an overwrite.
 */
export function managedBlockMatches(
  tail: string,
  managedBlock: string,
  pointerLine: string | null
): boolean {
  const expected = normalizeLines(managedBlock.trimEnd());
  const actual = normalizeLines(tail.trimEnd());
  if (actual === expected) return true;
  return pointerLine !== null && actual === `${expected}\n${pointerLine}`;
}
