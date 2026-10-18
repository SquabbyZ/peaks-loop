/**
 * src/services/qa/bdd-test-style-verifier.ts
 *
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
import {
  leadingBddComments,
  matchesBddTriple,
  hasWhenOrShould,
  type BddStyleFail,
  type BddStyleVerdict,
  type VerifyBddStyleInput
} from './bdd-test-style-contract.js';

/** Test runners whose first string-arg is the test description. */
const TEST_NAMES = new Set(['it', 'test']);

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
 *      function expression with a block) MUST start with the
 *      `// given:` / `// when:` / `// then:` triple, in that order. The
 *      unit is the leading COMMENT, not the source line: a keyword
 *      comment plus any hanging-indented continuation lines counts as
 *      one, so a wrapped `// given:` does not shift `// when:` into a
 *      later slot. Before any executable code the body must hold exactly
 *      those three comments — a fourth leading comment is refused. The
 *      `// arrange:` / `// act:` / `// assert:` AAA legacy is NOT
 *      accepted — the contract is given-when-then only.
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
      ts.ScriptKind.TS
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
  relPath: string
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
      expected: 'first argument must be a string literal containing "when" or "should"'
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
      expected: 'description must contain the word "when" or "should" (BDD style)'
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
  relPath: string
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
    expected: 'block-body callback with // given: / // when: / // then: comments at the top'
  };
}

/**
 * The callback block of an `it` / `test` call, or null when the call has
 * no block-bodied callback.
 *
 * THE CALLBACK IS NOT `arguments[1]`. vitest accepts an options object
 * between the description and the callback — `it(name, { timeout }, fn)` —
 * and this repo's own test files use that overload. Read at a fixed
 * position, the options object is neither an arrow nor a function
 * expression, so this returned null, the comment check never ran, and a
 * conformant file came back `missing-given-when-then`: a WRONG verdict,
 * not a missed one. So the callback is the LAST argument that is an arrow
 * or a function expression, at whatever arity.
 */
function getCallbackBlock(call: ts.CallExpression): ts.Block | null {
  for (let i = call.arguments.length - 1; i >= 0; i -= 1) {
    const arg = call.arguments[i];
    if (arg === undefined) continue;
    if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
    return ts.isBlock(arg.body) ? arg.body : null;
  }
  return null;
}

function checkBlockLeadingComments(
  block: ts.Block,
  sourceFile: ts.SourceFile,
  relPath: string
): BddStyleFail | null {
  const body = sourceFile.text.slice(block.getStart(sourceFile) + 1, block.end - 1);
  // `matchesBddTriple` also refuses anything other than three comments, so
  // the contract's "exactly three leading comments" needs no second count.
  if (!matchesBddTriple(leadingBddComments(body))) {
    return makeMissingCommentFailure(block, sourceFile, relPath);
  }
  return null;
}

function makeMissingCommentFailure(
  block: ts.Node,
  sourceFile: ts.SourceFile,
  relPath: string
): BddStyleFail {
  // Point at the first line the author must change: the first
  // non-whitespace character inside the braces (where the triple belongs),
  // or just inside the braces when the block is empty. Anchoring on
  // `getStart() + 1` reported the `{` — and with it the `it(` line — one
  // line too early.
  const bodyStart = block.getStart(sourceFile) + 1;
  const bodyEnd = block.end - 1;
  const firstContent = sourceFile.text.slice(bodyStart, bodyEnd).search(/\S/);
  const anchor = firstContent === -1 ? bodyEnd : bodyStart + firstContent;
  const { line } = sourceFile.getLineAndCharacterOfPosition(anchor);
  return {
    ok: false,
    reason: 'missing-given-when-then',
    file: relPath,
    line: line + 1,
    expected: '// given: / // when: / // then: triple at the top of the block body'
  };
}

// The verdict types now live in bdd-test-style-contract.ts; they are
// re-exported here so importers keep using this same path.
export type {
  BddStyleFailureReason,
  BddStyleOk,
  BddStyleFail,
  BddStyleVerdict,
  VerifyBddStyleInput
} from './bdd-test-style-contract.js';
