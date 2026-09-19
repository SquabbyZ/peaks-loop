// tests/unit/spawn-windows-hide-guard.test.ts
//
// Drift guard for the `windowsHide` repo convention. Created by slice
// 2026-09-12 `integration-ci-and-windowshide` as a hardcoded 14-file ratchet;
// WIDENED to dynamic discovery by slice 2026-09-13 `winhide-sweep`
// (rid 2026-09-13-winhide-sweep).
//
// Why this test file exists:
//   The convention is documented in-repo — `src/services/lint/detect-ocr-18.ts`
//   ("`windowsHide` on every spawn (repo convention): without it this probe
//   pops…"), and `packages/peaks-loop-internal-runtime/src/process-supervisor.ts`
//   sets it correctly with a comment saying it was added to stop the
//   "pre-F2 弹 PowerShell 窗口". So the convention was known, applied in one
//   place — and never swept. 14 source files still spawned without it, and the
//   user-visible symptom was a blank `cmd.exe` window per spawn (an `ENOENT`
//   spawn leaves the empty window behind too, so a *failing* spawn still cost a
//   manual window close).
//
// Why the 14-file list was not enough:
//   The first slice fixed 14 files, all under `src/`, and wrote their paths into
//   this guard. Every sweep report since then said "fixed", and the user kept
//   seeing windows, because the guard's scope WAS the fix's scope: a file that
//   was never fixed and never listed was invisible to the guard by
//   construction. `tests/integration/**` — the files the user actually runs
//   when the windows appear — spawn `git` and `node` in nearly every file and
//   were never in scope at all. The list is now DISCOVERED, not typed: every
//   source file under `src/`, `tests/`, `scripts/`, `packages/` that imports
//   `child_process` is guarded, whatever the import shape.
//
// How it checks, and why not by splitting source text:
//   It parses each guarded file with the TypeScript compiler and walks the AST
//   for `CallExpression`s whose callee is a name bound to a `child_process`
//   import — directly, through a renamed import (`import { spawn as nodeSpawn }`),
//   through a namespace import, through CJS `require`, through a dynamic
//   `await import`, or through a same-file alias such as
//   `const spawnFn = deps.spawnFn ?? spawn` (`test-commands.ts`). A regex or
//   line-based scan would also match `spawn(` inside comments and template
//   strings: `test-commands.ts` contains `spawn(shim, argv, { shell: true })`
//   inside a JSDoc block, `tests/integration/_cli-helper.ts` names the
//   `execFileSync` call it deleted in prose, and `src/services/adapter/
//   adapter-registry.ts` mentions "child_process handles" in a comment while
//   importing `spawn` for real — documentation and decision are the same bytes
//   to a text scan.
//
// HOW THE WALK IS KEPT HONEST (a previous ad-hoc sweep got this wrong):
//   An earlier throwaway scanner put `if (!IMPORT_RE.test(src)) return;` inside
//   its recursive directory walk. `return` exits the WHOLE walk frame, so every
//   remaining entry in that directory and every not-yet-visited subdirectory was
//   skipped — the miss count depended on `readdirSync` return order and two runs
//   of it differed by 20x. So the walk here is split in two:
//     - `collectCandidateFiles()` walks and collects, and its ONLY skips are
//       `continue` inside a per-entry loop, plus a directory-name prune. It
//       reads no file. Nothing about a file's content can shorten it.
//     - candidate -> verdict is a separate pass, one file at a time.
//   `discovery walks the whole tree …` below pins that property by asserting
//   the walk returns files that do NOT import child_process (from three
//   different roots). If a content check ever moves into the walk, those
//   assertions fail instead of the guard quietly shrinking.
//
// The per-file literal prefilter, and why it is not the same mistake:
//   Reading + `ts.createSourceFile` for all ~1150 candidate files costs seconds;
//   ~164 of them mention `child_process` at all. So the per-file pass checks
//   `source.includes('child_process')` BEFORE parsing. That is a per-file gate
//   applied after the walk has already produced its full file list — it can
//   decide a file is not protected, it cannot decide a directory is done. The
//   VERDICT is always AST; the prefilter only skips work.
//
// ---------------------------------------------------------------------------
// WHAT THIS GUARD DOES NOT CATCH — read before treating window suppression as
// proven. This list is the guard's LIMIT, not a disclaimer.
//
//   1. Cross-file helper encapsulation. `tests/integration/_cli-helper.ts` and
//      `src/shared/process.ts` are `child_process` importers, so they ARE in
//      scope and their own call sites ARE checked. But a module that exports
//      `runGit()` built from a hidden spawn and is then called from a file that
//      does not itself import `child_process` puts the call sites in the
//      helper — which is correct here and is the recommended shape. The limit
//      is the inverse: a helper defined in a file that is not an importer of a
//      checked module (e.g. a wrapper around a third-party spawner) is
//      invisible, and this guard will not tell you the wrapper forgot.
//   2. Options that are not visible in this file. A same-file
//      `const OPTS = { … }` used directly as the options argument IS resolved
//      (one level, `const` only), and so is a spread of it. A same-file
//      `OPTS.windowsHide = true` assignment also counts — the guard asks
//      whether the object is given the flag, not how the source spells it, so
//      the platform-conditional pattern in `process-supervisor.ts` (win32 only,
//      pinned by its own unit test) is not a violation. What is NOT resolved,
//      and is reported instead: a `let` binding, a parameter or import
//      (`runPnpm(args, opts)` — the caller's object), and an options object
//      built by a factory the guard cannot follow.
//   3. Dynamically built module specifiers. Discovery matches the literal
//      strings `'child_process'` / `'node:child_process'` in an import
//      declaration, a `require(<literal>)` call, or an `import(<literal>)`
//      call. `require('node:child_' + 'process')` is missed twice over: the
//      prefilter does not see the substring, and the AST sees no literal.
//   4. Computed member access. `cp['spawn'](...)`, `cp[method](...)`, and
//      destructuring through a function (`const { run } = pick(cp)`) are not
//      call sites to this guard. Only `cp.spawn` and bare identifiers resolve.
//   5. `dist/`, `node_modules/`, `.git/`, `coverage/`, `.peaks/` are pruned by
//      DIRECTORY NAME. Build output (`packages/*/dist/*.js`) and generated
//      copies are out of scope by design — checking a build artifact tells you
//      nothing the source does not, and the artifact is regenerated. The
//      consequence is that a repo shipping a checked-in generated JS file that
//      is NOT reproducible from `src/` would go unchecked.
//   6. Files outside the four scanned roots. `examples/video-demo/**` is walked
//      by neither the discovery nor a test here; it is a demo, not shipped code,
//      but it is genuinely uncovered.
//   7. Value correctness beyond the literal `true`: `windowsHide: someVar` is
//      rejected (conservative — it cannot be checked statically), but so would
//      any computed form a future refactor might legitimately want.
//   8. The flag being *effective*. This guard asserts the flag is SET, nothing
//      about `detached` / `stdio` / `shell` semantics, and nothing about the
//      child's own descendants — `windowsHide` applies to the process you
//      spawn, not to what it spawns in turn.
//   9. Mocked modules. A file that calls `vi.mock('node:child_process')` is
//      exempted wholesale: every call site in it targets the mock, so no
//      process is created and no window can pop. The list is not typed by hand
//      — it IS the scan result; see `mocked-module exemptions …` below. The
//      cost: a file that mocks the module for one test and spawns for real in
//      another is exempt throughout. No file does that today.
//  10. A callback passed by NAME. `optionsArgumentOf` steps over trailing
//      function LITERALS to find `execFile(cmd, args, opts, cb)`. A named
//      callback (`execFile(cmd, args, opts, onDone)`) is not recognised as a
//      callback, so the options argument is read as `onDone` and the call
//      reports "not statically visible". Conservative — it over-reports, it
//      does not miss.
//  11. `child_process` re-exported through a barrel, `ChildProcess` constructed
//      directly, and any entry point not listed in `CHILD_PROCESS_ENTRY_POINTS`
//      — the seven there are `spawn`, `spawnSync`, `execFile`, `execFileSync`,
//      `exec`, `execSync`, `fork`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Roots scanned for `child_process` importers. */
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'packages'] as const;

/**
 * Directory names never descended into, pruned by NAME only. This set is
 * consulted in the walk's per-entry loop; no file is opened to decide it.
 */
const PRUNED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.peaks',
  '.turbo',
  'build',
  'out',
  '.next'
]);

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

const CHILD_PROCESS_SPECIFIERS = new Set(['child_process', 'node:child_process']);

const CHILD_PROCESS_ENTRY_POINTS = new Set([
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'exec',
  'execSync',
  // `fork` is a window source too — it is `spawn` plus an IPC channel, and the
  // detached cron daemon in `cron-scheduler-commands.ts` is exactly the shape
  // that otherwise leaves a console window behind.
  'fork'
]);

type Bindings = {
  /** Local names bound to one of CHILD_PROCESS_ENTRY_POINTS — `import { spawn as
   *  nodeSpawn }` binds `nodeSpawn`, which is what a call site uses. */
  readonly named: Set<string>;
  /** `import * as cp` / `const cp = require(…)` / `const cp = await import(…)`. */
  readonly namespaces: Set<string>;
  /** same-file aliases, e.g. `const spawnFn = deps.spawnFn ?? spawn`. */
  readonly aliases: Set<string>;
};

/** Same-file `const X = { … }` literals, so `{ ...X, env }` can be resolved. */
type ObjectLiterals = ReadonlyMap<string, ts.ObjectLiteralExpression>;

type SpawnSite = {
  readonly line: number;
  readonly callee: string;
  readonly ok: boolean;
  readonly why: string;
};

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function parseSource(source: string, fileName: string): ts.SourceFile {
  const scriptKind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.(js|mjs|cjs)$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
}

// ---------------------------------------------------------------------------
// Discovery — part 1: the walk. Reads nothing, prunes by name only.
// ---------------------------------------------------------------------------

function collectCandidateFiles(): readonly string[] {
  const found: string[] = [];
  const pending: string[] = SCAN_ROOTS.map((root) => resolve(PROJECT_ROOT, root));

  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A root that does not exist in a given checkout is not an error.
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // `continue`, never `return` — the rest of this directory and every
        // queued sibling directory still get visited.
        if (PRUNED_DIRECTORY_NAMES.has(entry.name)) continue;
        pending.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SCANNED_EXTENSIONS.has(extname(entry.name))) continue;
      found.push(toPosix(relative(PROJECT_ROOT, join(dir, entry.name))));
    }
  }

  return found.sort();
}

// ---------------------------------------------------------------------------
// Discovery — part 2: per-file AST verdict. No file's result can affect another.
// ---------------------------------------------------------------------------

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAwaitExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function isChildProcessSpecifier(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isStringLiteral(node) && CHILD_PROCESS_SPECIFIERS.has(node.text);
}

/** `import('node:child_process')` — the CALL form, not the `import('…')` TYPE. */
function isDynamicImportOfChildProcess(expression: ts.Expression): boolean {
  return (
    ts.isCallExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
    isChildProcessSpecifier(expression.arguments[0])
  );
}

/** `require('node:child_process')` */
function isRequireOfChildProcess(expression: ts.Expression): boolean {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'require' &&
    isChildProcessSpecifier(expression.arguments[0])
  );
}

/** The expression evaluates to the `child_process` MODULE OBJECT. */
function isChildProcessModuleValue(expression: ts.Expression): boolean {
  const inner = unwrap(expression);
  return isDynamicImportOfChildProcess(inner) || isRequireOfChildProcess(inner);
}

/** Bound to the `child_process` entry point named `importedName`? */
function isEntryPointName(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isIdentifier(node) && CHILD_PROCESS_ENTRY_POINTS.has(node.text);
}

/**
 * A declaration that cannot spawn: `import type { ChildProcess } from
 * 'node:child_process'` and `import { type ChildProcess } from …` name the
 * module but bind nothing callable, so they must not put a file in scope.
 */
function isTypeOnlyChildProcessImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

/**
 * Does this file introduce `child_process` at all? Static ESM import, `import x
 * = require(…)`, CJS `require(<literal>)`, or dynamic `import(<literal>)`.
 */
function importsChildProcess(sourceFile: ts.SourceFile): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      isChildProcessSpecifier(node.moduleSpecifier) &&
      !isTypeOnlyChildProcessImport(node)
    ) {
      hit = true;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isChildProcessSpecifier(node.moduleReference.expression)
    ) {
      hit = true;
    }
    if (ts.isCallExpression(node)) {
      if (isDynamicImportOfChildProcess(node) || isRequireOfChildProcess(node)) hit = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hit;
}

/**
 * Which argument is the options object? Not simply the last one:
 * `execFile(cmd, args, opts, cb)` and `exec(cmd, opts, cb)` put a CALLBACK last,
 * and the first version of this guard read that callback as the options — so
 * `src/shared/process.ts` and `packages/…/vendor/detect-binary.ts`, which both
 * pass a real options object WITHOUT `windowsHide`, were reported as
 * "not statically visible" instead of as the violations they are.
 *
 * Steps over trailing function literals. `execFile(cmd, args, cb)` then yields
 * the args array, which is correctly reported as "not an options object" — the
 * call really does pass none, and the window really does pop.
 */
function optionsArgumentOf(node: ts.CallExpression): ts.Expression | undefined {
  let index = node.arguments.length - 1;
  while (index >= 0) {
    const argument = node.arguments[index];
    if (argument === undefined) return undefined;
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      index -= 1;
      continue;
    }
    return argument;
  }
  return undefined;
}

function collectBindings(sourceFile: ts.SourceFile): Bindings {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  const aliases = new Set<string>();
  const bindings: Bindings = { named, namespaces, aliases };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!isChildProcessSpecifier(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly === true) continue;
    const clause = statement.importClause?.namedBindings;
    if (clause === undefined) continue;
    if (ts.isNamespaceImport(clause)) {
      namespaces.add(clause.name.text);
      continue;
    }
    for (const element of clause.elements) {
      // `import { spawn as nodeSpawn }` — the LOCAL name is what the call uses,
      // but the IMPORTED name is what says it is an entry point.
      if (element.isTypeOnly) continue;
      if (!isEntryPointName(element.propertyName ?? element.name)) continue;
      named.add(element.name.text);
    }
  }

  // Value bindings and aliases, in document order so `const a = spawn;` then
  // `const b = a;` both resolve, and so a `require`/dynamic-import namespace is
  // known before a later alias points at it.
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const initializer = node.initializer;
      if (isChildProcessModuleValue(initializer)) {
        if (ts.isIdentifier(node.name)) {
          namespaces.add(node.name.text);
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            if (!isEntryPointName(element.propertyName ?? element.name)) continue;
            named.add(element.name.text);
          }
        }
      } else if (ts.isIdentifier(node.name) && isChildProcessRef(initializer, bindings)) {
        aliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

/**
 * `const execFileAsync = promisify(execFile)` — the shape three files in this
 * repo use, and the one that hid two un-hidden spawns on the per-turn
 * `peaks code context-now` probe path until this pass. `promisify` returns a
 * function with the SAME parameter list, so a call through it is a call site.
 * Covers `promisify(x)` and `util.promisify(x)`.
 */
function isPromisifiedChildProcessRef(expression: ts.Expression, bindings: Bindings): boolean {
  if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) return false;
  const callee = expression.expression;
  const isPromisify =
    (ts.isIdentifier(callee) && callee.text === 'promisify') ||
    (ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.name) &&
      callee.name.text === 'promisify');
  if (!isPromisify) return false;
  const argument = expression.arguments[0];
  return argument !== undefined && isChildProcessRef(argument, bindings);
}

function isChildProcessRef(expression: ts.Expression, bindings: Bindings): boolean {
  if (ts.isIdentifier(expression)) {
    return bindings.named.has(expression.text) || bindings.aliases.has(expression.text);
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ts.isIdentifier(expression.name)
  ) {
    return (
      bindings.namespaces.has(expression.expression.text) &&
      CHILD_PROCESS_ENTRY_POINTS.has(expression.name.text)
    );
  }
  if (isPromisifiedChildProcessRef(expression, bindings)) return true;
  if (ts.isParenthesizedExpression(expression))
    return isChildProcessRef(expression.expression, bindings);
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken) {
      return (
        isChildProcessRef(expression.left, bindings) ||
        isChildProcessRef(expression.right, bindings)
      );
    }
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isChildProcessRef(expression.whenTrue, bindings) ||
      isChildProcessRef(expression.whenFalse, bindings)
    );
  }
  return false;
}

/**
 * Same-file `const X = { … }` literals. `const` only: a `let` can be
 * reassigned, and resolving a reassigned binding to its initializer would
 * invent a verdict.
 */
function collectObjectLiterals(sourceFile: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const literals = new Map<string, ts.ObjectLiteralExpression>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      literals.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

function callSiteIfChildProcess(
  node: ts.CallExpression,
  bindings: Bindings
): { callee: string; options: ts.Expression | undefined } | null {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    if (!bindings.named.has(callee.text) && !bindings.aliases.has(callee.text)) return null;
    return { callee: callee.text, options: optionsArgumentOf(node) };
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
    if (!CHILD_PROCESS_ENTRY_POINTS.has(callee.name.text)) return null;
    const owner = callee.expression;
    const ownedByNamespace = ts.isIdentifier(owner) && bindings.namespaces.has(owner.text);
    if (!ownedByNamespace && !isChildProcessModuleValue(owner)) return null;
    return {
      callee: `${ts.isIdentifier(owner) ? owner.text : 'child_process'}.${callee.name.text}`,
      options: optionsArgumentOf(node)
    };
  }
  return null;
}

/**
 * Same-file `X.windowsHide = true` assignments, so an options object built in a
 * literal and then flag-set conditionally still counts as hidden.
 *
 * Why this exists: `packages/peaks-loop-internal-runtime/src/process-supervisor.ts`
 * sets `windowsHide` only on win32 and pins that split in
 * `tests/unit/runtime/process-supervisor-in-shell.test.ts` cases 1a/1b — POSIX
 * must NOT get the flag, Windows must. Demanding it in the literal would mean
 * deleting a deliberate, separately-tested platform contract to satisfy a
 * syntax preference. So the guard asks the property instead: *is this object
 * given the flag?* It does NOT verify that the assignment is unconditional or
 * reachable — that is the business of the test that owns the platform split.
 */
function collectWindowsHideAssignments(sourceFile: ts.SourceFile): Set<string> {
  const assigned = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      ts.isIdentifier(node.left.name) &&
      node.left.name.text === 'windowsHide' &&
      node.right.kind === ts.SyntaxKind.TrueKeyword
    ) {
      assigned.add(node.left.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return assigned;
}

function propertyNameOf(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
    return null;
  const key = property.name;
  if (ts.isIdentifier(key) || ts.isStringLiteral(key)) return key.text;
  return null;
}

function hasWindowsHideTrue(
  options: ts.Expression | undefined,
  literals: ObjectLiterals,
  assigned: ReadonlySet<string>,
  visited: ReadonlySet<string>
): { ok: boolean; why: string } {
  if (options === undefined) {
    return {
      ok: false,
      why: 'no options argument at all — `windowsHide` cannot be set, the window will pop'
    };
  }
  // `spawn(cmd, args, OPTS)` where `const OPTS = { … }` in this file: resolve to
  // the literal. Without this, `ocr-18-acquire.ts` (which DOES set
  // `windowsHide: true`, in a shared `options` const) reads as a defect.
  if (ts.isIdentifier(options) && !visited.has(options.text)) {
    const next = new Set(visited);
    next.add(options.text);
    if (assigned.has(options.text)) return { ok: true, why: '' };
    const inlined = literals.get(options.text);
    if (inlined !== undefined) return hasWindowsHideTrue(inlined, literals, assigned, next);
  }
  if (!ts.isObjectLiteralExpression(options)) {
    // The argument found is an argv array or a bare argument, not an options
    // object: `spawn('c')`, `execFileSync('tar', ['-xzf', t])`. That call passes
    // no options at all, and saying so is more useful than "not an object
    // literal", which reads as if an options object were being hidden.
    const looksLikeArgv =
      ts.isArrayLiteralExpression(options) ||
      ts.isStringLiteralLike(options) ||
      ts.isNumericLiteral(options);
    return {
      ok: false,
      why: looksLikeArgv
        ? 'no options argument at all — `windowsHide` cannot be set, the window will pop'
        : 'options are not an object literal here; `windowsHide` is not statically visible'
    };
  }
  let sawInlinedLiteral = false;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      const target = property.expression;
      if (ts.isIdentifier(target) && !visited.has(target.text)) {
        const inlined = literals.get(target.text);
        if (inlined !== undefined) {
          sawInlinedLiteral = true;
          const next = new Set(visited);
          next.add(target.text);
          const verdict = hasWindowsHideTrue(inlined, literals, assigned, next);
          if (verdict.ok) return verdict;
        }
      }
      continue;
    }
    if (propertyNameOf(property) !== 'windowsHide') continue;
    if (ts.isShorthandPropertyAssignment(property)) {
      return { ok: false, why: '`windowsHide` is present but not the literal `true`' };
    }
    if (
      ts.isPropertyAssignment(property) &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      return { ok: true, why: '' };
    }
    return { ok: false, why: '`windowsHide` is present but not the literal `true`' };
  }
  return {
    ok: false,
    why: sawInlinedLiteral
      ? 'object literal options with a spread whose source object also lacks `windowsHide`'
      : 'object literal options without a `windowsHide` property'
  };
}

function sitesOfSourceFile(sourceFile: ts.SourceFile): readonly SpawnSite[] {
  const bindings = collectBindings(sourceFile);
  const literals = collectObjectLiterals(sourceFile);
  const assigned = collectWindowsHideAssignments(sourceFile);
  const sites: SpawnSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const hit = callSiteIfChildProcess(node, bindings);
      if (hit !== null) {
        const verdict = hasWindowsHideTrue(hit.options, literals, assigned, new Set<string>());
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        sites.push({ line: line + 1, callee: hit.callee, ok: verdict.ok, why: verdict.why });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/**
 * `vi.mock('node:child_process')` matches. Call sites in such a file target the
 * mock, so no process is created and no window can pop — `windowsHide` there is
 * noise, and pinning it as debt would claim a defect that does not exist.
 */
function mocksChildProcess(sourceFile: ts.SourceFile): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === 'mock' &&
      isChildProcessSpecifier(node.arguments[0])
    ) {
      hit = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hit;
}

// ---------------------------------------------------------------------------
// The one scan. Everything below reads from this; nothing below re-parses.
// ---------------------------------------------------------------------------

type Scan = {
  readonly candidates: readonly string[];
  /** Files that introduce `child_process` via any supported shape. */
  readonly protectedFiles: readonly string[];
  readonly siteCounts: ReadonlyMap<string, number>;
  readonly violations: readonly { readonly file: string; readonly site: SpawnSite }[];
  /** Discovered — not typed. See `mocked-module exemptions …` below. */
  readonly mockedFiles: readonly string[];
};

const SCAN: Scan = (() => {
  const candidates = collectCandidateFiles();
  const protectedFiles: string[] = [];
  const siteCounts = new Map<string, number>();
  const violations: { file: string; site: SpawnSite }[] = [];
  const mockedFiles: string[] = [];

  for (const file of candidates) {
    const source = readFileSync(resolve(PROJECT_ROOT, file), 'utf8');
    if (!source.includes('child_process')) continue; // per-file prefilter; walk already done
    const sourceFile = parseSource(source, file);
    if (!importsChildProcess(sourceFile)) continue;
    if (mocksChildProcess(sourceFile)) mockedFiles.push(file);
    const sites = sitesOfSourceFile(sourceFile);
    protectedFiles.push(file);
    siteCounts.set(file, sites.length);
    for (const site of sites) {
      if (!site.ok) violations.push({ file, site });
    }
  }

  return {
    candidates,
    protectedFiles: [...protectedFiles].sort(),
    siteCounts,
    violations,
    mockedFiles: [...mockedFiles].sort()
  };
})();

const formatViolation = (entry: { readonly file: string; readonly site: SpawnSite }): string =>
  `${entry.file}:${entry.site.line} ${entry.site.callee}(…) — ${entry.site.why}`;

/**
 * A file that imports `child_process` but where the scanner resolves ZERO call
 * sites is the dangerous case: it looks guarded, it passes, and it is invisible.
 * Such files are listed here EXPLICITLY, with the reason, so that silence is an
 * act rather than an accident. Adding an entry is deliberate, and
 * `keeps NO_RESOLVED_CALL_SITES exact` fails if a listed file starts spawning
 * again, stops importing, or gets mocked. Mocked files are the other source of
 * zero sites and are handled by the `SCAN.mockedFiles` rule instead.
 *
 * This is the anti-silence assertion from the first slice, widened. It used to
 * be `GUARDED_FILES.filter(collectSites(f).length === 0)` over a hand-typed
 * list, which could only ever fail for a path someone had already added.
 */
const NO_RESOLVED_CALL_SITES: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'src/services/dispatch/post-merge.ts',
    why: 'imports `execFileSync` and never calls it — a dead import left by the merge-back refactor; the real git spawn is in `merge-back-runner.ts`.'
  }
];

/**
 * Files this slice did NOT fix, with the EXACT number of un-hidden call sites
 * each still has. A ratchet, not an allowlist:
 *   - growth fails (`count` is an equality, not a ceiling), so a new un-hidden
 *     spawn added to a debt file is caught;
 *   - shrinkage ALSO fails, so the table cannot go stale — fix a site and you
 *     must lower the number here; fix the last one and the entry must be
 *     deleted. That is what keeps this table from drifting into a place where
 *     nobody looks.
 * Files that are fully clean today are not listed at all: a clean file is
 * covered by `no file has an un-hidden child_process call site …` for free,
 * because scope is discovered rather than declared.
 */
const KNOWN_DEBT: readonly { readonly file: string; readonly count: number }[] = [];

const debtFor = (file: string): number => KNOWN_DEBT.find((debt) => debt.file === file)?.count ?? 0;

/** Violations that can actually pop a window: mock-only files excluded. */
const LIVE_VIOLATIONS = SCAN.violations.filter((entry) => !SCAN.mockedFiles.includes(entry.file));

const liveCountsByFile = (): readonly { file: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const entry of LIVE_VIOLATIONS) counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
};

describe('spawn hygiene — `windowsHide: true` on every child_process call site', () => {
  describe('discovery', () => {
    it('walks the whole tree and does not let file content shorten the walk', () => {
      // These three files do NOT import `child_process` (one is a helper that
      // mentions it only in prose). They are only in the list if the walk
      // collected candidates unconditionally, from three different roots — the
      // property a content check inside the walk destroys.
      expect(SCAN.candidates).toContain('src/cli/index.ts');
      expect(SCAN.candidates).toContain('tests/integration/_cli-helper.ts');
      expect(SCAN.candidates).toContain('scripts/sync-version.mjs');
      expect(SCAN.candidates.length).toBeGreaterThan(1000);
    });

    it('excludes build output and dependency trees', () => {
      const pruned = SCAN.candidates.filter(
        (file) =>
          PRUNED_DIRECTORY_NAMES.has(file.split('/')[0] ?? '') ||
          file.split('/').some((segment) => PRUNED_DIRECTORY_NAMES.has(segment))
      );
      expect(pruned).toEqual([]);
      expect(SCAN.candidates.some((file) => file.includes('node_modules/'))).toBe(false);
    });

    it('is deterministic — the list is sorted, so `readdirSync` order cannot change it', () => {
      expect(SCAN.candidates).toEqual([...SCAN.candidates].sort());
      expect(SCAN.protectedFiles).toEqual([...SCAN.protectedFiles].sort());
    });

    it('finds every supported import shape in real files (not just in the fixture below)', () => {
      const shapes: readonly (readonly [string, string])[] = [
        ['static named import', 'tests/integration/dispatch-merge-and-e2e.e2e.test.ts'],
        ['renamed import (`spawn as nodeSpawn`)', 'src/cli/commands/e2e-verify.ts'],
        ['value + type in one import', 'src/services/codegraph/codegraph-process-runner.ts'],
        ['CJS `require` destructuring', 'src/services/workflow/workflow-skip-service.ts'],
        ['dynamic `await import` destructuring', 'src/cli/commands/loop-commands.ts'],
        ['dynamic `await import` namespace', 'src/services/dispatch/dispatch-record-writer.ts'],
        ['same-file alias (`deps.spawnFn ?? spawn`)', 'src/cli/commands/test-commands.ts']
      ];
      const missed = shapes.filter(([, file]) => !SCAN.protectedFiles.includes(file));
      expect(missed).toEqual([]);
    });

    it('does not put a type-only `child_process` import in scope', () => {
      // `packages/peaks-loop-internal-runtime/src/dispatch.ts` has
      // `import type { ChildProcess }` and spawns through the supervisor.
      expect(SCAN.protectedFiles).not.toContain(
        'packages/peaks-loop-internal-runtime/src/dispatch.ts'
      );
    });

    it('scopes the integration suite the user actually runs, not a list typed here', () => {
      expect(SCAN.protectedFiles).toContain('tests/integration/dispatch-merge-and-e2e.e2e.test.ts');
      expect(
        SCAN.protectedFiles.filter((file) => file.startsWith('tests/integration/')).length
      ).toBeGreaterThan(20);
    });
  });

  describe('scanner calibration — the verdicts, both directions, on all shapes', () => {
    // In-memory fixture: it is scanned by `sitesOfSourceFile` directly, so it is
    // never part of the walk and never lands in KNOWN_DEBT. It is the positive
    // control the widened guard needs — proof that the AST pass still reports an
    // un-hidden call, so a green suite means "clean", not "the scanner went
    // blind".
    const FIXTURE = [
      `import { spawn, execFile, execFileSync as run, type ChildProcess } from 'node:child_process';`,
      `import * as cp from 'node:child_process';`,
      `const { spawnSync } = require('node:child_process');`,
      `const spawnFn = deps.spawnFn ?? spawn;`,
      `const dyn = await import('node:child_process');`,
      `const runAsync = promisify(execFile);`,
      `const OPTS = { windowsHide: true, env: {} };`,
      `const BARE = { cwd: '/tmp' };`,
      ``,
      `spawn('a', [], { windowsHide: true });`,
      `spawn('b', [], { cwd: '/tmp' });`,
      `spawn('c');`,
      `spawnFn('d', [], { windowsHide: true, env: {} });`,
      `cp.execFile('e', [], { windowsHide: true });`,
      `run('f', []);`,
      `spawnSync('g', []);`,
      `const shared = { windowsHide: true, env: {} };`,
      `spawn('h', [], { ...shared });`,
      `spawn('i', [], { ...BARE });`,
      `const notOptions = { windowsHide: false };`,
      `spawn('j', [], notOptions);`,
      `dyn.spawn('k', []);`,
      `require('node:child_process').execSync('l');`,
      `execFile('m', [], { timeout: 5 }, (e, o) => {});`,
      `runAsync('n', [], { windowsHide: true });`,
      `runAsync('n2', []);`,
      `spawn('o', [], OPTS);`,
      `spawn('p', [], { ...OPTS, cwd: '/tmp' });`,
      `spawn('q', [], externalOpts);`,
      `const platformOpts = { detached: false };`,
      `if (isWin) { platformOpts.windowsHide = true; }`,
      `spawn('r', [], platformOpts);`
    ].join('\n');

    const sites = sitesOfSourceFile(parseSource(FIXTURE, 'fixture.ts'));
    const oks = sites.filter((site) => site.ok);
    const bad = sites.filter((site) => !site.ok);
    const label = (site: SpawnSite): string => `${site.callee}@${site.line}`;

    it('collects a call site for every shape in the fixture', () => {
      expect(sites.length).toBe(19);
    });

    it('passes exactly the sites that set `windowsHide: true`', () => {
      // @13 alias, @14 namespace, @18 inlined spread, @25 promisified alias,
      // @27 a shared `const` options object, @28 a spread of it, @32 an object
      // flag-set by assignment (the platform-conditional shape).
      expect(oks.map(label).sort()).toEqual(
        [
          'spawn@10',
          'spawnFn@13',
          'cp.execFile@14',
          'spawn@18',
          'runAsync@25',
          'spawn@27',
          'spawn@28',
          'spawn@32'
        ].sort()
      );
    });

    it('reports exactly the sites that do not, with a reason each', () => {
      expect(bad.map(label).sort()).toEqual(
        [
          'spawn@11', // literal without the property
          'spawn@12', // no options at all
          'run@15', // no options at all
          'spawnSync@16', // no options at all
          'spawn@19', // spread of a local literal that lacks it
          'spawn@21', // shared `const` with `windowsHide: false`
          'dyn.spawn@22', // no options at all
          'child_process.execSync@23', // no options at all
          'execFile@24', // options is the 3rd arg, the callback is 4th
          'runAsync@26', // no options at all
          'spawn@29' // an options object this file cannot see
        ].sort()
      );
      for (const site of bad) expect(site.why.length).toBeGreaterThan(0);
      expect(bad.map((site) => site.why)).toContain(
        'no options argument at all — `windowsHide` cannot be set, the window will pop'
      );
      expect(bad.map((site) => site.why)).toContain(
        'object literal options with a spread whose source object also lacks `windowsHide`'
      );
      expect(bad.map((site) => site.why)).toContain(
        'options are not an object literal here; `windowsHide` is not statically visible'
      );
      expect(bad.map((site) => site.why)).toContain(
        '`windowsHide` is present but not the literal `true`'
      );
    });

    it('does not invent a call site for a name that is not from child_process', () => {
      const decoy = sitesOfSourceFile(
        parseSource(
          [
            `import { spawn } from 'node:fs';`,
            `import { spawn as notThis } from './x';`,
            `import type { spawnSync } from 'node:child_process';`,
            `spawn('a');`,
            `notThis('b');`,
            `spawnSync('c');`
          ].join('\n'),
          'decoy.ts'
        )
      );
      expect(decoy).toEqual([]);
    });
  });

  describe('anti-silence', () => {
    it('never drops a protected file for resolving zero call sites', () => {
      const excused = [...SCAN.mockedFiles, ...NO_RESOLVED_CALL_SITES.map((entry) => entry.file)];
      const silent = SCAN.protectedFiles.filter(
        (file) => SCAN.siteCounts.get(file) === 0 && !excused.includes(file)
      );
      expect(silent).toEqual([]);
    });

    it('keeps `NO_RESOLVED_CALL_SITES` exact — no stale entries', () => {
      const stale = NO_RESOLVED_CALL_SITES.filter(
        (entry) =>
          !SCAN.protectedFiles.includes(entry.file) ||
          SCAN.mockedFiles.includes(entry.file) ||
          (SCAN.siteCounts.get(entry.file) ?? 0) > 0
      ).map((entry) => entry.file);
      expect(stale).toEqual([]);
      for (const entry of NO_RESOLVED_CALL_SITES) expect(entry.why.length).toBeGreaterThan(20);
    });
  });

  describe('mocked-module exemptions', () => {
    it('exempts exactly the files that `vi.mock` child_process — discovered, not typed', () => {
      // Nothing is hardcoded: the set IS the scan result. If a file stops
      // mocking, the exemption stops applying on the next run.
      expect(SCAN.mockedFiles.length).toBeGreaterThan(0);
      for (const file of SCAN.mockedFiles) {
        expect(SCAN.protectedFiles).toContain(file);
        expect(file.startsWith('tests/')).toBe(true);
      }
    });

    it('never exempts a file that could pop a window in production', () => {
      // Every mocked file is a test file that mocks the module away, so the
      // exemption can never hide a shipped call site. Asserted rather than
      // assumed: `mocksChildProcess` only inspects the file it is given.
      for (const file of SCAN.mockedFiles) expect(file.startsWith('tests/')).toBe(true);
      expect(LIVE_VIOLATIONS.filter((entry) => SCAN.mockedFiles.includes(entry.file))).toEqual([]);
    });
  });

  describe('the debt ratchet', () => {
    it('is not made green by skipping a directory or a file', () => {
      // Pins the two things that would quietly reproduce the old 14-file list:
      // pruning a subtree out of scope, or exempting a file by name.
      expect(
        SCAN.protectedFiles.filter((file) => file.startsWith('tests/')).length
      ).toBeGreaterThan(50);
      expect(SCAN.protectedFiles.filter((file) => file.startsWith('src/')).length).toBeGreaterThan(
        50
      );
    });

    it('has no debt entry that does not match its file exactly', () => {
      const actual = liveCountsByFile().filter((entry) => debtFor(entry.file) > 0);
      const pinned = [...KNOWN_DEBT].sort((a, b) =>
        a.file < b.file ? -1 : a.file > b.file ? 1 : 0
      );
      // Exact count equality in both directions: a new un-hidden call site in a
      // debt file pushes the number up and fails; a fix pushes it down and also
      // fails, forcing the table to be updated rather than left stale.
      expect(actual).toEqual(pinned);
    });

    it('has no un-debited file with an un-hidden child_process call site', () => {
      const unpinned = LIVE_VIOLATIONS.filter((entry) => debtFor(entry.file) === 0);
      expect(unpinned.map(formatViolation)).toEqual([]);
    });

    it('has no ghost debt entry', () => {
      const ghosts = KNOWN_DEBT.filter(
        (debt) => !SCAN.protectedFiles.includes(debt.file) || debt.count === 0
      );
      expect(ghosts).toEqual([]);
    });

    it('records the exact inventory it is ratcheting (so a report cannot quote a stale number)', () => {
      // The sum is the slice's authoritative debt number. It is also asserted
      // against the per-file table, so a number quoted in a report and the
      // number the guard enforces cannot diverge.
      expect(LIVE_VIOLATIONS.length).toBe(KNOWN_DEBT.reduce((sum, debt) => sum + debt.count, 0));
      expect(KNOWN_DEBT.map((debt) => debt.file)).toEqual(
        [...KNOWN_DEBT.map((debt) => debt.file)].sort()
      );
    });
  });

  describe('this slice’s target', () => {
    it('leaves no un-hidden child_process call site anywhere under tests/integration/', () => {
      const remaining = LIVE_VIOLATIONS.filter((entry) =>
        entry.file.startsWith('tests/integration/')
      );
      expect(remaining.map(formatViolation)).toEqual([]);
    });
  });
});
