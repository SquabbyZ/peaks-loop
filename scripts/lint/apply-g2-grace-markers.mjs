#!/usr/bin/env node
// scripts/lint/apply-g2-grace-markers.mjs
//
// One-shot utility used by Slice A.2 to apply `// TODO(g2):` grace markers
// to existing silent-catch sites in src/. Re-runnable: lines that already
// carry the marker are skipped. Walks src/ only, honors self-exemption.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const SELF_DIRS = ['scripts/lint', 'tests/unit/lint'].map((p) => resolve(REPO, p));
const EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        stack.push(f);
      } else if (e.isFile() && EXT.has(extname(e.name))) yield f;
    }
  }
}
function isSelf(f) {
  return SELF_DIRS.some((d) => f === d || f.startsWith(d + '/') || f.startsWith(d + '\\'));
}

const tsMod = await import(pathToFileURL(resolve(REPO, 'node_modules/typescript/lib/typescript.js')).href);
const ts = tsMod.default ?? tsMod;

let marked = 0;
let scannedFiles = 0;

for (const root of ['src']) {
  for (const file of walk(resolve(REPO, root))) {
    if (isSelf(file)) continue;
    scannedFiles++;
    let src = readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    let dirty = false;
    function visit(node) {
      if (ts.isCatchClause(node) && node.block) {
        const block = node.block;
        const isEmpty = block.statements.length === 0 || block.statements.every((s) => ts.isEmptyStatement(s));
        let isReturnNull = false;
        if (!isEmpty) {
          for (const s of block.statements) {
            if (ts.isEmptyStatement(s)) continue;
            if (ts.isReturnStatement(s) && s.expression) {
              if (s.expression.kind === ts.SyntaxKind.NullKeyword || s.expression.kind === ts.SyntaxKind.UndefinedKeyword) isReturnNull = true;
              else if (ts.isIdentifier(s.expression) && (s.expression.text === 'null' || s.expression.text === 'undefined')) isReturnNull = true;
              else if (ts.isBinaryExpression(s.expression) && s.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) isReturnNull = true;
            }
            break;
          }
        }
        if (isEmpty || isReturnNull) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const lineText = lines[line] ?? '';
          if (lineText && !/TODO\(g2\)/.test(lineText)) {
            lines[line] = lineText + ' // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)';
            dirty = true;
            marked++;
          }
        }
      }
      // Pattern 4 (console.error without envelope.warnings) — apply grace
      // marker on the offending console.error line itself.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'error') {
        const obj = node.expression.expression;
        if (ts.isIdentifier(obj) && obj.text === 'console') {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const lineText = lines[line] ?? '';
          if (lineText && !/TODO\(g2\)/.test(lineText)) {
            lines[line] = lineText + ' // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)';
            dirty = true;
            marked++;
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (dirty) writeFileSync(file, lines.join('\n'), 'utf8');
  }
}
console.log(`apply-g2-grace-markers: scanned ${scannedFiles} files, marked ${marked} sites`);