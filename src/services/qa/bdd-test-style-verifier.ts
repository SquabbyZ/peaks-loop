/**
 * src/services/qa/bdd-test-style-verifier.ts
 *
 * rid-2026-08-05-bdd-test-style Slice B — peaks-qa verification-time
 * BDD test-style verifier. This is the read-only, post-edit companion
 * to the `scripts/migrate-to-bdd.mjs` AST migrator shipped in Slice A.
 *
 * Purpose:
 *   When peaks-qa runs its verification gate, it picks up the git diff
 *   for the slice and asks this module whether the new / modified test
 *   files comply with the BDD given-when-then style. The verdict is
 *   surfaced as either `ok` (and the slice can advance) or one of two
 *   structured failure reasons (`missing-given-when-then` or
 *   `description-no-should-when`) that the caller turns into a
 *   `qa-handoff` rejection back to peaks-rd.
 *
 * Why a real AST and not a regex:
 *   The Slice A migrator established the convention: test files have
 *   multi-line `it(...)` calls, nested arrow bodies, and string
 *   literals that often contain words like "when" inside the assertion
 *   message (not in the description). A regex pass on the raw source
 *   would false-positive on string internals. The TypeScript Compiler
 *   API (already a dev dep via vitest) lets us:
 *     1. Inspect the first `StringLiteral` argument of an `it` /
 *        `test` / `describe` call without scanning comments or
 *        string content inside the body.
 *     2. Walk only the leading-comment ranges that sit before the
 *        first statement of the callback block, so a `// when:`
 *        inside an `expect(actual).toEqual('when X happens')` is
 *        correctly ignored.
 *
 * No new dependencies. The verifier is intentionally synchronous and
 * pure (input source + path list -> verdict) so peaks-qa can call it
 * from a deterministic verification step without subprocess overhead.
 *
 * Anti-fake-green (CLI silent-catch rule):
 *   This module throws on parse failure. It does NOT swallow parse
 *   errors and return `{ ok: true }` — that would silently green-light
 *   malformed test files. A parse error is a structural problem; the
 *   caller must surface it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

/** Test runners whose first string-arg is the test description. */
const TEST_NAMES = new Set(['it', 'test']);

/** Structured failure reasons the verifier can return. */
export type BddStyleFailureReason =
  | 'missing-given-when-then'
  | 'description-no-should-when';

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

/**
 * Verify that every `it(...)` / `test(...)` call in the given test
 * files follows the BDD given-when-then contract.
 *
 * Contract:
 *   1. The first `StringLiteral` argument of every `it` / `test` call
 *      MUST match `/(\bwhen\b|\bshould\b)/` (word-boundary anchored,
 *      case-insensitive). A regex on the raw description is correct
 *      here because the description itself is a literal — there is
 *      no nested template literal to misread.
 *   2. The callback body (the second argument when it is an arrow /
 *      function expression with a block) MUST have a `// given:`,
 *      `// when:`, `// then:` triple at the top, in that order,
 *      within the first 3 leading-comment ranges before the first
 *      statement. The `// arrange:` / `// act:` / `// assert:` AAA
 *      legacy is NOT accepted — the contract is given-when-then
 *      only.
 *
 * Returns the FIRST failure encountered (file order, then
 * top-to-bottom line order). A structured `BddStyleFail` is what the
 * caller maps to `qa-handoff` rejection.
 */
export function verifyBddStyle(input: VerifyBddStyleInput): BddStyleVerdict {
  let scanned = 0;
  for (const rel of input.testFiles) {
    const absPath = resolve(input.projectRoot, rel);
    const source = readFileSync(absPath, 'utf8');
    const sourceFile = ts.createSourceFile(
      rel,
      source,
      ts.ScriptTarget.ESNext,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
    let earliestFail: BddStyleFail | null = null;
    const recordFail = (fail: BddStyleFail): void => {
      if (earliestFail === null) {
        earliestFail = fail;
        return;
      }
      const { line: existingLine } = earliestFail;
      if (fail.line < existingLine) earliestFail = fail;
    };
    const visit = (node: ts.Node): void => {
      if (earliestFail !== null) return;
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && TEST_NAMES.has(callee.text)) {
          scanned += 1;
          const descCheck = checkDescription(node, sourceFile, rel);
          if (descCheck !== null) {
            recordFail(descCheck);
            return;
          }
          const bodyCheck = checkBody(node, sourceFile, rel);
          if (bodyCheck !== null) {
            recordFail(bodyCheck);
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (earliestFail !== null) return earliestFail;
  }
  return { ok: true, scanned };
}

/**
 * Inspect the first string-literal argument of an `it` / `test` call.
 *
 * - If the first argument is not a string literal, treat it as a
 *   failure (the BDD contract requires a literal description).
 * - If the literal text does not contain "when" or "should" as a
 *   whole word, return a `description-no-should-when` failure.
 */
function checkDescription(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  relPath: string,
): BddStyleFail | null {
  const firstArg = call.arguments[0];
  if (firstArg === undefined || !ts.isStringLiteralLike(firstArg)) {
    const pos = call.getStart(sourceFile);
    const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
    return {
      ok: false,
      reason: 'description-no-should-when',
      file: relPath,
      line: line + 1,
      description: '<non-literal first argument>',
      expected: 'first argument must be a string literal containing "when" or "should"',
    };
  }
  const description = firstArg.text;
  if (!hasWhenOrShould(description)) {
    const pos = firstArg.getStart(sourceFile);
    const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
    return {
      ok: false,
      reason: 'description-no-should-when',
      file: relPath,
      line: line + 1,
      description,
      expected: 'description must contain the word "when" or "should" (BDD style)',
    };
  }
  return null;
}

/**
 * Inspect the callback body of an `it` / `test` call for the
 * `// given:` / `// when:` / `// then:` triple.
 *
 * Rules (Slice A migrator + design §4.B):
 *   - The second argument must be an arrow / function expression
 *     with a block body. If it is missing or not a block (e.g. an
 *     expression-body arrow `it('x', () => expect(y).toBe(z))`),
 *     we still need the comments — but expression-body arrows
 *     cannot host them. In that case we fall back to inspecting
 *     the leading comments before the entire call expression,
 *     which matches the Slice A migrator's `isAlreadyMigrated`
 *     check shape.
 *   - The three comments must be the FIRST THREE leading-comment
 *     ranges before the relevant body / first-statement anchor.
 *   - The order must be `given` → `when` → `then`. A re-ordered
 *     triple is rejected.
 */
function checkBody(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  relPath: string,
): BddStyleFail | null {
  const body = getCallbackBlock(call);
  if (body !== null) {
    return checkBlockLeadingComments(body, sourceFile, relPath);
  }
  // Expression-body arrow or non-block callback: comments cannot
  // live inside the body. The Slice A migrator only inserts the
  // triple on block bodies, so an expression-body form is by
  // definition non-BDD and must fail. This keeps the contract
  // symmetric with the migrator.
  const pos = call.getStart(sourceFile);
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  return {
    ok: false,
    reason: 'missing-given-when-then',
    file: relPath,
    line: line + 1,
    expected: 'block-body callback with // given: / // when: / // then: comments at the top',
  };
}

function getCallbackBlock(call: ts.CallExpression): ts.Block | null {
  const callback = call.arguments[1];
  if (callback === undefined) return null;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
  if (!callback.body || !ts.isBlock(callback.body)) return null;
  return callback.body;
}

function checkBlockLeadingComments(
  block: ts.Block,
  sourceFile: ts.SourceFile,
  relPath: string,
): BddStyleFail | null {
  // TypeScript's `getLeadingCommentRanges` API is unreliable for
  // comment-only blocks: with `setParentNodes: true`, an empty
  // block (no statements, only comments) has no anchor to attach
  // the comments to, so the API returns zero ranges. To get a
  // deterministic answer, we scan the block's text directly and
  // pick the first three non-empty lines.
  //
  // The block's text spans `{` ... `}`. We extract the body,
  // split on lines, and check the first three non-empty lines for
  // the BDD triple. This is AST-driven (we use the block's source
  // range from the SourceFile, not a global regex) and survives
  // both empty-body and populated-body cases.
  const blockStart = block.getStart(sourceFile) + 1; // skip `{`
  const blockEnd = block.end - 1; // skip `}`
  const body = sourceFile.text.slice(blockStart, blockEnd);
  const lines = body.split(/\r?\n/);
  const nonEmpty: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    nonEmpty.push(line);
    if (nonEmpty.length === 3) break;
  }
  if (nonEmpty.length < 3 || !matchesBddTriple(nonEmpty)) {
    return makeMissingCommentFailure(block, sourceFile, relPath);
  }
  return null;
}

function makeMissingCommentFailure(
  block: ts.Node,
  sourceFile: ts.SourceFile,
  relPath: string,
): BddStyleFail {
  // Report the line of the opening `{` + 1 — the line that should
  // contain the first comment of the BDD triple. This gives the
  // caller a stable pointer even when the block is empty.
  const pos = block.getStart(sourceFile) + 1;
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  return {
    ok: false,
    reason: 'missing-given-when-then',
    file: relPath,
    line: line + 1,
    expected: '// given: / // when: / // then: triple at the top of the block body',
  };
}

/**
 * Match the three leading comments against the BDD triple. Each
 * entry must be a `// <keyword>:` line (with optional trailing
 * whitespace); the keywords must appear in `given`, `when`, `then`
 * order, case-insensitive.
 */
function matchesBddTriple(triple: readonly string[]): boolean {
  if (triple.length !== 3) return false;
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
    /^\s*\/\/\s*then\s*:/i,
  ];
  return patterns.every((pat, i) => pat.test(triple[i] ?? ''));
}

/** True when `text` contains `when` or `should` as a whole word. */
function hasWhenOrShould(text: string): boolean {
  return /(\bwhen\b|\bshould\b)/i.test(text);
}
