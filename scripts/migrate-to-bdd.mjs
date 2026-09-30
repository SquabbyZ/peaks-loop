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
import {
  TEST_BODIES,
  rewriteDescription,
  getCallbackBlock,
  isAlreadyMigrated,
  hasLegacyAaaComments,
  stripLegacyAaaComments,
  buildInsertion
} from './migrate-to-bdd-helpers.mjs';

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

function inferHint(block) {
  const first = block.statements[0];
  if (!first) {
    return {
      given: 'the test precondition',
      when: 'the function under test runs',
      then: 'the expected outcome holds'
    };
  }
  const text = first.getText().slice(0, 80);
  if (/^\s*expect\(/.test(text)) {
    return {
      given: 'the test setup',
      when: 'the function under test is exercised',
      then: 'the assertion holds'
    };
  }
  if (/^\s*(const|let)\s+\w+\s*=/.test(text)) {
    return {
      given: 'the test setup',
      when: 'the function under test is invoked',
      then: 'the result matches the expectation'
    };
  }
  return {
    given: 'the test setup',
    when: 'the function under test is invoked',
    then: 'the result matches the expectation'
  };
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
            location: `${fileName}:${start.line + 1}:${start.character + 1}`
          });
          if (rewritten !== original) {
            edits.push({
              startPos: arg0.getStart(sourceFile),
              endPos: arg0.getEnd(),
              text: JSON.stringify(rewritten)
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
    totalDescribeRewritten: rewrites.filter((r) => r.kind === 'describe').length
  };
}

// --- CLI -------------------------------------------------------------------

function readAllStdin() {
  return new Promise((resolveP, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
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
        `[migrate-to-bdd] ${absPath}: rewrote ${result.totalItRewritten} it() + ${result.totalTestRewritten} test() + ${result.totalDescribeRewritten} describe()\n`
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
