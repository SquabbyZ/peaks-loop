// tests/unit/runtime/vendor-neutral-identity-guard.test.ts
//
// Vendor-neutrality guard, second shape (slice
// 2026-09-12-auto-compact-vendor-neutrality).
//
// Why this file exists:
//   The repo declares vendor neutrality in two places —
//   `src/services/runtime/vendor-adapter.ts` (AC-1: vendor VERB strings live
//   only in `src/services/runtime/vendors/<vendor>.ts`) and the compact
//   dispatcher's own header ("No hard-coded IDE names"). AC-1's grep was
//   scoped to `src/services/code/`, a directory that does not contain the
//   compact path at all, so it returned 0 by construction while
//   `src/services/context/auto-compact-dispatcher.ts:99` refused every
//   non-`claude-code` adapter by name and
//   `src/services/context/main-session-monitor.ts:148` hard-derived the
//   compact pathway from the same name.
//
//   AC-1 is a VERB-STRING grep. Every one of those defects was an IDENTITY
//   decision against an IDE id, which no verb grep can match. This guard
//   covers identity in the THREE shapes a re-injection actually takes:
//
//     1. COMPARISON   `ideId !== 'claude-code'`, `adapter.id !== 'claude-code'`,
//                     `switch (ide) { case 'trae' }`                  → `findIdentityComparisons`
//     2. VALUE        `ide: 'claude-code'`, `return 'claude-code'`,
//                     `resolveHookSpec('claude-code')`                → `findIdeValueLiterals`
//     3. PATH         `join(root, '.claude', 'settings.local.json')`,
//                     i.e. an adapter-declared settings DIRECTORY used as a
//                     path literal                              → `findSettingsPathLiterals`
//
//   Shapes 2 and 3 exist because shape 1 alone was measurably too narrow:
//   QA re-injected the three original defects and only the comparison forms
//   were caught — the literal-assignment form (`ide: 'claude-code'`), the
//   hardcoded-path form, and the same gate re-keyed as `adapter.id !==
//   'claude-code'` all PASSED the shape-1-only guard.
//
// How it checks, and why not by splitting source text:
//   It parses every `src/**/*.ts` file with the TypeScript compiler (the
//   repo's own `typescript` devDependency — no new dependency) and asks the
//   AST for the property. A line/regex scan would match ids inside comments
//   and template strings — `src/services/runtime/vendor-adapter.ts` itself
//   quotes `claude --compact` in prose, and `auto-compact-dispatcher.ts`
//   names the ids in its explanatory comments. Those are documentation, not
//   decisions, and a text scan cannot tell them apart. This is the
//   `guard-verifies-syntax-shape-not-the-property` lesson applied the right
//   way round: parse, then ask for the property.
//
// The guarded data is READ FROM THE DECLARATIONS, not hardcoded here:
//   - IDE ids      ← the `IdeId` union (`src/services/ide/ide-types.ts`)
//                    and the `IdeKind` union (`src/services/context/ide-detect.ts`)
//   - settings dirs ← every `dirName: '<literal>'` in `src/services/ide/adapters/*`
//   Adding an IDE to either place extends this guard automatically — an
//   allowlist or an id list maintained inside the guard is a guard that drifts.
//
// SCOPE OF SHAPES 2 AND 3 — the registry-consumer rule
//   Shapes 2 and 3 are enforced on the modules that CONSUME the adapter
//   registry (`import ... from '.../ide-registry(.js)'`) and only those,
//   minus the adapter layer. The property they assert is one sentence: *a
//   module that routes per-IDE must not also name one IDE's id or one IDE's
//   settings path*. A module that never asks the registry cannot be routing,
//   and the repo legitimately contains Claude-specific modules (the `.claude`
//   rules tree writer, the Claude settings template, the runtime-vendor
//   adapters) that name `.claude` as their subject, not as a shortcut.
//   Enforcing shapes 2/3 over all of `src/` was measured before choosing:
//   24 id values (8 files) and 29 settings-path literals (18 files) — a union
//   of 23 files that would each need a debt or allowlist entry, i.e. a debt
//   list larger than the signal, and a guard that lists its exemptions is a
//   guard that reports nothing. The same rules scoped to registry consumers
//   flag 1 value site and 2 path sites, all three already pinned below. The
//   cost is stated as a limit (6, 7) rather than hidden.
//   Shape 1 (comparison) IS global, because a comparison against an IDE id
//   is an identity decision wherever it appears.
//
// ---------------------------------------------------------------------------
// WHAT THIS GUARD DOES NOT CATCH — read before treating vendor neutrality as
// proven. This list is the guard's LIMIT, not a disclaimer.
//
//   1. Indirect identity. `IDE_IDS.has(ide)`, `['trae'].includes(ide)`, a
//      `Record<IdeId, X>` index, a `Map.get`, or `if (ide in SPECIAL)` all
//      decide vendor identity and all pass. This is why shape 2 excludes
//      array elements and property KEYS: an id list or an id-keyed table is
//      the same hole as `.has(ide)` until something indexes it.
//      Live instance: `src/services/skills/hooks-settings-service.ts:202`
//      `!IDES_WITH_LOCAL_SETTINGS.has(ide)`.
//   2. A value that is an IDE id but is not NAME-reachable — for shape 1 the
//      non-literal side may now be ANY expression, so this limit is gone for
//      comparisons. It remains for shape 2: `const d = detectIdeFromEnv();
//      ide = d; ide: d` is not a literal and is not a hit.
//   3. Non-literal on both sides: `ide === SOME_CONST`, `ide === ids[0]`.
//      The literal must appear.
//   4. Files outside `src/**/*.ts`. `scripts/**`, `packages/**`,
//      `examples/**`, `.mjs` sources and generated `dist/**` are not scanned.
//      This is a REAL hole, not hypothetical: `scripts/install-skills.mjs:1061`
//      and `:1123` contain `ideId === 'claude-code'` and that file is shipped
//      (`package.json#files`). Excluded from this slice by explicit user
//      decision, recorded here so it is not mistaken for coverage.
//   5. `src/services/ide/**` is a DIRECTORY allowlist, so it is coarse: a
//      NEW file dropped into that directory gets a blanket exemption.
//      `src/services/ide/hook-protocol.ts:63,65` and
//      `src/services/ide/hook-translator.ts:148` are per-IDE name branches
//      sitting inside that exemption today. It is a directory rather than a
//      file list because the adapter layer's whole job is per-IDE knowledge
//      and adapters are added regularly; a file list would need editing on
//      every new adapter, and the natural way to make that edit is to add
//      the new file, which teaches nothing. The trade is accepted
//      deliberately: the directory boundary is the property, so enforcing it
//      by directory is enforcing the property itself.
//   6. Shapes 2 and 3 do not apply outside registry consumers (see the scope
//      block above). A module that hardcodes `ide: 'claude-code'` or a
//      `.claude` path WITHOUT importing the registry is invisible to them.
//      Shape 1 still covers that file's comparisons.
//      REAL INSTANCE, tested by name: `src/services/hooks/auto-compact-hook-install.ts`
//      is on the compact path and holds `AUTO_COMPACT_HOOK_SETTINGS_PATH =
//      '.claude/settings.local.json'` as its documented default for callers
//      with no adapter in hand. Shape 3 does not cover it. The dispatcher,
//      which IS covered, must pass the adapter-derived path — so this default
//      only reaches callers that hold no adapter.
//   7. Shape 2 (`findIdeValueLiterals`) skips these positions, deliberately
//      and by name. Each is a real, live pattern that stays invisible; the
//      counts are measured over today's registry consumers (adapter layer
//      excluded), so a reader can size each gap:
//        a. type positions                  `type X = 'claude-code'`
//        b. comparison operands             owned by shape 1 (6 sites)
//        c. `case` clauses                  owned by shape 1 (0 sites today)
//        d. property KEYS                   6 sites — the `HOOK_COMMAND_BY_IDE`
//                                           table in hooks-codegate-superpowers.ts
//        e. array elements                  1 site — `new Set<IdeId>(['claude-code'])`
//                                           in hooks-settings-service.ts:191
//        f. ternary branches                3 sites, all the "unknown → claude-code"
//                                           default: auto-compact-dispatcher.ts:99,
//                                           auto-compact-reader.ts:96, context-audit.ts:353
//        g. `??` / `||` right-hand sides    6 sites, same default policy
//                                           (`detectInstalledIde(root) ?? 'claude-code'`)
//      (f) and (g) are the repo's "unknown → claude-code" DEFAULT policy; (d)
//      and (e) are id tables. The C1 defect shape 2 exists for is the
//      opposite of a default: a literal that OVERRIDES a known adapter id.
//      If the default policy itself must be enforced, that is a separate
//      check with its own scope — it is not smuggled in here.
//   8. Shape 3 covers only the directory names the adapters DECLARE
//      (`dirName: '.claude'`, `'.trae'`, …). A hardcoded path to some other
//      IDE-specific location (`~/.config/...`, an env-var name, a settings
//      FILENAME) is invisible. An adapter that computes its `dirName`
//      instead of writing a literal contributes no name to the set.
//      It is also PATH-SHAPED only: `.claude` inside a sentence
//      (`"install into the user-level ~/.claude/settings.json instead"`) is
//      prose and is NOT flagged — the same reason AC-1 is not a grep.
//   9. The `KNOWN_DEBT` files below are pinned VIOLATIONS, not clean files —
//      see the list for what they are and why they are not fixed here.
//  10. It says nothing about whether the ALLOWED layer is correct. An adapter
//      can hardcode its own id anywhere; that is where ids belong.
//  11. `unknown` is excluded from the id set on purpose — `x === 'unknown'`
//      is an ordinary sentinel test, not a vendor claim.
//  12. Scope is decided by the registry IMPORT (static or dynamic). A module
//      that reaches the registry some other way — a CommonJS `require`, a
//      re-export from another module, or an adapter object handed in by its
//      caller — is not recognised as a consumer and shapes 2/3 skip it.
//
// ---------------------------------------------------------------------------
// AC-1 (vendor VERB strings) is enforced here too, in the same file, because
// both checks are the same property ("vendor knowledge lives in the adapter
// layer") applied to different shapes and they must be read together.
//
// AC-1's own scope was widened from `src/services/code/` to all of `src/` in
// this slice, and it could not stay a text grep: over `src/` the raw grep
// returns 13, of which 12 are COMMENTS quoting the verb (including AC-1's own
// doc block) and 1 is `compactCommand: 'claude --compact'` in the adapter
// that owns it. So the verb check below is also AST-based — it looks only at
// string literals and template literals, never at comments.
//
// What the AC-1 check does NOT catch:
//   a. A verb assembled at runtime — `'claude' + ' --compact'`, a template
//      with an interpolated binary name, a value read from config. Only
//      literal text is inspected.
//   b. VERBS OTHER THAN COMPACT. The three literals below are the set AC-1
//      names; a new vendor verb (`codex exec`, ...) is invisible until it is
//      added to `VENDOR_VERBS`, which is a deliberate edit in the guard.
//   c. Anything outside `src/**/*.ts` — same limit as check 4 above.
//   d. It asserts nothing about whether an allowed adapter's verb is
//      CORRECT; that is the adapter's own concern (and its own tests).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');

/** POSIX-normalised path relative to the project root. */
function relativeToRoot(absolutePath: string): string {
  return absolutePath.slice(PROJECT_ROOT.length + 1).split(sep).join('/');
}

/** Every TypeScript file under `src/`, recursively. `fs`, not a shell (Windows). */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseSourceFile(absolutePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * The string-literal members of a named string-literal union type alias
 * (`export type IdeId = 'a' | 'b'`). Read from the declaration so the guard
 * cannot drift from the union it guards.
 */
function stringUnionMembers(sourceFile: ts.SourceFile, typeName: string): string[] {
  const members: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isUnionTypeNode(node.type)) {
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
  for (const absolutePath of listSourceFiles(SRC_ROOT)) {
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
  /** `subject === 'id'` / `switch (subject) { case 'id' }`. */
  readonly form: 'comparison' | 'switch-case';
  /** Source text of the non-literal side. */
  readonly subject: string;
}

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * Shape 1 — IDE identity COMPARISONS.
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

  const literalId = (node: ts.Expression): string | null =>
    ts.isStringLiteral(node) && IDE_IDS.has(node.text) ? node.text : null;

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && IDENTITY_OPERATORS.has(node.operatorToken.kind)) {
      const leftId = literalId(node.left);
      const rightId = literalId(node.right);
      if (leftId !== null && !ts.isStringLiteral(node.right)) {
        record(node, 'comparison', leftId, briefText(sourceFile, node.right));
      }
      if (rightId !== null && !ts.isStringLiteral(node.left)) {
        record(node, 'comparison', rightId, briefText(sourceFile, node.left));
      }
    }
    if (ts.isSwitchStatement(node) && !ts.isStringLiteral(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue;
        const id = literalId(clause.expression);
        if (id !== null) {
          record(clause, 'switch-case', id, briefText(sourceFile, node.expression));
        }
      }
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
  if (ts.isBinaryExpression(parent) && IDENTITY_OPERATORS.has(parent.operatorToken.kind)) return true;
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
    if (ts.isStringLiteral(node) && IDE_IDS.has(node.text)) {
      if (!isTypePosition(node) && !isExcludedValuePosition(node)) {
        found.push({
          file: sourceFile.fileName,
          line: lineOf(sourceFile, node),
          id: node.text,
          position: valuePositionLabel(sourceFile, node)
        });
      }
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
    if (stripped === dirName || stripped.startsWith(`${dirName}/`) || stripped.startsWith(`${dirName}\\`)) {
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
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const dirName = matchesSettingsDir(node.text);
      if (dirName !== null && !isTypePosition(node)) {
        found.push({
          file: sourceFile.fileName,
          line: lineOf(sourceFile, node),
          dirName,
          text: node.text
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
 * BOTH forms count. A static `import { getAdapter } from '…/ide-registry.js'`
 * and a lazy `await import('…/ide-registry.js')` are the same decision — the
 * first draft of this predicate only saw the static form, which silently
 * dropped `src/cli/commands/share-commands.ts` (a real registry consumer,
 * lazy-importing `getAdapter` for `peaks share`) out of scope. Scope that is
 * narrower than it claims is the one failure mode this guard's own header
 * warns about, so the dynamic form is matched too.
 *
 * NOT matched: `require(...)` — this is an ESM tree, and a CommonJS require
 * cannot be typed through it (limit 12 in the header).
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

/**
 * Files reachable from the compact path that MUST stay registry consumers. If
 * a refactor stops importing the registry from one of these, shapes 2/3 would
 * silently stop checking it — the anti-silence test below fails instead.
 *
 * `src/services/hooks/auto-compact-hook-install.ts` is deliberately NOT here:
 * it is a compact-path module, but it never asks the registry, and it holds
 * Claude Code's path as a documented DEFAULT
 * (`AUTO_COMPACT_HOOK_SETTINGS_PATH`) for callers with no adapter in hand.
 * Shape 3 therefore does not cover it — limit 6, pinned as a named case in
 * the "documented default" test below rather than left implicit.
 */
const MUST_BE_COVERED: readonly string[] = [
  'src/services/context/auto-compact-dispatcher.ts',
  'src/services/context/main-session-monitor.ts'
];

/** The installer's documented Claude default — see `MUST_BE_COVERED`. */
const HOOK_INSTALLER_PATH = 'src/services/hooks/auto-compact-hook-install.ts';

/**
 * Pre-existing vendor-identity decisions OUTSIDE the adapter layer that this
 * slice did not fix. A ratchet, not an allowlist: the counts are pinned, so
 * any NEW decision in these files fails, and a file that gets fixed must be
 * removed from this list (the equality assertion below fails otherwise).
 *
 * Each is the SAME defect shape as the ones this slice repaired. They are
 * reported as debt rather than silently exempted.
 */
const KNOWN_DEBT: readonly {
  readonly file: string;
  readonly comparisons: number;
  readonly ideValues: number;
  readonly settingsPaths: number;
  readonly reason: string;
}[] = [
  {
    file: 'src/services/skills/hooks-codegate-superpowers.ts',
    comparisons: 4,
    ideValues: 0,
    settingsPaths: 0,
    reason:
      'picks the hook shell + the codegate entry per IDE; pre-existing, and ' +
      'changing it risks the `peaks hooks install` byte-stability contract ' +
      '(same class as the fixed dispatcher sites, out of this slice\'s scope)'
  },
  {
    file: 'src/services/skills/hooks-settings-service.ts',
    comparisons: 1,
    ideValues: 1,
    settingsPaths: 0,
    reason:
      'decides whether the settings writer emits env exemptions, keyed on the IDE ' +
      'name, and derives the default peaks-managed hook entries from ' +
      '`resolveHookSpec(\'claude-code\')`'
  },
  {
    file: 'src/cli/commands/hooks-commands.ts',
    comparisons: 1,
    ideValues: 0,
    settingsPaths: 2,
    reason:
      'CLI-level per-IDE branch for the hooks install flow, plus the Claude Code ' +
      'skill-bridge copy targets (`resolve(userHome, \'.claude\', \'skills\', …)`)'
  },
  {
    file: 'src/services/dispatch/dispatch-record-upgrade.ts',
    comparisons: 1,
    ideValues: 0,
    settingsPaths: 0,
    reason:
      'runtime-VENDOR axis, not the IDE axis: `vendor === \'codex\'` on a dispatch ' +
      'record. Caught only because shape 1 no longer filters by the counterpart\'s ' +
      'name; pinned rather than name-excluded (that filter was the `adapter.id` hole)'
  },
  {
    file: 'src/services/dispatch/dispatch-record-writer.ts',
    comparisons: 1,
    ideValues: 0,
    settingsPaths: 0,
    reason: 'same runtime-vendor axis as dispatch-record-upgrade.ts'
  }
];

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
  readonly registryConsumers: readonly string[];
  readonly comparisons: readonly IdentityComparison[];
  readonly ideValues: readonly IdeValueLiteral[];
  readonly settingsPaths: readonly SettingsPathLiteral[];
  readonly verbLiterals: readonly VerbLiteral[];
}

function scanProject(): ScanResult {
  const files = listSourceFiles(SRC_ROOT);
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
    registryConsumers,
    comparisons,
    ideValues,
    settingsPaths,
    verbLiterals
  };
}

const SCAN = scanProject();

const inAllowedDir = (file: string): boolean => ALLOWED_DIRS.some((dir) => file.startsWith(dir));
const isDebt = (file: string): boolean => KNOWN_DEBT.some((debt) => debt.file === file);

describe('vendor neutrality — IDE identity decisions outside the adapter layer (slice 2026-09-12)', () => {
  it('parses a real part of the tree (anti-silence: a broken scanner must not pass)', () => {
    // A scanner that silently walks nothing, or stops recognising the id
    // literals, would make every assertion below vacuously green. Pin the
    // walk, the id set, the settings-dir derivation and the scope.
    expect(SCAN.scannedFiles).toBeGreaterThan(400);
    expect(IDE_IDS.has('claude-code')).toBe(true);
    expect(IDE_IDS.has('trae')).toBe(true);
    expect(IDE_IDS.has('opencode')).toBe(true);
    // `unknown` is a sentinel, never a vendor id.
    expect(IDE_IDS.has('unknown')).toBe(false);
    // The settings-dir set came from the adapter declarations, not from thin air.
    expect(SETTINGS_DIR_NAMES.has('.claude')).toBe(true);
    expect(SETTINGS_DIR_NAMES.has('.trae')).toBe(true);
    expect(SETTINGS_DIR_NAMES.size).toBeGreaterThanOrEqual(8);
    // Shapes 2/3 are scoped by this set; if it collapses, they check nothing.
    expect(SCAN.registryConsumers.length).toBeGreaterThan(10);
    for (const required of MUST_BE_COVERED) {
      expect(SCAN.registryConsumers, `${required} fell out of guard coverage`).toContain(required);
    }
  });

  it('finds no IDE identity comparison outside the adapter layer and the pinned debt', () => {
    const unexpected = SCAN.comparisons
      .filter((hit) => {
        const file = relativeToRoot(hit.file);
        return !inAllowedDir(file) && !isDebt(file);
      })
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${hit.subject} vs '${hit.id}' (${hit.form})`);
    expect(unexpected).toEqual([]);
  });

  it('finds no IDE id asserted as a value inside a registry consumer', () => {
    const unexpected = SCAN.ideValues
      .filter((hit) => {
        const file = relativeToRoot(hit.file);
        return !inAllowedDir(file) && !isDebt(file);
      })
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${hit.position} '${hit.id}'`);
    expect(unexpected).toEqual([]);
  });

  it('finds no hardcoded IDE settings path inside a registry consumer', () => {
    const unexpected = SCAN.settingsPaths
      .filter((hit) => {
        const file = relativeToRoot(hit.file);
        return !inAllowedDir(file) && !isDebt(file);
      })
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} '${hit.text}' (${hit.dirName})`);
    expect(unexpected).toEqual([]);
  });

  it('the pinned debt is exactly the known set — no growth, no stale entries', () => {
    // Exact-set + exact-count equality on purpose, per shape. A new violation
    // in one of these files changes a count and fails; fixing one of them
    // leaves a stale entry and fails, forcing the list to shrink with the debt.
    const actual = KNOWN_DEBT.map((debt) => ({
      file: debt.file,
      comparisons: SCAN.comparisons.filter((hit) => relativeToRoot(hit.file) === debt.file).length,
      ideValues: SCAN.ideValues.filter((hit) => relativeToRoot(hit.file) === debt.file).length,
      settingsPaths: SCAN.settingsPaths.filter((hit) => relativeToRoot(hit.file) === debt.file).length
    }));
    expect(actual).toEqual(
      KNOWN_DEBT.map((debt) => ({
        file: debt.file,
        comparisons: debt.comparisons,
        ideValues: debt.ideValues,
        settingsPaths: debt.settingsPaths
      }))
    );
  });

  it('the files this slice repaired stay clean in all three shapes (regression pin)', () => {
    // The sites the guard was written for. Asserted by name so a future
    // refactor that reintroduces any of the three shapes fails HERE, with the
    // file named, rather than as an anonymous entry in the list above.
    const repaired = [
      'src/services/context/auto-compact-dispatcher.ts',
      'src/services/context/main-session-monitor.ts'
    ];
    const offenders = [
      ...SCAN.comparisons
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} comparison ${hit.subject} vs '${hit.id}'`),
      ...SCAN.ideValues
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} value ${hit.position} '${hit.id}'`),
      ...SCAN.settingsPaths
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} path '${hit.text}'`)
    ];
    expect(offenders).toEqual([]);
  });

  it('negative control — the five re-injection shapes this guard exists for are all detected', () => {
    // The shapes QA used to falsify the comparison-only guard, one fixture
    // each, in a file that consumes the registry (so shapes 2/3 apply). Four
    // of the five were invisible before this rewrite.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `// A: the deleted up-front gate`,
      `const a = target === 'main' && ideId !== 'claude-code';`,
      `// B: the pathway derived from the name`,
      `const b = ide === 'claude-code' ? 'ide-native' : 'llm-self-compress';`,
      `// C1: the adapter's own id replaced by a literal`,
      `const c1 = { ok: true, ide: 'claude-code', pathway: 'ide-native' };`,
      `// C2: the adapter's settings path replaced by a literal`,
      `const c2 = join(root, '.claude', 'settings.local.json');`,
      `// D: the same gate re-keyed onto the adapter object`,
      `const d = adapter.id !== 'claude-code';`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(true);
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.form}:${h.id}`)).toEqual([
      '3:comparison:claude-code',
      '5:comparison:claude-code',
      '11:comparison:claude-code'
    ]);
    expect(findIdeValueLiterals(parsed)).toEqual([
      { file: 'fixture.ts', line: 7, id: 'claude-code', position: 'ide:' }
    ]);
    expect(findSettingsPathLiterals(parsed).map((h) => `${h.line}:${h.text}`)).toEqual([
      "9:.claude"
    ]);
  });

  it('negative control — prose, the runtime-vendor axis and non-identity tests are NOT shape-1 hits', () => {
    const fixture = [
      "// ide === 'claude-code' used to decide this (comment, not code)",
      "const doc = \"an adapter that declares ide === 'trae' is fine\";",
      "const isUnknown = ide === 'unknown';",
      "const isPresent = ide !== undefined;",
      "const byTable = IDE_SET.has(ide);",
      "const sameConst = ide === IDE_DEFAULT;"
    ].join('\n');
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', fixture))).toEqual([]);
    // The runtime-vendor axis is NOT invisible any more — it is caught and
    // pinned as debt (see KNOWN_DEBT). Pinned here so nobody "restores" a
    // name filter that would silently reopen the `adapter.id` hole.
    const vendorAxis = "const vendor = obj.vendor === 'codex';";
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', vendorAxis)).map((h) => h.id)).toEqual([
      'codex'
    ]);
  });

  it('negative control — shape 2 catches `ide:` / `return` / argument values, and skips the documented positions', () => {
    const fixture = [
      `const c1 = { ide: 'claude-code' };`, // property value → caught
      `function f(): string { return 'trae'; }`, // return → caught
      `const g = h('cursor');`, // call argument → caught
      `const table: Record<string, number> = { 'claude-code': 1 };`, // property KEY → id table, excluded
      `const list = ['trae', 'cursor'];`, // array element → id table, excluded
      `const p = detected === 'unknown' ? 'claude-code' : detected;`, // default policy, excluded
      `const q = detected ?? 'claude-code';`, // default policy, excluded
      `const t = typeof x === 'string' ? 'x' : 'y';`, // no id literal at all
      `const r = ide === 'qoder';` // comparison → owned by shape 1
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdeValueLiterals(parsed).map((h) => `${h.line}:${h.position}:${h.id}`)).toEqual([
      "1:ide::claude-code",
      '2:return:trae',
      '3:h(...):cursor'
    ]);
    // ...and the comparison in line 9 is caught by shape 1, not lost.
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.id}`)).toEqual(['9:qoder']);
  });

  it('negative control — shape 3 is path-shaped: a prose mention of `.claude` is not a path', () => {
    const fixture = [
      `const p1 = join(root, '.claude', 'settings.local.json');`, // path → caught
      `const p2 = '.claude';`, // path → caught
      `const p3 = '~/.claude/settings.json';`, // user-level path → caught
      `const prose = 'install into the user-level ~/.claude/settings.json instead';`, // prose
      `const doc = 'Import memories from ~/.claude/projects/<hash>/memory/*.md';`, // prose
      `const other = join(root, '.peaks', 'runtime');` // not an adapter dir
    ].join('\n');
    expect(findSettingsPathLiterals(parseSourceFile('fixture.ts', fixture)).map((h) => `${h.line}:${h.text}`)).toEqual([
      '1:.claude',
      '2:.claude',
      '3:~/.claude/settings.json'
    ]);
  });

  it('negative control — shapes 2/3 are scoped: a non-consumer file is not checked by them', () => {
    // Limit 6, pinned. A hardcoded id/path in a module that never asks the
    // registry is deliberately out of scope for shapes 2/3 — state it here so
    // the guard is not read as covering the whole tree.
    const fixture = [
      `const c1 = { ide: 'claude-code' };`,
      `const p = join(root, '.claude', 'settings.local.json');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(false);
    expect(findIdeValueLiterals(parsed)).toHaveLength(1);
    expect(findSettingsPathLiterals(parsed)).toHaveLength(1);
    // The scanner applies shape 2/3 only when `isRegistryConsumer` is true —
    // asserted on the real tree by the scope test above.
  });

  it('scope detector — a LAZY registry import counts as consuming it (real instance: share-commands.ts)', () => {
    // The static-only first draft of `isRegistryConsumer` dropped
    // `src/cli/commands/share-commands.ts` — a real consumer — out of scope
    // and nothing failed, because the file happens to have no hits. Scope
    // narrower than its own claim is the failure mode this guard's header
    // warns about; pin both forms here so it cannot regress silently.
    const lazy = `const { getAdapter } = await import('../../services/ide/ide-registry.js');`;
    const eager = `import { getAdapter } from '../../services/ide/ide-registry.js';`;
    const unrelated = `const x = await import('../context/auto-compact-types.js');`;
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', lazy))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', eager))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', unrelated))).toBe(false);
    // ...and the real file is in the measured scope.
    expect(SCAN.registryConsumers).toContain('src/cli/commands/share-commands.ts');
  });

  it('limit 6, real instance — the compact hook installer keeps a Claude path default and is NOT covered by shape 3', () => {
    // The one compact-path module the scope rule does not reach. It is pinned
    // here so the gap is a tested fact, not a footnote: if someone deletes
    // the default (the good outcome) this test fails and the limit is revised;
    // if someone ADDS a second `.claude` literal there, this fails too.
    // The dispatcher — which IS covered — must pass the adapter-derived path,
    // so this default only serves callers holding no adapter.
    const sourceFile = parseSourceFile(HOOK_INSTALLER_PATH, readFileSync(join(PROJECT_ROOT, HOOK_INSTALLER_PATH), 'utf8'));
    expect(isRegistryConsumer(sourceFile)).toBe(false);
    expect(findSettingsPathLiterals(sourceFile).map((hit) => `${hit.line}:${hit.text}`)).toEqual([
      '87:.claude/settings.local.json'
    ]);
  });
});

describe('AC-1 — vendor verb strings live only in adapter implementations', () => {
  it('finds no vendor verb string outside the adapter implementations', () => {
    const unexpected = SCAN.verbLiterals
      .filter((hit) => !VERB_ALLOWED_DIRS.some((dir) => relativeToRoot(hit.file).startsWith(dir)))
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${JSON.stringify(hit.verb)}`);
    expect(unexpected).toEqual([]);
  });

  it('the adapter implementation that owns the verb still carries it (anti-silence)', () => {
    // Pins the count in the ALLOWED side too: if the verb check silently
    // stopped recognising literals, the assertion above would go vacuously
    // green. Exactly one such literal exists in `src/`.
    const allowed = SCAN.verbLiterals.filter((hit) =>
      VERB_ALLOWED_DIRS.some((dir) => relativeToRoot(hit.file).startsWith(dir))
    );
    expect(allowed.map((hit) => `${relativeToRoot(hit.file)}:${hit.line}`)).toEqual([
      // Re-pinned 585 → 618 in round 2 of slice
      // 2026-09-13-auto-compact-trigger-ownership: JSDoc added above the
      // `compact` profile (the ratchet/self-lock explanation) moved the
      // literal. The pin's VALUE changed; its meaning did not — still exactly
      // one vendor verb literal, still in the adapter that owns it.
      'src/services/ide/adapters/claude-code-adapter.ts:618'
    ]);
  });

  it('negative control — a verb in a COMMENT is not a violation (this is why AC-1 is not a grep)', () => {
    // The raw grep over `src/` returns 13; 12 of those are lines exactly
    // like these. Prose is not a decision.
    const fixture = [
      '// AC-1: `rg -n "claude --compact|codex --compact|copilot compact"`',
      '/**',
      ' * heavy lifting (ratio probe + in-band `claude --compact` spawn)',
      ' */',
      'const banner = `run copilot compact to compact`;'
    ].join('\n');
    // Lines 1-4 are comments (line + block) → invisible. Line 5 is a REAL
    // template literal and IS a hit: a template can be an executed command,
    // so it is inspected like any other literal.
    expect(findVendorVerbLiterals(parseSourceFile('fixture.ts', fixture)).map((h) => h.line)).toEqual([5]);
  });

  it('negative control — a verb assembled at runtime is NOT flagged (check limit a)', () => {
    // Pinned so nobody reads the check above as "verbs cannot escape".
    const fixture = [
      "const binary = 'claude';",
      'const cmd = `${binary} --compact`;'
    ].join('\n');
    expect(findVendorVerbLiterals(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });
});
