// tests/unit/runtime/vendor-neutral-identity-guard-shapes.ts
//
// THE CHECKS, moved VERBATIM out of `vendor-neutral-identity-guard.test.ts` for
// the C wave 7 file-size split (rid 2026-10-01-c-wave7-excess-w7-4). This is the
// only place the four checks are implemented:
//
//   shape 1  `findIdentityComparisons`  identity DECISIONS (comparison, `case`,
//            regex test) — GLOBAL, it runs on every file `SCAN_ROOTS` reaches.
//   shape 2  `findIdeValueLiterals`     an id asserted as a VALUE.
//   shape 3  `findSettingsPathLiterals` an adapter-declared settings DIRECTORY
//            hardcoded as a path.
//   AC-1     `findVendorVerbLiterals`   a vendor VERB string outside an adapter
//            implementation.
//   SCOPE    `isRegistryConsumer`       the rule that decides whether shapes 2/3
//            run on a file at all — three import forms (static, lazy
//            `await import`, and all four re-export spellings) and nothing else.
//   ORCHEST  `scanProject`/`SCAN`       parse every walked file once and run all
//            four over it, folding shapes 2/3 in by `isRegistryConsumer`.
//
// WHAT MUST NOT SHRINK, and what would not be noticed: shapes 2/3 apply only to
// the files `isRegistryConsumer` accepts, so widening or narrowing that rule
// changes the guarded set silently — the measured scope rule and its costs are
// the SCOPE block in `vendor-neutral-identity-guard.test.ts` and limit 12 in the
// LIMITS list (which heads
// `vendor-neutral-identity-guard-scope-controls.test.ts`). `ALLOWED_DIRS` is a
// DIRECTORY allowlist for the same reason limit 5 states. The literal fold these
// functions share lives in `vendor-neutral-identity-guard-fold.ts`, and the walk
// that feeds them lives in `vendor-neutral-identity-guard-reach.ts`.
//
// `SCAN` is built at module load, exactly as it was when all of this sat in the
// test file: every test file that imports it reads the SAME scanned tree, and the
// anti-silence case in `vendor-neutral-identity-guard.test.ts` fails if the tree
// is not the one it names.

import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import {
  listFilesRecursively,
  parseSourceFile,
  relativeToRoot,
  SCAN_ROOTS
} from './vendor-neutral-identity-guard-reach.js';
import {
  briefText,
  IDENTITY_OPERATORS,
  ideIdOf,
  type IdentityComparison,
  isFoldedIntoParent,
  lineOf,
  regexAlternativeIds,
  SETTINGS_DIR_NAMES,
  staticStringValue
} from './vendor-neutral-identity-guard-fold.js';

/**
 * Shape 1 — IDE identity DECISIONS: comparisons, `case` clauses, and regex
 * tests.
 *
 * The non-literal side may be ANY expression (`ide`, `ideId`, `adapter.id`,
 * `detected.ide`, an index expression, a call). It used to have to carry a
 * name matching `/ide/i`, and that name rule was the hole: the same gate
 * re-keyed as `adapter.id !== 'claude-code'` — the most natural re-injection
 * in the file it was removed from — passed. Dropping the name rule costs two
 * pre-existing hits on the runtime-vendor axis (`vendor === 'codex'` in
 * `src/services/dispatch/dispatch-record-*.ts`); they are pinned as debt, not
 * excluded, because "the other side is called `vendor`" is exactly the kind
 * of exception that made the rule a hole.
 *
 * The regex branch is the fourth literal form. It is not a comparison node at
 * all — `/^claude-code$/.test(ide)` and `ide.match(/claude-code/)` are CALLS —
 * so a `===`-and-`case` scan could not reach them however the literal folded,
 * which is why the fold alone was not the fix (see `regexAlternativeIds`).
 * Rule: any regex literal whose whole-string alternative equals a guarded id.
 * Measured over the scanned tree at the 2026-09-13 revision: ZERO such literals
 * exist today, so this branch costs no exemption and no false positive; every
 * hit it reports from now on is new code, which is the point.
 */
export function findIdentityComparisons(sourceFile: ts.SourceFile): IdentityComparison[] {
  const found: IdentityComparison[] = [];
  const record = (
    node: ts.Node,
    form: IdentityComparison['form'],
    id: string,
    subject: string
  ): void => {
    found.push({
      file: sourceFile.fileName,
      line: lineOf(sourceFile, node),
      id,
      form,
      subject
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && IDENTITY_OPERATORS.has(node.operatorToken.kind)) {
      const leftId = ideIdOf(node.left);
      const rightId = ideIdOf(node.right);
      // `!== null` on the OTHER side (not `!isStringLiteral`) on purpose: the
      // subject must be a non-literal EXPRESSION. Folding both sides keeps
      // `'claude-code' === 'claude' + '-code'` a no-op, as it should be.
      if (leftId !== null && staticStringValue(node.right) === null) {
        record(node, 'comparison', leftId, briefText(sourceFile, node.right));
      }
      if (rightId !== null && staticStringValue(node.left) === null) {
        record(node, 'comparison', rightId, briefText(sourceFile, node.left));
      }
    }
    if (ts.isSwitchStatement(node) && staticStringValue(node.expression) === null) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue;
        const id = ideIdOf(clause.expression);
        if (id !== null) {
          record(clause, 'switch-case', id, briefText(sourceFile, node.expression));
        }
      }
    }
    // `isFoldedIntoParent` is deliberately NOT applied here: parentheses are
    // not regex literals, so a parenthesised regex cannot double-report, and
    // skipping on an enclosing node would make `(/claude-code/)` invisible —
    // a one-character escape from this branch.
    for (const id of regexAlternativeIds(node)) {
      record(node, 'regex-literal', id, briefText(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

export interface IdeValueLiteral {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  /** How the literal is bound, e.g. `ide: 'claude-code'` or `return 'claude-code'`. */
  readonly position: string;
}

/** True when the node sits inside a type annotation / literal type. */
function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

/**
 * The value positions this check deliberately does NOT own. Each is limit 7
 * in the header, named there with a live example. They are excluded because
 * they are id TABLES (`{ 'claude-code': … }`, `['claude-code']`, which only
 * decide anything through `.has()`/`.includes()` — limit 1) or the repo's
 * `unknown → claude-code` DEFAULT policy, which is the opposite of the C1
 * defect this check exists for (a literal that overrides a KNOWN adapter id).
 */
function isExcludedValuePosition(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (ts.isBinaryExpression(parent) && IDENTITY_OPERATORS.has(parent.operatorToken.kind))
    return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isArrayLiteralExpression(parent)) return true;
  if (ts.isConditionalExpression(parent)) return true;
  if (
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return true;
  }
  return false;
}

/** A short label for where the literal is bound, for failure messages. */
function valuePositionLabel(sourceFile: ts.SourceFile, node: ts.Node): string {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return 'value';
  if (ts.isPropertyAssignment(parent)) return `${briefText(sourceFile, parent.name)}:`;
  if (ts.isVariableDeclaration(parent)) return `${briefText(sourceFile, parent.name)} =`;
  if (ts.isPropertyDeclaration(parent)) return `${briefText(sourceFile, parent.name)} =`;
  if (ts.isReturnStatement(parent)) return 'return';
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    return `${briefText(sourceFile, parent.expression)}(...)`;
  }
  return ts.SyntaxKind[parent.kind];
}

/**
 * Shape 2 — an IDE id asserted as a VALUE.
 *
 * This is the shape that survived a comparison-only guard: `ide: 'claude-code'`
 * in an object literal and `return 'claude-code'` are not comparisons at all,
 * so no amount of id-set tuning would have caught them. See limit 7 for the
 * positions deliberately excluded.
 */
export function findIdeValueLiterals(sourceFile: ts.SourceFile): IdeValueLiteral[] {
  const found: IdeValueLiteral[] = [];
  const visit = (node: ts.Node): void => {
    const id = ideIdOf(node);
    if (
      id !== null &&
      !isFoldedIntoParent(node) &&
      !isTypePosition(node) &&
      !isExcludedValuePosition(node)
    ) {
      found.push({
        file: sourceFile.fileName,
        line: lineOf(sourceFile, node),
        id,
        position: valuePositionLabel(sourceFile, node)
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

export interface SettingsPathLiteral {
  readonly file: string;
  readonly line: number;
  /** The adapter-declared directory the literal starts with (`.claude`, `.trae`, …). */
  readonly dirName: string;
  readonly text: string;
}

/**
 * A literal that IS a path into an adapter-declared settings directory:
 * `.claude`, `.claude/settings.local.json`, `~/.claude/settings.json`.
 * PROSE mentioning `.claude` (`"install into the user-level ~/.claude/…"`)
 * is not path-shaped and is not a hit — same reason AC-1 is not a grep.
 */
function matchesSettingsDir(text: string): string | null {
  const stripped = text.replace(/^~[\\/]?/, '');
  for (const dirName of SETTINGS_DIR_NAMES) {
    if (
      stripped === dirName ||
      stripped.startsWith(`${dirName}/`) ||
      stripped.startsWith(`${dirName}\\`)
    ) {
      return dirName;
    }
  }
  return null;
}

/**
 * Shape 3 — an IDE's settings DIRECTORY hardcoded as a path.
 *
 * Separate from shape 2 on purpose: a hardcoded path is not an id literal and
 * an id check can never see it. This is what made the `ide-native` hook land
 * in `.claude/settings.local.json` no matter which adapter asked for it.
 */
export function findSettingsPathLiterals(sourceFile: ts.SourceFile): SettingsPathLiteral[] {
  const found: SettingsPathLiteral[] = [];
  const visit = (node: ts.Node): void => {
    // Same fold as the id checks: `join(root, '.claude', …)` and
    // `join(root, '.' + 'claude', …)` are the same hardcoded path.
    const text = staticStringValue(node);
    if (text !== null && !isFoldedIntoParent(node)) {
      const dirName = matchesSettingsDir(text);
      if (dirName !== null && !isTypePosition(node)) {
        found.push({
          file: sourceFile.fileName,
          line: lineOf(sourceFile, node),
          dirName,
          text
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The adapter layer. Its whole job is per-IDE knowledge, so naming an id or
 * one IDE's settings path here is the DESIGN, not a leak. See limit 5 in the
 * header for why this is a directory and not a file list.
 */
const ALLOWED_DIRS: readonly string[] = ['src/services/ide/'];

/** `import ... from '…/ide-registry'` — the mark of a module that routes per-IDE. */
const REGISTRY_MODULE = /(^|\/)ide-registry(\.js)?$/;

/**
 * True when a file consumes the adapter registry. Shapes 2 and 3 apply only
 * to these files (see the SCOPE block in the header): a module that asks the
 * registry which adapter is in play must not also hardcode an id or a path.
 *
 * THREE forms count — every way a module can name the registry module:
 *   - `import … from '…/ide-registry.js'` (static)
 *   - `await import('…/ide-registry.js')` (lazy) — the first draft saw only
 *     the static form and silently dropped `src/cli/commands/share-commands.ts`
 *     (a real consumer) out of scope.
 *   - `export … from '…/ide-registry.js'` (re-export) — round-3 injection:
 *     a barrel that re-exported the registry was not a consumer, so a barrel
 *     that ALSO hardcoded an id or a path was invisible to shapes 2/3. The
 *     `ExportDeclaration` node covers all four spellings at once —
 *     `export { getAdapter } from …`, the ALIASED
 *     `export { getAdapter as getIdeAdapter } from …`, `export * from …` and
 *     `export * as ns from …` — because all four carry the same
 *     `moduleSpecifier`. Patching only the `export { … } from` spelling would
 *     have left the other three open.
 *
 * Scope that is narrower than it claims is the one failure mode this guard's
 * own header warns about, which is why each of these is matched rather than
 * documented as a gap.
 *
 * NOT matched: `require(...)` — this is an ESM tree, and a CommonJS require
 * cannot be typed through it (limit 12 in the header). Also NOT matched: a
 * SECOND-HOP barrel (`a.ts` re-exports the registry, `b.ts` re-exports `a.ts`)
 * — limit 12.
 */
export function isRegistryConsumer(sourceFile: ts.SourceFile): boolean {
  let consumes = false;
  const note = (specifier: string): void => {
    if (REGISTRY_MODULE.test(specifier)) consumes = true;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      note(node.moduleSpecifier.text);
    }
    // `export … from '…'` — any of the four re-export spellings.
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      note(node.moduleSpecifier.text);
    }
    // `await import('…')` / `import('…')` — a lazy registry lookup.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier !== undefined && ts.isStringLiteral(specifier)) note(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return consumes;
}

// ---------------------------------------------------------------------------
// AC-1 — vendor VERB strings. See the header block for the measured counts
// (raw grep over `src/` = 13; parsed string literals = 1) and for this
// check's limits.
// ---------------------------------------------------------------------------

/** The three compact verbs AC-1 names, as patterns that survive whitespace. */
const VENDOR_VERBS: readonly RegExp[] = [
  /claude\s+--compact/,
  /codex\s+--compact/,
  /copilot\s+compact/
];

/**
 * Where a vendor verb is SUPPOSED to live: the adapter implementations, one
 * family per adapter interface. Narrower than the identity guard's
 * `src/services/ide/` allowlist on purpose — the registry and the shared
 * IDE types are part of the adapter LAYER but are not implementations, and
 * a verb belongs in the implementation only.
 */
const VERB_ALLOWED_DIRS: readonly string[] = [
  'src/services/runtime/vendors/',
  'src/services/ide/adapters/'
];

export interface VerbLiteral {
  readonly file: string;
  readonly line: number;
  readonly verb: string;
}

/**
 * Vendor verbs appearing in a STRING or TEMPLATE literal. Comments and JSDoc
 * are not AST nodes of these kinds, so the phrases quoted in the docs — which
 * are most of the raw grep's hits — are invisible here by construction.
 */
export function findVendorVerbLiterals(sourceFile: ts.SourceFile): VerbLiteral[] {
  const found: VerbLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const pattern of VENDOR_VERBS) {
        if (pattern.test(node.text)) {
          found.push({
            file: sourceFile.fileName,
            line: lineOf(sourceFile, node),
            verb: node.text
          });
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

interface ScanResult {
  readonly scannedFiles: number;
  /**
   * Every file the walk reached, root-relative. Carried as a LIST, not only as
   * a count: a count cannot tell "the new root was walked" from "some other
   * file made up the number", and the two roots this guard added (the
   * `scripts/` directory, then the `.js` extension under `src/`) are exactly
   * the ones a count would fail to notice silently dropping.
   */
  readonly scannedFileList: readonly string[];
  readonly registryConsumers: readonly string[];
  readonly comparisons: readonly IdentityComparison[];
  readonly ideValues: readonly IdeValueLiteral[];
  readonly settingsPaths: readonly SettingsPathLiteral[];
  readonly verbLiterals: readonly VerbLiteral[];
}

function scanProject(): ScanResult {
  const files = SCAN_ROOTS.flatMap(({ root, extensions }) =>
    listFilesRecursively(root, extensions)
  );
  const comparisons: IdentityComparison[] = [];
  const ideValues: IdeValueLiteral[] = [];
  const settingsPaths: SettingsPathLiteral[] = [];
  const verbLiterals: VerbLiteral[] = [];
  const registryConsumers: string[] = [];
  for (const absolutePath of files) {
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    const consumes = isRegistryConsumer(sourceFile);
    const file = relativeToRoot(absolutePath);
    if (consumes) registryConsumers.push(file);
    // Shape 1 is global; shapes 2/3 are scoped to registry consumers.
    comparisons.push(...findIdentityComparisons(sourceFile));
    if (consumes) {
      ideValues.push(...findIdeValueLiterals(sourceFile));
      settingsPaths.push(...findSettingsPathLiterals(sourceFile));
    }
    verbLiterals.push(...findVendorVerbLiterals(sourceFile));
  }
  return {
    scannedFiles: files.length,
    scannedFileList: files.map(relativeToRoot),
    registryConsumers,
    comparisons,
    ideValues,
    settingsPaths,
    verbLiterals
  };
}

const SCAN = scanProject();

const inAllowedDir = (file: string): boolean => ALLOWED_DIRS.some((dir) => file.startsWith(dir));

export { ALLOWED_DIRS, SCAN, VERB_ALLOWED_DIRS, inAllowedDir };
