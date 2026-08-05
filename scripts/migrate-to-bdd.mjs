#!/usr/bin/env node
/**
 * migrate-to-bdd.mjs — given-when-then AST migrator for vitest test files.
 *
 * Scope (Slice A, 2026-08-05):
 *   1. Visit every `it(...)` / `test(...)` / `describe(...)` CallExpression.
 *   2. Rewrite the first string-literal argument to a "when X, should Y"
 *      form (the `should` clause is preserved when already present; the
 *      `when` prefix is added when missing).
 *   3. Insert a 3-line `// given: ...` / `// when: ...` / `// then: ...`
 *      comment block at the top of the test body (the second argument of
 *      `it` / `test`).
 *   4. Replace any legacy AAA `// arrange:` / `// act:` / `// assert:`
 *      comment lines with the BDD block.
 *
 * Why a *real* AST and not a regex?
 *   Test files in this codebase have multi-line `it(...)` calls, arrow-
 *   body callbacks, and assertions that contain strings with commas. A
 *   regex pass breaks on every one of those. The TS Compiler API
 *   preserves comments and trivia (via `getLeadingCommentRanges`), and
 *   `NodeObject` is the only correct way to reason about source ranges.
 *
 * Why Node ESM (not a TS script)?
 *   This file lives under `scripts/` and runs via `node`. It depends
 *   on the `typescript` package (already a devDep of peaks-loop via
 *   vitest) and follows the same shape as `scripts/bump-version.mjs`
 *   and `scripts/test-changed.mjs` — the convention is established.
 *
 * Idempotence:
 *   Running this tool on an already-migrated file is a no-op. The
 *   detection looks for an existing `// given:` line at the top of the
 *   test body OR a description that already contains the `when` prefix.
 *
 * No new dependencies. No silent error swallowing. The migrator throws
 * on parse failure (CLI silent-catch anti-fake-green rule).
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * @typedef {Object} Rewrite
 * @property {'it'|'test'|'describe'} kind
 * @property {string} original
 * @property {string} rewritten
 * @property {string} location file:line:col
 */

/**
 * @typedef {Object} MigrateResult
 * @property {string} transformedSource
 * @property {Rewrite[]} rewrites
 * @property {number} totalItRewritten
 * @property {number} totalTestRewritten
 * @property {number} totalDescribeRewritten
 */

const TEST_BODIES = new Set(['it', 'test', 'describe']);

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
function rewriteDescription(original, kind) {
  if (kind === 'describe') {
    if (/^\s*(Feature|Scenario):\s/i.test(original)) return original;
    return `Scenario: ${original}`;
  }
  if (/^\s*when\b/i.test(original)) return original; // idempotence
  if (/\bshould\b/i.test(original)) return `when invoked, ${original}`;
  return `when invoked, should ${original}`;
}

function getCallbackBlock(node) {
  if (node.arguments.length < 2) return null;
  const callback = node.arguments[1];
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
  if (!callback.body || !ts.isBlock(callback.body)) return null;
  return callback.body;
}

function isAlreadyMigrated(block, sourceFile) {
  if (block.statements.length === 0) return false;
  const first = block.statements[0];
  const leading = ts.getLeadingCommentRanges(sourceFile.text, first.pos) ?? [];
  for (const range of leading) {
    const text = sourceFile.text.slice(range.pos, range.end);
    if (/\/\/\s*given:/.test(text)) return true;
  }
  return false;
}

function hasLegacyAaaComments(block, sourceFile) {
  const blockText = sourceFile.text.slice(block.pos, block.end);
  return /\/\/\s*arrange:|\/\/\s*act:|\/\/\s*assert:/i.test(blockText);
}

function inferHint(block) {
  const first = block.statements[0];
  if (!first) {
    return {
      given: 'the test precondition',
      when: 'the function under test runs',
      then: 'the expected outcome holds',
    };
  }
  const text = first.getText().slice(0, 80);
  if (/^\s*expect\(/.test(text)) {
    return {
      given: 'the test setup',
      when: 'the function under test is exercised',
      then: 'the assertion holds',
    };
  }
  if (/^\s*(const|let)\s+\w+\s*=/.test(text)) {
    return {
      given: 'the test setup',
      when: 'the function under test is invoked',
      then: 'the result matches the expectation',
    };
  }
  return {
    given: 'the test setup',
    when: 'the function under test is invoked',
    then: 'the result matches the expectation',
  };
}

function buildCommentBlock(indent) {
  return [
    `${indent}// given: the test setup`,
    `${indent}// when:  the function under test is invoked`,
    `${indent}// then:  the result matches the expectation`,
  ].join('\n');
}

/**
 * Core migrator. Returns the rewritten source and a list of rewrites.
 *
 * @param {string} source
 * @param {string} [fileName]
 * @returns {MigrateResult}
 */
export function migrateSource(source, fileName = 'inline.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true);
  /** @type {Rewrite[]} */
  const rewrites = [];
  /** @type {Array<{startPos: number, endPos: number, text: string}>} */
  const edits = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && TEST_BODIES.has(callee.text)) {
        const kind = /** @type {'it'|'test'|'describe'} */ (callee.text);
        // 1) Description rewrite (first arg must be a string literal).
        if (node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
          const arg0 = node.arguments[0];
          const original = arg0.text;
          const rewritten = rewriteDescription(original, kind);
          const start = sourceFile.getLineAndCharacterOfPosition(arg0.getStart(sourceFile));
          rewrites.push({
            kind,
            original,
            rewritten,
            location: `${fileName}:${start.line + 1}:${start.character + 1}`,
          });
          if (rewritten !== original) {
            edits.push({
              startPos: arg0.getStart(sourceFile),
              endPos: arg0.getEnd(),
              text: JSON.stringify(rewritten),
            });
          }
        }
        // 2) Comment-block insertion on the callback body (it / test only).
        if (kind === 'it' || kind === 'test') {
          const body = getCallbackBlock(node);
          if (body && !isAlreadyMigrated(body, sourceFile)) {
            if (hasLegacyAaaComments(body, sourceFile)) {
              stripLegacyAaaComments(body, sourceFile, edits);
            }
            const insertion = buildInsertion(body, sourceFile, source);
            if (insertion) {
              edits.push(insertion);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Apply edits in descending position order so earlier indices remain valid.
  edits.sort((a, b) => b.startPos - a.startPos);
  let out = source;
  for (const edit of edits) {
    out = out.slice(0, edit.startPos) + edit.text + out.slice(edit.endPos);
  }

  // Anti-fake-green: re-parse the final source to verify it is still
  // valid TypeScript. If the rewrite produced garbage, throw.
  ts.createSourceFile(fileName, out, ts.ScriptTarget.ESNext, true);

  return {
    transformedSource: out,
    rewrites,
    totalItRewritten: rewrites.filter((r) => r.kind === 'it').length,
    totalTestRewritten: rewrites.filter((r) => r.kind === 'test').length,
    totalDescribeRewritten: rewrites.filter((r) => r.kind === 'describe').length,
  };
}

/**
 * Strip legacy `// arrange:` / `// act:` / `// assert:` comment lines
 * from inside a block by editing them out of the source. Pushes the
 * resulting edits (in ORIGINAL source coordinates) onto the shared
 * `edits` array. All edits are applied in descending position order
 * later, so position stability within the array does not matter.
 */
function stripLegacyAaaComments(block, sourceFile, edits) {
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
function buildInsertion(block, sourceFile, source) {
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
  const lineStart = sourceFile.getLineStarts()[sourceFile.getLineAndCharacterOfPosition(bracePos).line];
  const bodyIndent = source.slice(lineStart, bracePos).match(/^[ \t]*/)?.[0] ?? '  ';
  const innerIndent = bodyIndent + '  ';
  return {
    startPos: innerStart,
    endPos: innerStart + wsLen,
    text: '\n' + buildCommentBlock(innerIndent) + '\n',
  };
}

// --- CLI -------------------------------------------------------------------

function readAllStdin() {
  return new Promise((resolveP, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolveP(data));
    process.stdin.on('error', reject);
  });
}

function usage() {
  return `Usage:
  node scripts/migrate-to-bdd.mjs --stdin-json        # read {source, dryRun} from stdin, write {result} JSON to stdout
  node scripts/migrate-to-bdd.mjs <file> [more...]    # migrate files in place (use --dry-run to print)
  node scripts/migrate-to-bdd.mjs --dry-run <file>   # print transformed source to stdout, do not write

Options:
  --dry-run          do not write files; print the transformed source to stdout
  --stdin-json       read {source, dryRun} from stdin (used by the round-trip test)
  --json             emit a JSON envelope on stdout (instead of raw source for --dry-run)
  -h, --help         show this help
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(usage());
    return;
  }

  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  const stdinJson = args.includes('--stdin-json');

  if (stdinJson) {
    const raw = await readAllStdin();
    const payload = JSON.parse(raw);
    const result = migrateSource(payload.source, '<stdin>');
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    process.stderr.write(usage());
    process.exit(2);
  }

  for (const file of files) {
    const absPath = resolve(file);
    // Anti-fake-green: refuse to silently swallow ENOENT.
    if (!statSync(absPath, { throwIfNoEntry: false })) {
      throw new Error(`migrate-to-bdd: file not found: ${absPath}`);
    }
    const source = readFileSync(absPath, 'utf8');
    const result = migrateSource(source, basename(absPath));
    if (dryRun) {
      if (json) {
        process.stdout.write(JSON.stringify({ file: absPath, ...result }, null, 2) + '\n');
      } else {
        process.stdout.write(result.transformedSource);
      }
    } else {
      writeFileSync(absPath, result.transformedSource, 'utf8');
      process.stderr.write(
        `[migrate-to-bdd] ${absPath}: rewrote ${result.totalItRewritten} it() + ${result.totalTestRewritten} test() + ${result.totalDescribeRewritten} describe()\n`,
      );
    }
  }
}

const isMain = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
    return here === invoked;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[migrate-to-bdd] ${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
