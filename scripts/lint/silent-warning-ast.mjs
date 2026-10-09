// scripts/lint/silent-warning-ast.mjs
//
// The TypeScript-Compiler-API questions the four rules ask.
//
// Pure predicates over a parsed node, plus the two walks (`collectFunctionBodies`,
// `findEnclosingFunction`) and `walkFor` they and the visitor share. Nothing here
// knows about files, argv or output.
//
// Split out of `scripts/lint/silent-warning-detector.mjs` (rid-043). This module is a
// REPORTER the gate runs; the split moved code and changed no detection logic.

export function isEffectivelyEmptyBlock(ts, block) {
  // Empty body OR body whose only statements are comments / debugger.
  if (block.statements.length === 0) return true;
  return block.statements.every((s) => ts.isEmptyStatement(s));
}

export function firstMeaningfulStatementIs(ts, block, kind) {
  for (const stmt of block.statements) {
    if (ts.isEmptyStatement(stmt)) continue;
    if (kind === 'returnNullOrUndefined') {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        const t = stmt.expression.kind;
        if (t === ts.SyntaxKind.NullKeyword || t === ts.SyntaxKind.UndefinedKeyword) return true;
        // TS parses `return undefined` / `return null` as bare identifiers.
        if (
          ts.isIdentifier(stmt.expression) &&
          (stmt.expression.text === 'null' || stmt.expression.text === 'undefined')
        ) {
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

export function isPromiseReject(ts, node) {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const expr = node.expression;
  if (expr.name.text !== 'reject') return false;
  const obj = expr.expression;
  if (ts.isIdentifier(obj) && obj.text === 'Promise') return true;
  return false;
}

export function isErrorLike(ts, arg) {
  if (ts.isNewExpression(arg) && ts.isIdentifier(arg.expression)) {
    const n = arg.expression.text;
    if (n === 'Error' || n.endsWith('Error')) return true;
  }
  if (
    ts.isIdentifier(arg) &&
    (arg.text === 'err' || arg.text === 'error' || /^[a-z]*(Err|Error)$/.test(arg.text))
  ) {
    return true;
  }
  return false;
}

export function hasCauseField(ts, arg) {
  if (!ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name) &&
      p.name.text === 'cause'
  );
}

export function isConsoleError(ts, node) {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const expr = node.expression;
  if (expr.name.text !== 'error') return false;
  const obj = expr.expression;
  return ts.isIdentifier(obj) && obj.text === 'console';
}

export function collectFunctionBodies(ts, sf) {
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

export function walkFor(ts, node, fn) {
  fn(node);
  ts.forEachChild(node, (c) => walkFor(ts, c, fn));
}

export function findEnclosingFunction(ts, node) {
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
