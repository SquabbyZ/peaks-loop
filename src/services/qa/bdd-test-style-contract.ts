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
