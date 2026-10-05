/**
 * My comment lexer, against the real TypeScript parser.
 *
 * Rid `2026-10-05-comment-scan-string-awareness`. `src/services/comments/comment-spans.ts`
 * hand-rolls a state machine because `typescript` is a devDependency and product code may
 * not hand the shipped CLI a new runtime dependency. That trade is only sound while the
 * hand-rolled machine agrees with the real one — and "we wrote some tests" is not evidence:
 * the ORIGINAL line-local reader had tests too, including one asserting a URL is not a
 * comment, and it still cut a template literal in half and wrote the result into `src/`.
 *
 * WHAT THE REFERENCE IS, AND WHY IT IS NOT `ts.createScanner`. The first version of this
 * file compared against the standalone scanner and promptly failed three arms — including
 * one where the scanner claimed a comment on the line `const r = /https?:\/\//g;`. The
 * scanner cannot answer that: without the parser's context it treats the slash as division
 * and then trips over the escaped pair. Asking the PARSER settles it — `createSourceFile`
 * reports 0 parse diagnostics and a `RegularExpressionLiteral` token whose full text is
 * `/https?:\/\//g`, so the double slash is regex content and NOT a comment, and it was the
 * reference that was wrong, not the lexer. So the arms below use two properties the parser
 * answers unambiguously, in the direction each is reliable:
 *
 *   SAFETY  — no comment my lexer reports may overlap a literal token the parser named
 *             (string, template, regex, JSX text). This is the property whose violation
 *             corrupted `feedback-promotion-service.ts`; cutting there changes code.
 *   COVERAGE— every comment line the parser attaches as trivia must be reported by my
 *             lexer. The parser's trivia walk under-reports rather than over-reports, so
 *             it is sound as a lower bound and unsound as an exact equality.
 *
 * Dimensions:
 *   - behavior:    the synthetic shapes, asserted against hand-derived truth — including
 *                  the two the real scanner gets wrong, which is how they were caught
 *   - integration: both properties over every shipped source file
 *   - render:      omitted — this module emits nothing
 *   - a11y:        omitted — a failure names its file and both line sets, in the assertion
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { commentSpans } from '~/src/services/comments/comment-spans';
import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';

declareDimensions(
  'tests/unit/comments/comment-scan-parity.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no output shape' },
    { dim: 'a11y', reason: 'a failure names its file and both line sets by construction' }
  ]
);

const LITERAL_TOKENS = [
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText
];

/** The comment lines MY walker assigns, one per line a comment touches. */
function mineCommentLines(text: string): number[] {
  const lines = new Set<number>();
  for (const span of commentSpans(text)) {
    for (let l = span.line; l <= span.endLine; l += 1) lines.add(l);
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Comment lines the parser itself attaches as trivia, at every node's full start.
 *
 * A lower bound on purpose: this walk can miss a comment (some trailing trivia belongs to
 * no node it reaches), but it cannot invent one. So a line it reports MUST be reported by
 * my lexer, which is the direction that catches an under-reading classifier.
 */
function parserCommentLines(text: string, kind: ts.ScriptKind): number[] {
  const sf = ts.createSourceFile('parity.ts', text, ts.ScriptTarget.Latest, true, kind);
  const lineAt = (offset: number): number => text.slice(0, offset).split('\n').length;
  const lines = new Set<number>();
  const add = (pos: number): void => {
    for (const range of ts.getLeadingCommentRanges(text, pos) ?? []) {
      for (let l = lineAt(range.pos); l <= lineAt(range.end); l += 1) lines.add(l);
    }
  };
  const visit = (node: ts.Node): void => {
    add(node.getFullStart());
    ts.forEachChild(node, visit);
  };
  visit(sf);
  add(sf.endOfFileToken.getFullStart());
  return [...lines].sort((a, b) => a - b);
}

/** Character ranges the parser says are LITERAL content — where a cut would change code. */
function literalRanges(text: string, kind: ts.ScriptKind): Array<[number, number]> {
  const sf = ts.createSourceFile('parity.ts', text, ts.ScriptTarget.Latest, true, kind);
  const out: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (LITERAL_TOKENS.includes(node.kind)) out.push([node.getStart(sf), node.getEnd()]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The shapes a line-local reader gets wrong, with the truth derived by hand. */
const SHAPES: ReadonlyArray<[string, string, number[]]> = [
  ['a template literal whose content starts with a double slash', 'const s = `// a.ts\\n// b.ts`;\n', []],
  ['a regex carrying an escaped double slash', 'const r = /https?:\\/\\//g;\nexport const x = 1;\n', []],
  ['a URL in a string', 'const u = "https://example.com/a";\n', []],
  ['a real comment after that regex', 'const r = /a\\/\\/b/; // the flag matters\n', [1]],
  ['a comment inside an interpolation', 'const s = `x${ /* inner */ y }z`;\nexport const k = 2; // tail\n', [1, 2]],
  ['a nested template inside an interpolation', 'const s = `a${ `b // not a comment` }c`;\nexport const q = 3;\n', []],
  ['a block comment spanning lines', '/**\n * doc\n */\nexport const d = 4;\n', [1, 2, 3]],
  ['an apostrophe inside a comment', "export const e = 5; // don't cut this\n", [1]],
  ['division, then a comment', 'const h = (a + b) / 2; // mean\nexport const f = 6;\n', [1]],
  ['a string containing a block opener', 'const s = "/* not a comment */";\nexport const g = 7;\n', []]
];

describe('the lexer agrees with hand-derived truth on the shapes a line reader gets wrong', () => {
  for (const [label, source, expected] of SHAPES) {
    it(label, () => {
      expect(mineCommentLines(source), source).toEqual(expected);
    });
  }
});

const PRODUCT_DIRS = [
  'src',
  'packages/peaks-loop-mut/src',
  'packages/peaks-loop-shared/src',
  'packages/peaks-loop-shared-channel/src',
  'packages/peaks-loop-internal-runtime/src'
];

/** Every `.ts`/`.tsx` under an ABSOLUTE `dir`, as a repo-relative POSIX path. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a package with no src dir is absent, not a disagreement
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sourcesUnder(join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(`${dir.slice(REPO_ROOT.length + 1).replace(/\\/g, '/')}/${entry.name}`);
    }
  }
  return out;
}

describe('the lexer is safe and complete over every shipped source file', () => {
  // ABSOLUTE in, repo-relative out — `sourcesUnder` slices the root off, so handing it a
  // relative dir would produce `/cli-envelope.ts` and resolve it off the drive root.
  const files = PRODUCT_DIRS.flatMap((dir) => sourcesUnder(resolve(REPO_ROOT, dir)));

  it('reads a real population, never an empty list', () => {
    // An empty list would make both arms below vacuously true — the failure mode this
    // slice has now been bitten by twice.
    expect(files.length).toBeGreaterThan(400);
  });

  it('the two references are not empty, so the arms below have something to check', () => {
    // A safety arm over zero literal ranges passes for free; a coverage arm over zero
    // reference lines does too. This counts both, so "agrees" cannot degenerate into
    // "neither side looked at anything".
    let literals = 0;
    let referenceLines = 0;
    for (const rel of files.slice(0, 60)) {
      const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      literals += literalRanges(text, kind).length;
      referenceLines += parserCommentLines(text, kind).length;
    }
    expect(literals, 'the sample carries no literals — the safety arm would be vacuous').toBeGreaterThan(
      200
    );
    expect(
      referenceLines,
      'the sample carries no parser comments — the coverage arm would be vacuous'
    ).toBeGreaterThan(200);
  });

  it('never places a comment inside a literal the parser named', () => {
    const overlaps: string[] = [];
    for (const rel of files) {
      const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      const literals = literalRanges(text, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      for (const span of commentSpans(text)) {
        const inside = literals.find(([from, to]) => span.start > from && span.start < to);
        if (inside !== undefined) {
          overlaps.push(`${rel}: line ${span.line} "${span.text.slice(0, 48)}" is inside a literal`);
        }
      }
    }
    // THIS is the arm that would have refused the 4.1.1 write: `snippet: \`// a.ts…\`` was
    // a "comment" starting inside a template literal, and the pruner cut code at it.
    expect(overlaps.slice(0, 8), `${overlaps.length} comment(s) inside literals`).toEqual([]);
  });

  it('reports every comment line the parser attaches as trivia', () => {
    const missed: string[] = [];
    for (const rel of files) {
      const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const theirs = parserCommentLines(text, kind);
      const mine = new Set(mineCommentLines(text));
      const gaps = theirs.filter((l) => !mine.has(l)).slice(0, 4);
      if (gaps.length > 0) missed.push(`${rel}: missed lines [${gaps.join(', ')}]`);
    }
    expect(missed.slice(0, 8), `${missed.length} file(s) under-read`).toEqual([]);
  });
});
