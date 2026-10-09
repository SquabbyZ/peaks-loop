// scripts/lint/silent-warning-analyze.mjs
//
// The scan itself: one `SourceFile` in, the violations it holds out.
//
// `analyzeSource` was one 119-line function declaring two closures. Both closures are
// now named module-level factories that take what they closed over as ARGUMENTS, and
// `analyzeSource` composes them — the statements, the ordering and the strings are
// unchanged.
//
// Split out of `scripts/lint/silent-warning-detector.mjs` (rid-043). This module is a
// REPORTER the gate runs; the split moved code and changed no detection logic.

import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectFunctionBodies,
  findEnclosingFunction,
  firstMeaningfulStatementIs,
  hasCauseField,
  isConsoleError,
  isEffectivelyEmptyBlock,
  isErrorLike,
  isPromiseReject
} from './silent-warning-ast.mjs';

/**
 * The repo root, as the violation paths are reported against it: this file sits in
 * `scripts/lint/`, two levels below it — the same value the entry computes for itself.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The violation recorder: it decides the line extent, honours the `TODO(g2)` grace
 * marker, and pushes into the caller's array.
 *
 * The suppression below is the whole reason this is a named factory rather than an
 * inline closure: the rule is "a marker on ANY line the reported node SPANS", and that
 * paragraph is the contract `silent-warning-grace-marker.test.ts` pins.
 *
 * @param {import('typescript')} ts
 * @param {import('typescript').SourceFile} sf
 * @param {string[]} lineText
 * @param {Array<object>} violations
 * @param {import('typescript').SourceFile['fileName']} file
 * @returns {(rule: string, node: import('typescript').Node, message: string, snippet?: string) => void}
 */
function createRecorder(ts, sf, lineText, violations, file) {
  return function record(rule, node, message, snippet) {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
    const txt = lineText[line] ?? '';
    // Suppress when a grace marker sits on ANY line the reported node spans —
    // not on one hard-coded line. A line-anchored test broke under formatting
    // four different ways at once (measured against this repo's own prettier
    // config, slice S5a 2026-09-19): prettier drops a trailing
    // `} catch { // TODO(g2): …` onto the next line, and it explodes a one-line
    // `try { … } catch { … } // TODO(g2): …` into a block whose marker now sits
    // after the closing brace. Either way the marker stayed visible in the file
    // while the detector read it as absent — 126 live markers went inert in a
    // single `--write` pass and broke the J03 ratchet on both rules. The node's
    // own line extent is what survives reformatting: a marker cannot leave the
    // construct it marks, whichever of the construct's lines it lands on.
    for (let i = line; i <= endLine; i++) {
      if (/TODO\(g2\)/.test(lineText[i] ?? '')) return;
    }
    violations.push({
      rule,
      file: relative(REPO_ROOT, file).replace(/\\/g, '/'),
      line: line + 1,
      column: character + 1,
      message,
      snippet: (snippet ?? txt).trim().slice(0, 200)
    });
  };
}

/**
 * The tree walk, over the four anti-patterns. `record` and `fnBodies` are the two
 * things it used to close over, and they are arguments now.
 *
 * @param {import('typescript')} ts
 * @param {(rule: string, node: import('typescript').Node, message: string, snippet?: string) => void} record
 * @param {Map<import('typescript').Node, { touchesEnvelopeWarnings: boolean }>} fnBodies
 */
function createVisitor(ts, record, fnBodies) {
  return function visit(node) {
    // Pattern 1: catch clause with empty body.
    if (ts.isCatchClause(node)) {
      const body = node.block;
      if (body && isEffectivelyEmptyBlock(ts, body)) {
        record(
          'empty-catch',
          node,
          'catch clause swallows error with empty body — emit to envelope.warnings or rethrow'
        );
      } else if (body && firstMeaningfulStatementIs(ts, body, 'returnNullOrUndefined')) {
        record(
          'catch-return-null',
          body,
          'catch clause returns null/undefined — caller cannot distinguish failure from success'
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
          'Promise.reject(x) — wrap original error with { cause: originalErr } or throw new Error(...).'
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
          'console.error(...) appears in a function that never references envelope.warnings — route through the envelope so QA can assert visibility.'
        );
      }
    }

    ts.forEachChild(node, visit);
  };
}

/**
 * Walk an AST and return all violation objects. Each violation:
 *   { rule, file, line, column, message, snippet }
 *
 * Overloaded:
 *   analyzeSource(source, file)         — convenience; resolves TS lazily.
 *   analyzeSource(ts, source, file)     — explicit (used internally + tests).
 */
export function analyzeSource(tsArg, sourceArg, fileArg) {
  let ts, source, file;
  if (typeof tsArg === 'string') {
    // (source, file) signature — resolve ts lazily.
    source = tsArg;
    file = sourceArg;
    // Synchronous throw: callers must await loadTs() first if they want
    // the async path. The CLI uses the async path in main(); the unit
    // test imports this function with ts already initialised.
    throw new Error(
      'analyzeSource(source, file): use the async variant `analyzeSourceAsync` or pass the resolved `ts` module.'
    );
  } else {
    ts = tsArg;
    source = sourceArg;
    file = fileArg;
  }
  // Annotated with the real type instead of left `any`. This repo's type-aware
  // lint fires on every member access off an `any`, and an untyped `sf` is why
  // this file sits AT its ratchet (214 findings): any functional edit to
  // `record()` cost more findings than the file had headroom for. Naming the
  // type pays for the end-line read below and leaves the file one finding
  // BETTER than it was found.
  /** @type {import('typescript').SourceFile} */
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const violations = [];
  const lineText = source.split(/\r?\n/);

  // Per-function context for rule 4 (console.error vs envelope.warnings).
  // We rebuild a function→body map keyed by the containing function node.
  const fnBodies = collectFunctionBodies(ts, sf);

  const record = createRecorder(ts, sf, lineText, violations, file);
  const visit = createVisitor(ts, record, fnBodies);

  visit(sf);
  return violations;
}
