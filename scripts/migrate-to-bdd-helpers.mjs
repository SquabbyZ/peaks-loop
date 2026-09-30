/**
 * migrate-to-bdd-helpers.mjs — AST helper declarations relocated from
 * `scripts/migrate-to-bdd.mjs` purely to bring that script under the 300-line
 * file cap. Every function below is moved VERBATIM — no behaviour change.
 * The migrator (`migrate-to-bdd.mjs`) imports these.
 */
import ts from 'typescript';

export const TEST_BODIES = new Set(['it', 'test', 'describe']);

/**
 * Rewrite a plain test description into a BDD-friendly form.
 *
 * - For `it` / `test`: produce a "when X, should Y" form.
 *   Rules (first match wins):
 *     1. If the original is already in BDD form (matches
 *        /^\s*when\b/i), keep it as-is. This is the idempotence
 *        guard — re-running the migrator on a migrated file is a
 *        no-op.
 *     2. If it contains " should " (case-insensitive) but is not
 *        already a BDD form, prefix with "when invoked, " (a
 *        stable, business-neutral prefix).
 *     3. Otherwise, treat the original as the should-clause and
 *        produce "when invoked, should <original>".
 *
 * - For `describe`: produce a "Scenario: <name>" form.
 *   Rules (first match wins):
 *     1. If the original already starts with "Feature: " or
 *        "Scenario: ", keep it as-is.
 *     2. Otherwise, prefix with "Scenario: ".
 */
export function rewriteDescription(original, kind) {
  if (kind === 'describe') {
    if (/^\s*(Feature|Scenario):\s/i.test(original)) return original;
    return `Scenario: ${original}`;
  }
  if (/^\s*when\b/i.test(original)) return original; // idempotence
  if (/\bshould\b/i.test(original)) return `when invoked, ${original}`;
  return `when invoked, should ${original}`;
}

export function getCallbackBlock(node) {
  if (node.arguments.length < 2) return null;
  const callback = node.arguments[1];
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
  if (!callback.body || !ts.isBlock(callback.body)) return null;
  return callback.body;
}

export function isAlreadyMigrated(block, sourceFile) {
  if (block.statements.length === 0) return false;
  const first = block.statements[0];
  const leading = ts.getLeadingCommentRanges(sourceFile.text, first.pos) ?? [];
  for (const range of leading) {
    const text = sourceFile.text.slice(range.pos, range.end);
    if (/\/\/\s*given:/.test(text)) return true;
  }
  return false;
}

export function hasLegacyAaaComments(block, sourceFile) {
  const blockText = sourceFile.text.slice(block.pos, block.end);
  return /\/\/\s*arrange:|\/\/\s*act:|\/\/\s*assert:/i.test(blockText);
}

export function buildCommentBlock(indent) {
  return [
    `${indent}// given: the test setup`,
    `${indent}// when:  the function under test is invoked`,
    `${indent}// then:  the result matches the expectation`
  ].join('\n');
}

/**
 * Strip legacy `// arrange:` / `// act:` / `// assert:` comment lines
 * from inside a block by editing them out of the source. Pushes the
 * resulting edits (in ORIGINAL source coordinates) onto the shared
 * `edits` array. All edits are applied in descending position order
 * later, so position stability within the array does not matter.
 */
export function stripLegacyAaaComments(block, sourceFile, edits) {
  const text = sourceFile.text;
  // `block.pos` points to the character BEFORE `{`; use `getStart` to
  // anchor the scan to the line that actually opens the block.
  const startLine = sourceFile.getLineAndCharacterOfPosition(block.getStart(sourceFile)).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(block.end).line;
  const lineStarts = sourceFile.getLineStarts();
  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
    const lineStartPos = lineStarts[lineIdx];
    const lineEndPos = lineIdx + 1 < lineStarts.length ? lineStarts[lineIdx + 1] : text.length;
    // Strip the trailing newline (if any) from this slice.
    let lineEndTrim = lineEndPos;
    if (lineEndTrim > lineStartPos && text[lineEndTrim - 1] === '\n') lineEndTrim -= 1;
    if (lineEndTrim > lineStartPos && text[lineEndTrim - 1] === '\r') lineEndTrim -= 1;
    const lineText = text.slice(lineStartPos, lineEndTrim);
    if (/^\s*\/\/\s*(arrange|act|assert):/i.test(lineText)) {
      // Replace the entire line content (including its trailing newline)
      // with the leading whitespace only. This keeps downstream line
      // numbers stable (re-runs of `getLineAndCharacterOfPosition` will
      // still produce a coherent map) and removes the AAA comment.
      const indentMatch = /^[ \t]*/.exec(lineText);
      const indent = indentMatch ? indentMatch[0] : '';
      edits.push({ startPos: lineStartPos, endPos: lineEndPos, text: indent });
    }
  }
}

/**
 * Build the comment-block insertion edit for an `it` / `test` callback
 * body. Returns null if the body is malformed (no `{`).
 *
 * IMPORTANT: in TypeScript's AST, a Block node's `pos` points to the
 * character BEFORE the `{` (typically the whitespace between `=>` and
 * `{`). The actual `{` lives at `block.getStart(sourceFile)`. We must
 * use the latter to compute the insertion position; otherwise the
 * edit replaces the space between `=>` and `{` and shreds the arrow.
 */
export function buildInsertion(block, sourceFile, source) {
  const blockText = block.getText();
  const openBraceIdx = blockText.indexOf('{');
  if (openBraceIdx === -1) return null;
  const bracePos = block.getStart(sourceFile);
  const innerStart = bracePos + 1;
  // Skip any whitespace immediately after the open brace (newline + spaces).
  const tail = source.slice(innerStart);
  const wsMatch = /^[ \t]*\r?\n?/.exec(tail);
  const wsLen = wsMatch ? wsMatch[0].length : 0;
  // Indent for the new comment lines = body's outer indent + 2 spaces.
  const lineStart =
    sourceFile.getLineStarts()[sourceFile.getLineAndCharacterOfPosition(bracePos).line];
  const bodyIndent = source.slice(lineStart, bracePos).match(/^[ \t]*/)?.[0] ?? '  ';
  const innerIndent = bodyIndent + '  ';
  return {
    startPos: innerStart,
    endPos: innerStart + wsLen,
    text: '\n' + buildCommentBlock(innerIndent) + '\n'
  };
}
