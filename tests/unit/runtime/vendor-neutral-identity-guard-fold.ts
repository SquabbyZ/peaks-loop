// tests/unit/runtime/vendor-neutral-identity-guard-fold.ts
//
// The DERIVATION-and-FOLD half of `vendor-neutral-identity-guard.test.ts`, moved
// VERBATIM into this sibling for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-4). Two things live here and both are load-bearing
// for the guard's reach:
//
//   1. THE GUARDED DATA IS READ FROM THE DECLARATIONS, never restated. `IDE_IDS`
//      comes from the `IdeId` union in `src/services/ide/ide-types.ts` plus the
//      `IdeKind` union in `src/services/context/ide-detect.ts`;
//      `SETTINGS_DIR_NAMES` comes from every `dirName: '<literal>'` in
//      `src/services/ide/adapters/*`, found by walking `src/**/*.ts`
//      (`listFilesRecursively` over `SRC_ROOT` — 893 files measured on 2026-10-01,
//      a number that moves with the tree precisely because it is a walk and not a
//      list).
//      A maintained list here would drift from the adapters it guards, which is
//      the defect the original AC-1 grep had. Adding an IDE to either union, or a
//      `dirName` to an adapter, extends what every shape checks — automatically,
//      with no edit in this directory.
//   2. THE FOLD IS SHARED. `staticStringValue` and `isFoldedIntoParent` are the
//      single spelling of "which string does this node denote", and all three
//      identity shapes plus the settings-path shape call them. That is deliberate:
//      a fold in one shape and not its sibling is precisely how the next injection
//      gets through, which is what the round-3 and 2026-09-13 QA rounds measured.
//      `regexAlternativeIds` is deliberately NOT folded into `staticStringValue` —
//      the boundary is limit 14 below, and it moved here with the code it
//      describes.
//
// The reach itself (which files get parsed at all) is in
// `vendor-neutral-identity-guard-reach.ts`; what the shapes do with each parsed
// file is in `vendor-neutral-identity-guard-shapes.ts`.

// ---------------------------------------------------------------------------
//  14. A REGEX LITERAL is understood only as far as `regexAlternativeIds`
//      normalises it, and the boundary is deliberate: an id is reported when
//      a TOP-LEVEL ALTERNATIVE, after unwrapping whole-span groups, stripping
//      `^`/`$` anchors and unescaping escaped PUNCTUATION, EQUALS the id. So
//      these ARE caught — `/claude-code/`, `/^claude-code$/`, `/^claude-code/`,
//      `/claude-code$/`, `/^(claude-code|trae)$/`, `/^(?:claude-code)$/`,
//      `/claude\-code/` (`\-` unescapes to `-`), `(/claude-code/)`
//      (parentheses around the literal do not hide it). These are NOT caught:
//        a. a regex assembled at runtime — `new RegExp(ide)`, or a pattern
//           built by concatenation (same class as limit 13). NOT the same
//           thing as `new RegExp('claude-code')`, which is a plain string
//           literal in a value position and is owned by shape 2 (inside a
//           consumer; outside one it is limit 6, like any other value);
//        b. a pattern that CONTAINS an id rather than being one —
//           `/claude-code-settings/`, `/^claude-code-/`, `/claude-cod[e]/`,
//           `/claude_code/`. Only an alternative equal to the id counts, which
//           is also what keeps `VENDOR_VERBS` (`/claude\s+--compact/`) and
//           `.claude` path patterns out of this check's way;
//        c. an alternative carrying a regex-only escape — `/claude-code\b/`:
//           `\b` is left intact (a word boundary, not punctuation), so it does
//           not equal the id textually. Likewise no case folding:
//           `/CLAUDE-CODE/i` is not reported;
//        d. character-class obfuscation — `/[c]laude-code/`;
//        e. an alternative nested inside a group that is not a whole-span group
//           — `/x(claude-code)/`.
//      Note the asymmetry with (b) on purpose: a LONE `^` or `$` IS stripped,
//      so `/^claude-code/` (prefix) and `/claude-code$/` (suffix) are reported
//      even though they can match a longer string. A pattern anchored on the
//      id as a whole token is an identity decision; a pattern with MORE text
//      around the id (`/claude-code-settings/`) is not, and pretending to tell
//      prefix-anchors from no-anchors would add a rule with no detection
//      behind it — measured cost of the strict alternative rule is zero sites
//      in the tree today.
//      Residual risk, stated: a regex can still decide identity WITHOUT
//      matching an id as an alternative — the (a)-(e) forms above, plus any
//      `RegExp` composed from a non-literal. Those stay invisible, and this
//      guard's answer to them is this list, not a claim of coverage.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import {
  listFilesRecursively,
  parseSourceFile,
  SRC_ROOT
} from './vendor-neutral-identity-guard-reach.js';

/**
 * The string-literal members of a named string-literal union type alias
 * (`export type IdeId = 'a' | 'b'`). Read from the declaration so the guard
 * cannot drift from the union it guards.
 */
function stringUnionMembers(sourceFile: ts.SourceFile, typeName: string): string[] {
  const members: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === typeName &&
      ts.isUnionTypeNode(node.type)
    ) {
      for (const member of node.type.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
          members.push(member.literal.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return members;
}

const IDE_TYPES_PATH = join(SRC_ROOT, 'services', 'ide', 'ide-types.ts');
const IDE_DETECT_PATH = join(SRC_ROOT, 'services', 'context', 'ide-detect.ts');

/**
 * The id set the guard enforces: the `IdeId` union (the canonical registry
 * keys) plus the ids `detectIdeFromEnv` can return that no adapter owns
 * (`opencode`). `unknown` is a sentinel, not a vendor, and is dropped.
 */
function ideIdsUnderGuard(): ReadonlySet<string> {
  const ideId = stringUnionMembers(
    parseSourceFile(IDE_TYPES_PATH, readFileSync(IDE_TYPES_PATH, 'utf8')),
    'IdeId'
  );
  const ideKind = stringUnionMembers(
    parseSourceFile(IDE_DETECT_PATH, readFileSync(IDE_DETECT_PATH, 'utf8')),
    'IdeKind'
  );
  return new Set([...ideId, ...ideKind].filter((id) => id !== 'unknown'));
}

const IDE_IDS = ideIdsUnderGuard();

/**
 * The settings DIRECTORY names the adapters declare (`dirName: '.claude'`).
 * Read from the declarations for the same reason `IDE_IDS` is: a list
 * maintained inside the guard drifts from the adapters it guards.
 */
function adapterSettingsDirNames(): ReadonlySet<string> {
  const names = new Set<string>();
  // `src/` only: `dirName` is an adapter-layer field and adapters live there.
  for (const absolutePath of listFilesRecursively(SRC_ROOT, ['.ts'])) {
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'dirName' &&
        ts.isStringLiteral(node.initializer)
      ) {
        names.add(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }
  return names;
}

const SETTINGS_DIR_NAMES = adapterSettingsDirNames();

const IDENTITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken
]);

/** Source text of a node, whitespace-collapsed and length-capped for messages. */
function briefText(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export interface IdentityComparison {
  readonly file: string;
  readonly line: number;
  /** The compared ID literal, so a failure names which vendor was hardcoded. */
  readonly id: string;
  /** `subject === 'id'`, `switch (subject) { case 'id' }`, or `/^id$/.test(subject)`. */
  readonly form: 'comparison' | 'switch-case' | 'regex-literal';
  /** Source text of the non-literal side, or the regex itself for `regex-literal`. */
  readonly subject: string;
}

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * The STATIC string value a node denotes, or `null` when it is not statically
 * known. Folds the three spellings of the same literal that round-3 injection
 * used to walk past:
 *
 *   'claude-code'          string literal      → `node.text`
 *   `claude-code`          no-substitution template → `node.text`
 *   'claude' + '-code'     `+` chain of the above  → concatenation
 *   ('claude-code')        parenthesised form of any of the above
 *
 * The previous revision tested `ts.isStringLiteral(node)` directly, so an id
 * written in any other spelling was not even a CANDIDATE. The property this
 * guard asserts is about the id a node DENOTES, so the id is folded first and
 * the fold is shared by all three shapes — a shape that folds while its
 * sibling does not is how the next injection gets in.
 *
 * Template literals WITH substitutions (`${x}-code`) are not foldable and stay
 * a stated limit (header, limit 3/13).
 */
function staticStringValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticStringValue(node.expression);
  // Type wrappers are ERASED at runtime, so they do not change the value the
  // node denotes. `ide === ('claude-code' as const)` compares against the same
  // string `ide === 'claude-code'` does. This form was invisible until
  // 2026-09-13: an assertion hid the literal from every shape, so a
  // NON-consumer file (where shape 2 does not run) could re-inject an
  // identity comparison by adding `as const` and nothing failed.
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
    return staticStringValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

/**
 * True when an ENCLOSING node already folds to this node's string value — a
 * parenthesis, a `+` chain, or a type wrapper. Without this, one site reports
 * once per enclosing spelling (`('claude-code')`, `'claude-code' + ''`,
 * `'claude-code' as const`) and silently inflates the count-pinned assertions,
 * which are exact equalities.
 *
 * The enclosing node is REPORTED in place of this one (same line, same
 * `valuePositionLabel`), so folding a wrapper never loses a site: the site is
 * named by the outermost node that carries it. Blanket-skipping the wrapped
 * literal without that hand-off would have been a REGRESSION, not a
 * de-duplication — `{ ide: 'claude-code' as const }` in a consumer was caught
 * by shape 2 before this revision and must stay caught.
 */
function isFoldedIntoParent(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (ts.isParenthesizedExpression(parent)) return true;
  if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) return true;
  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    staticStringValue(parent) !== null
  );
}

/**
 * The FOURTH literal form: a REGEX LITERAL, asked which guarded ids it matches
 * EXACTLY.
 *
 * Deliberately NOT part of `staticStringValue`. That fold answers "which string
 * does this node denote", and a regex denotes a LANGUAGE, not a string. Folding
 * it there would have made a regex satisfy the VALUE and PATH shapes it does
 * not actually decide (`const p = /\.claude\//` would have read as a hardcoded
 * settings path). The question this guard actually asks of a regex is the one
 * below: which ids does the pattern match as a whole string? A regex
 * `test`/`match` against an ide IS an identity decision — the 2026-09-13 QA
 * injection (`/^claude-code$/.test(ide)`, `ide.match(/claude-code/)`,
 * `/^(claude-code|trae)$/.test(ide)`) was 20/20 green because neither a
 * `RegularExpressionLiteral` nor a method call was any shape's business.
 *
 * A regex is a CALL, not a comparison, so this is reported by shape 1 (which
 * owns identity decisions wherever they appear), not by a `===` scan. See
 * limit 14 for what the normalisation below does NOT understand.
 */
const REGEX_LITERAL_TEXT = /^\/([\s\S]*)\/([a-z]*)$/;

/** The pattern between the delimiters: `/^(a|b)$/i` → `^(a|b)$`, or `null`. */
function regexPatternSource(text: string): string | null {
  const match = REGEX_LITERAL_TEXT.exec(text);
  return match === null ? null : (match[1] ?? '');
}

/** Split a pattern on top-level `|` (not inside a group, not inside `[…]`). */
function splitTopLevelAlternatives(pattern: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inCharacterClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === '\\') {
      current += char + (pattern[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (char === '[') inCharacterClass = true;
    if (char === ']') inCharacterClass = false;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === '|' && depth === 0 && !inCharacterClass) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** `(x)`, `(?:x)` — one whole-span group — unwrapped to `x`. */
function unwrapWholeGroup(text: string): string {
  if (!text.startsWith('(') || !text.endsWith(')')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      // The opening paren closed before the end → not one whole-span group
      // (`(a)|(b)` reaches here as `(a)`+`|`+`(b)`, never as one string).
      if (depth === 0) return i === text.length - 1 ? text.slice(1, -1).replace(/^\?:/, '') : text;
    }
  }
  return text;
}

/**
 * Structural normalisation — unwrap whole-span groups and strip `^`/`$`
 * anchors on either end. A lone `^` or `$` counts: `/^claude-code/` names the
 * id as its whole token even though it can match a longer string (see limit
 * 14's note on this asymmetry). ESCAPES ARE LEFT INTACT here, because the
 * caller still has to split on `|` and an escaped `\|` is a literal pipe, not
 * an alternative separator. Iterated because `^(?:x)$` needs both steps.
 */
function structuralNormalize(text: string): string {
  let current = text;
  for (;;) {
    const before = current;
    current = unwrapWholeGroup(current);
    if (current.startsWith('^')) current = current.slice(1);
    if (current.endsWith('$') && !current.endsWith('\\$')) current = current.slice(0, -1);
    if (current === before) break;
  }
  return current;
}

/** `\-` → `-`, `\/` → `/`; `\s`, `\d`, `\w`, `\b` keep their meaning. */
function unescapePunctuation(text: string): string {
  return text.replace(/\\(.)/g, (whole, escaped: string) =>
    /^[A-Za-z0-9]$/.test(escaped) ? whole : escaped
  );
}

/** The id text an alternative is keyed on: structural form, then unescaped. */
function normalizeAlternative(text: string): string {
  return unescapePunctuation(structuralNormalize(text));
}

/**
 * The guarded ids a regex literal keys on, deduplicated. One regex can name
 * several (`/^(claude-code|trae)$/` → both), which is why this returns a list
 * where every other literal form returns a single value.
 *
 * The whole pattern is normalised BEFORE the split on purpose: in
 * `/^(claude-code|trae)$/` the `|` sits inside a group, so it is not a
 * top-level alternative until the anchors are stripped and the group is
 * unwrapped — splitting first saw one alternative `^(claude-code|trae)$` and
 * reported nothing. Anchors are stripped again per alternative, so the two
 * placements (`^(a|b)$` and `^a$|^b$`) both resolve.
 */
function regexAlternativeIds(node: ts.Node): string[] {
  if (!ts.isRegularExpressionLiteral(node)) return [];
  const pattern = regexPatternSource(node.text);
  if (pattern === null) return [];
  const ids = new Set<string>();
  for (const alternative of splitTopLevelAlternatives(structuralNormalize(pattern))) {
    const normalized = normalizeAlternative(alternative);
    if (IDE_IDS.has(normalized)) ids.add(normalized);
  }
  return [...ids];
}

/** The id a node denotes, when that id is one the guard enforces. */
function ideIdOf(node: ts.Node): string | null {
  const value = staticStringValue(node);
  return value !== null && IDE_IDS.has(value) ? value : null;
}

export {
  IDE_IDS,
  SETTINGS_DIR_NAMES,
  IDENTITY_OPERATORS,
  briefText,
  lineOf,
  staticStringValue,
  isFoldedIntoParent,
  regexAlternativeIds,
  ideIdOf
};
