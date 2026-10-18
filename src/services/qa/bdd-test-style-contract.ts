/**
 * `src/services/qa/bdd-test-style-contract.ts`
 *
 * Verdict types and pure string matchers extracted verbatim from
 * `bdd-test-style-verifier.ts` (wave 2, file-size cap campaign) so the
 * verifier stays under the 300 raw-line cap. Mechanical move only —
 * the verifier re-exports every public type from its original path.
 */

/** Structured failure reasons the verifier can return. */
export type BddStyleFailureReason = 'missing-given-when-then' | 'description-no-should-when';

/** Successful verdict — includes the count of inspected `it`/`test` calls. */
export interface BddStyleOk {
  readonly ok: true;
  readonly scanned: number;
}

/** Structured failure verdict — the file/line makes the rejection actionable. */
export interface BddStyleFail {
  readonly ok: false;
  readonly reason: BddStyleFailureReason;
  readonly file: string;
  readonly line: number;
  /** For `description-no-should-when`: the original description. */
  readonly description?: string;
  /** For `missing-given-when-then`: a stable string the caller can compare. */
  readonly expected?: string;
}

export type BddStyleVerdict = BddStyleOk | BddStyleFail;

/** Public input surface — keep small so the contract is hard to misuse. */
export interface VerifyBddStyleInput {
  readonly projectRoot: string;
  readonly testFiles: readonly string[];
}

/** Number of comment lines that make up the BDD triple (`given`/`when`/`then`). */
const BDD_TRIPLE_SIZE = 3;

/**
 * Match the three leading comments against the BDD triple. Each
 * entry must be a `// <keyword>:` line (with optional trailing
 * whitespace); the keywords must appear in `given`, `when`, `then`
 * order, case-insensitive.
 */
export function matchesBddTriple(triple: readonly string[]): boolean {
  if (triple.length !== BDD_TRIPLE_SIZE) return false;
  // Each entry must be a `// <keyword>:` line, optionally followed
  // by descriptive text. The Slice A migrator's `buildCommentBlock`
  // produces `// given: the test setup` / `// when:  the function
  // under test is invoked` / `// then:  the result matches the
  // expectation` — the `when` line uses two spaces after the colon
  // for visual alignment with `given:` and `then:`, so the regex
  // is intentionally permissive about trailing text.
  const patterns: readonly RegExp[] = [
    /^\s*\/\/\s*given\s*:/i,
    /^\s*\/\/\s*when\s*:/i,
    /^\s*\/\/\s*then\s*:/i
  ];
  return patterns.every((pat, i) => pat.test(triple[i] ?? ''));
}

/** True when `text` contains `when` or `should` as a whole word. */
export function hasWhenOrShould(text: string): boolean {
  return /(\bwhen\b|\bshould\b)/i.test(text);
}

/** True when a `//` line starts with one of the three BDD keywords. */
function isBddKeywordLine(line: string): boolean {
  return /^\s*\/\/\s*(?:given|when|then)\s*:/i.test(line);
}

/**
 * The leading logical comments of a callback block, in source order.
 *
 * The contract's unit is the COMMENT, not the source line
 * (`contracts/test-style-contract.md` §1.2: the body must start with
 * "exactly three leading comments"). A `// given:` wrapped onto a second
 * line is still ONE comment, so it must not consume a second slot and push
 * `// when:` out of the triple. A comment line that carries no keyword
 * counts as a continuation of the previous comment only when it is
 * hanging-indented beneath that comment's text; written at the same column
 * it is a separate leading comment, and a fourth one violates "exactly
 * three".
 *
 * Scanning stops at the first executable line: only the region before any
 * executable code is contract-bound, so comments after it are permitted.
 */
export function leadingBddComments(blockBody: string): string[] {
  const comments: string[] = [];
  let previousContentColumn = -1;
  for (const line of blockBody.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    if (!line.trimStart().startsWith('//')) break;
    const commentAt = line.indexOf('//');
    const content = line.slice(commentAt + 2);
    if (content.trim().length === 0) continue;
    const contentColumn = commentAt + 2 + (content.length - content.trimStart().length);
    if (comments.length > 0 && !isBddKeywordLine(line) && contentColumn > previousContentColumn) {
      continue; // hanging-indent continuation of the previous comment
    }
    comments.push(line);
    previousContentColumn = contentColumn;
  }
  return comments;
}
