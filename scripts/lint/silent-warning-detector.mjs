#!/usr/bin/env node
// scripts/lint/silent-warning-detector.mjs
//
// Slice A.2 of v2-14-0-anti-fake-green-hardening — G2 service-layer
// silent-warning interceptor. Static AST scan that flags 4 anti-patterns
// the G2 gate considers "fake-green" (test passes while runtime swallows
// real failure):
//
//   1. empty-catch           — `catch (_e) { /* only comments */ }`
//   2. catch-return-null     — `catch (e) { return null; }` (or undefined)
//   3. promise-reject-no-cause— `Promise.reject(x)` where x is not a
//                              real Error or `{ cause: ... }` envelope
//   4. console-error-no-env  — `console.error(...)` inside a function
//                              that never pushes to `envelope.warnings`
//
// The detector is a REPORTER only. It does NOT auto-fix. Failures are
// surfaced as exit-1 so `pnpm test` blocks merges (A2.4).
//
// Self-exemption: the detector skips itself and its own test cases.
// Grace period: any source line may carry `// TODO(g2):` to suppress the
// violation for one minor release (~6 weeks) per A2.2.
//
// Design notes (Karpathy #1 Think Before Coding):
//   - TS Compiler API is the chosen parser — `typescript` is already a
//     direct devDependency (no new lint libs added per red-line).
//   - Scope is `src/` only. Tests, scripts, and node_modules are walked
//     but filtered; per-file exemption is the second defense layer.
//   - Output is a stable JSON envelope on stdout so the QA test wrapper
//     can re-assert the same data (consistent with the static-scan
//     pattern in scripts/static-scan-mcp-removed.mjs).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const SELF_DIRS = [
  'scripts/lint',
  'tests/unit/lint',
].map((p) => resolve(REPO_ROOT, p));

const SCAN_ROOTS = ['src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

// Lazy-load the TS Compiler API — kept off the cold path so `--help` is
// instant.
let _ts = null;
async function getTs() {
  if (_ts) return _ts;
  const mod = await import(pathToFileURL(resolve(REPO_ROOT, 'node_modules/typescript/lib/typescript.js')).href);
  _ts = mod.default ?? mod;
  return _ts;
}

// ---------- file walking -------------------------------------------------

function* walk(root) {
  const absRoot = resolve(REPO_ROOT, root);
  if (!existsSync(absRoot)) return;
  const stack = [absRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && EXTENSIONS.has(extname(e.name))) {
        yield full;
      }
    }
  }
}

function isSelf(file) {
  return SELF_DIRS.some((dir) => file === dir || file.startsWith(dir + '/') || file.startsWith(dir + '\\'));
}

// ---------- AST analysis -------------------------------------------------

/**
 * Walk an AST and return all violation objects. Each violation:
 *   { rule, file, line, column, message, snippet }
 *
 * Overloaded:
 *   analyzeSource(source, file)         — convenience; resolves TS lazily.
 *   analyzeSource(ts, source, file)     — explicit (used internally + tests).
 */
function analyzeSource(tsArg, sourceArg, fileArg) {
  let ts, source, file;
  if (typeof tsArg === 'string') {
    // (source, file) signature — resolve ts lazily.
    source = tsArg;
    file = sourceArg;
    // Synchronous throw: callers must await loadTs() first if they want
    // the async path. The CLI uses the async path in main(); the unit
    // test imports this function with ts already initialised.
    throw new Error(
      'analyzeSource(source, file): use the async variant `analyzeSourceAsync` or pass the resolved `ts` module.',
    );
  } else {
    ts = tsArg;
    source = sourceArg;
    file = fileArg;
  }
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const violations = [];
  const lineText = source.split(/\r?\n/);

  // Per-function context for rule 4 (console.error vs envelope.warnings).
  // We rebuild a function→body map keyed by the containing function node.
  const fnBodies = collectFunctionBodies(ts, sf);

  function record(rule, node, message, snippet) {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    // Suppress on lines that carry a grace marker.
    const txt = lineText[line] ?? '';
    if (/TODO\(g2\)/.test(txt)) return;
    violations.push({
      rule,
      file: relative(REPO_ROOT, file).replace(/\\/g, '/'),
      line: line + 1,
      column: character + 1,
      message,
      snippet: (snippet ?? txt).trim().slice(0, 200),
    });
  }

  function visit(node) {
    // Pattern 1: catch clause with empty body.
    if (ts.isCatchClause(node)) {
      const body = node.block;
      if (body && isEffectivelyEmptyBlock(ts, body)) {
        record(
          'empty-catch',
          node,
          'catch clause swallows error with empty body — emit to envelope.warnings or rethrow',
        );
      } else if (body && firstMeaningfulStatementIs(ts, body, 'returnNullOrUndefined')) {
        record(
          'catch-return-null',
          body,
          'catch clause returns null/undefined — caller cannot distinguish failure from success',
        );
      }
    }

    // Pattern 3: Promise.reject with no cause envelope.
    if (ts.isCallExpression(node) && isPromiseReject(ts, node)) {
      const [arg] = node.arguments;
      if (!arg) {
        record('promise-reject-no-cause', node, 'Promise.reject() called with no arguments');
      } else if (!isErrorLike(ts, arg) && !hasCauseField(ts, arg)) {
        record(
          'promise-reject-no-cause',
          node,
          'Promise.reject(x) — wrap original error with { cause: originalErr } or throw new Error(...).',
        );
      }
    }

    // Pattern 4: console.error in a function that never references envelope.warnings.
    if (ts.isCallExpression(node) && isConsoleError(ts, node)) {
      const owner = findEnclosingFunction(ts, node);
      if (owner && !fnBodies.get(owner)?.touchesEnvelopeWarnings) {
        record(
          'console-error-no-env',
          node,
          'console.error(...) appears in a function that never references envelope.warnings — route through the envelope so QA can assert visibility.',
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

function isEffectivelyEmptyBlock(ts, block) {
  // Empty body OR body whose only statements are comments / debugger.
  if (block.statements.length === 0) return true;
  return block.statements.every((s) => ts.isEmptyStatement(s));
}

function firstMeaningfulStatementIs(ts, block, kind) {
  for (const stmt of block.statements) {
    if (ts.isEmptyStatement(stmt)) continue;
    if (kind === 'returnNullOrUndefined') {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        const t = stmt.expression.kind;
        if (t === ts.SyntaxKind.NullKeyword || t === ts.SyntaxKind.UndefinedKeyword) return true;
        // TS parses `return undefined` / `return null` as bare identifiers.
        if (ts.isIdentifier(stmt.expression) && (stmt.expression.text === 'null' || stmt.expression.text === 'undefined')) {
          return true;
        }
        // `return foo ?? null` is also a "silent null" anti-pattern.
        if (
          ts.isBinaryExpression(stmt.expression) &&
          stmt.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          return true;
        }
      }
      return false;
    }
    return false;
  }
  return false;
}

function isPromiseReject(ts, node) {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const expr = node.expression;
  if (expr.name.text !== 'reject') return false;
  const obj = expr.expression;
  if (ts.isIdentifier(obj) && obj.text === 'Promise') return true;
  return false;
}

function isErrorLike(ts, arg) {
  if (ts.isNewExpression(arg) && ts.isIdentifier(arg.expression)) {
    const n = arg.expression.text;
    if (n === 'Error' || n.endsWith('Error')) return true;
  }
  if (ts.isIdentifier(arg) && (arg.text === 'err' || arg.text === 'error' || /^[a-z]*(Err|Error)$/.test(arg.text))) {
    return true;
  }
  return false;
}

function hasCauseField(ts, arg) {
  if (!ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name) &&
      p.name.text === 'cause',
  );
}

function isConsoleError(ts, node) {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const expr = node.expression;
  if (expr.name.text !== 'error') return false;
  const obj = expr.expression;
  return ts.isIdentifier(obj) && obj.text === 'console';
}

function collectFunctionBodies(ts, sf) {
  const map = new Map();
  function visit(node) {
    const fn =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node);
    if (fn && node.body) {
      const info = { touchesEnvelopeWarnings: false };
      walkFor(ts, node.body, (n) => {
        // Property access like `envelope.warnings` or `warnings.push(...)`.
        if (ts.isPropertyAccessExpression(n)) {
          const txt = n.getText(sf);
          if (/envelope\s*\.\s*warnings/.test(txt) || /\.warnings\b/.test(n.getText(sf))) {
            info.touchesEnvelopeWarnings = true;
          }
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
          const callee = n.expression;
          if (callee.name.text === 'push') {
            const objText = callee.expression.getText(sf);
            if (/envelope\s*\.\s*warnings/.test(objText) || /\.warnings\b/.test(objText)) {
              info.touchesEnvelopeWarnings = true;
            }
          }
        }
      });
      map.set(node, info);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return map;
}

function walkFor(ts, node, fn) {
  fn(node);
  ts.forEachChild(node, (c) => walkFor(ts, c, fn));
}

function findEnclosingFunction(ts, node) {
  let cur = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

// ---------- driver -------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  const warnOnly = argv.includes('--warn-only');
  const jsonOut = argv.includes('--json');
  const onlyFiles = argv.filter((a) => !a.startsWith('-'));

  const ts = await getTs();

  const allViolations = [];
  let scannedCount = 0;

  const files = [];
  if (onlyFiles.length > 0) {
    for (const f of onlyFiles) {
      const abs = resolve(f);
      if (!existsSync(abs)) continue;
      files.push(abs);
    }
  } else {
    for (const root of SCAN_ROOTS) {
      for (const f of walk(root)) files.push(f);
    }
  }

  for (const file of files) {
    if (isSelf(file)) continue;
    if (!EXTENSIONS.has(extname(file))) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scannedCount++;
    try {
      const v = analyzeSource(ts, text, file);
      allViolations.push(...v);
    } catch (err) {
      // Parse errors are not silent-warning violations; surface them
      // separately so the user knows the detector failed to parse a file.
      if (!jsonOut) {
        process.stderr.write(`[silent-warning-detector] parse error in ${relative(REPO_ROOT, file)}: ${err.message}\n`);
      }
    }
  }

  // Group by rule for the summary table.
  const byRule = new Map();
  for (const v of allViolations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }

  if (jsonOut) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: allViolations.length === 0,
          scannedFiles: scannedCount,
          violationCount: allViolations.length,
          byRule: Object.fromEntries([...byRule.entries()].map(([k, v]) => [k, v.length])),
          violations: allViolations,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`[silent-warning-detector] scanned ${scannedCount} files\n`);
    if (allViolations.length === 0) {
      process.stdout.write(`[silent-warning-detector] OK — no silent-warning anti-patterns detected\n`);
    } else {
      process.stdout.write(`[silent-warning-detector] FAIL — ${allViolations.length} violation(s):\n`);
      for (const v of allViolations) {
        process.stdout.write(`  ${v.file}:${v.line}:${v.column}  [${v.rule}]  ${v.message}\n`);
        process.stdout.write(`      | ${v.snippet}\n`);
      }
      const summary = [...byRule.entries()].map(([k, v]) => `${k}=${v.length}`).join(', ');
      process.stdout.write(`[silent-warning-detector] summary: ${summary}\n`);
    }
  }

  if (allViolations.length === 0) process.exit(0);
  process.exit(warnOnly ? 0 : 1);
}

function printHelp() {
  process.stdout.write(
    [
      'silent-warning-detector — Slice A.2 G2 static AST scan',
      '',
      'Usage:',
      '  node scripts/lint/silent-warning-detector.mjs [options] [files...]',
      '',
      'Options:',
      '  --warn-only   report violations but exit 0 (default: exit 1)',
      '  --json        emit JSON envelope on stdout instead of human text',
      '  -h, --help    show this help',
      '',
      'Defaults to scanning src/. Pass explicit file paths to narrow scope.',
      'Self-exempt: scripts/lint/* and tests/unit/lint/* are never scanned.',
      'Grace marker: add `// TODO(g2):` on the offending line to suppress for one minor release.',
      '',
    ].join('\n'),
  );
}

// CLI entry — guard so this module can be imported by tests without running main.
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain) {
  main().catch((err) => {
    process.stderr.write(`[silent-warning-detector] fatal: ${err.stack ?? err.message}\n`);
    process.exit(2);
  });
}

// Exported for the unit test surface (AC A2.3 self-豁免 requires the test
// file to import the detector and assert on its output directly).
export {
  analyzeSource,
  analyzeSourceAsync,
  isSelf,
  walk,
};

/**
 * Convenience async wrapper so test code can pass (source, file) without
 * having to thread the `ts` module through. Mirrors the CLI path.
 */
async function analyzeSourceAsync(source, file) {
  const ts = await getTs();
  return analyzeSource(ts, source, file);
}