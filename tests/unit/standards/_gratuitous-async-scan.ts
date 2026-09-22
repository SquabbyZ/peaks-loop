// tests/unit/standards/_gratuitous-async-scan.ts
//
// The traversal machinery behind `gratuitous-async-guard.test.ts`, extracted
// into a bare `.ts` sibling (the convention `tests/integration/_adapter-commands-harness.ts`
// already uses; `vitest.config.ts` collects `tests/unit/**/*.test.ts`, so this
// file is never a test).
//
// WHY THE SPLIT (slice rid-b4, 2026-09-22). Task 3 of that slice replaced the
// guard's three hand-kept reach literals with three cross-measurements, which
// added ~40 non-comment lines to the guard file: 439 against the repo's
// `max-lines` cap of 400 (`skipComments: true`, so prose does not count against
// it) and 835 physical lines against the 800-line file cap. Comments were not
// the problem and trimming them would not have fixed it — the CODE moved here.
//
// The guard keeps what is a claim about this repo: PINNED_SITES, the failure
// message, the fixture lifecycle and the assertions. Everything that is
// mechanism — the walk, its second mechanism, the git enumeration and the
// memoised program — lives here.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative as relativePath, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root, three levels up from `tests/unit/standards/`. */
export const REPO_ROOT = resolve(HERE, '../../..');

/** The trees this guard is stated over. `tests/` is deliberately NOT a member. */
export const TREES: readonly string[] = ['src', 'packages'];

/**
 * Generated output — never part of "the code this guard is stated over".
 *
 * Matched as a path SEGMENT, not as a prefix, since slice rid-b4. The prefix
 * form (this list was read as `rel === x || rel.startsWith(x + '/')`) only ever
 * fired for a tree-root `dist/`, so `packages/<pkg>/dist/*.d.ts` was never
 * excluded: `listTsFiles` handed 35 of them to `ts.createProgram` as root names
 * (measured: 858 root names before, 823 after). They are declaration files, so
 * `scan` skipped them and every counted number stayed the same — which is
 * exactly why nothing caught it. The exclusion is now the thing it says it is.
 */
export const EXCLUDED: readonly string[] = ['dist', 'node_modules', 'coverage'];

export interface Site {
  /** Repo-relative, POSIX separators — the form an operator can paste. */
  readonly file: string;
  readonly line: number;
}

export interface Scan {
  /** `.ts` files under the scanned trees that the program actually offered. */
  readonly files: number;
  /** Every async function-like node found in those files. */
  readonly asyncFunctions: number;
  /** Of those, the ones that reached the type-checked stage. */
  readonly checked: number;
  /** Candidates that would be flagged WITHOUT the thenable-return exemption. */
  readonly withoutThenableExemption: readonly Site[];
  /** The residual class: what this guard protects. */
  readonly violations: readonly Site[];
}

export interface AsyncReach {
  /** Every async function-like node found. */
  readonly asyncFunctions: number;
  /** Of those, the ones that reached the type-checked stage. */
  readonly checked: number;
}

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function isExcluded(full: string, root: string): boolean {
  const rel = toPosix(relativePath(root, full));
  return rel.split('/').some((segment) => EXCLUDED.includes(segment));
}

/**
 * The `.ts` files under TREES as GIT reports them — `--cached` (in the index)
 * unioned with `--others --exclude-standard` (on disk, not ignored), minus
 * declaration files, which `scan` skips before it counts anything.
 *
 * This is the INDEPENDENT enumeration the file reach is cross-checked against,
 * and the reason a new `.ts` file costs no literal edit: git sees it, the walk
 * sees it, and the two are compared rather than a number being compared to a
 * number. It replaces `expect(result.files).toBe(823)`, which moved on every
 * file added (817→818→821→823) and had to be re-typed by hand each time.
 *
 * One difference between git and a worktree is repaired rather than asserted: a
 * tracked file deleted but not yet staged is still listed by `--cached`, and it
 * is not a file the walk can see, so the index entry is dropped by an existence
 * check. That check repairs the enumeration; it is not where the expectation
 * comes from.
 */
export function listTsFilesFromGit(root: string): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...TREES],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // Repo standard (`tests/unit/spawn-windows-hide-guard.test.ts`): every
      // child_process call site pins this, or Windows flashes a console window.
      windowsHide: true
    }
  );
  return listed
    .split('\u0000')
    .filter(
      (path) =>
        path.length > 0 &&
        path.endsWith('.ts') &&
        !path.endsWith('.d.ts') &&
        !path.split('/').some((segment) => EXCLUDED.includes(segment))
    )
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

export function listTsFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (isExcluded(full, root)) continue;
    if (entry.isDirectory()) listTsFiles(full, root, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * `tsconfig.json`'s compilerOptions, so a fixture is judged under the same lib
 * and the same `strict` settings as the code it stands in for.
 */
export function repoCompilerOptions(): ts.CompilerOptions {
  // The reader is wrapped rather than passed as `ts.sys.readFile`: an unbound
  // method reference trips `@typescript-eslint/unbound-method`, and `ts.sys` is
  // an interface whose `readFile` is a method, not a free function.
  const readFile = (path: string): string | undefined => ts.sys.readFile(path);
  const configFile = ts.readConfigFile(join(REPO_ROOT, 'tsconfig.json'), readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, REPO_ROOT);
  return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

function isAsync(node: ts.FunctionLikeDeclaration): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

/**
 * Condition 2 — the **explicit** annotation. Never the inferred type: an
 * `async` function's inferred return type is always a Promise, so an
 * inferred-type test reads every site as "has a contract" and reports nothing.
 */
function hasPromiseAnnotation(node: ts.FunctionLikeDeclaration): boolean {
  const annotation = node.type;
  if (annotation === undefined || !ts.isTypeReferenceNode(annotation)) return false;
  const name = annotation.typeName.getText();
  return name === 'Promise' || name.endsWith('.Promise');
}

/** A body-less node (signature, `declare`, abstract) and `{}` both count as empty. */
function isEmptyBody(node: ts.FunctionLikeDeclaration): boolean {
  const body = node.body;
  if (body === undefined) return true;
  if (ts.isBlock(body)) return body.statements.length === 0;
  return false;
}

/**
 * The only type-level question this guard asks, and the reason it needs a
 * checker: does this return expression produce a thenable? Mirrors the rule's
 * `isThenableType` — a `then` property that is callable with an argument.
 */
function isThenableType(checker: ts.TypeChecker, node: ts.Expression): boolean {
  const type = checker.getTypeAtLocation(node);
  for (const part of type.isUnion() ? type.types : [type]) {
    const then = checker.getApparentType(part).getProperty('then');
    if (then === undefined) continue;
    const thenType = checker.getTypeOfSymbolAtLocation(then, node);
    for (const candidate of thenType.isUnion() ? thenType.types : [thenType]) {
      for (const signature of candidate.getCallSignatures()) {
        if (signature.parameters.length !== 0) return true;
      }
    }
  }
  return false;
}

interface OwnScope {
  readonly hasAwait: boolean;
  readonly hasThrow: boolean;
  readonly returnsThenable: boolean;
}

/**
 * Conditions 1 and 3, judged **by scope**: the walk stops at every nested
 * function-like node, so an `await` (or a `throw`) inside a callback does not
 * excuse the function that encloses it. This is the same boundary the ESLint
 * rule draws with its scope stack, and the reason a line-window grep is not a
 * substitute — it mis-hits a nested `await` a few lines down.
 */
function inspectOwnScope(checker: ts.TypeChecker, node: ts.FunctionLikeDeclaration): OwnScope {
  let hasAwait = false;
  let hasThrow = false;
  let returnsThenable = false;
  const visit = (child: ts.Node): void => {
    if (child !== node && ts.isFunctionLike(child)) return;
    if (ts.isAwaitExpression(child)) hasAwait = true;
    else if (ts.isThrowStatement(child)) hasThrow = true;
    else if (
      ts.isReturnStatement(child) &&
      child.expression !== undefined &&
      isThenableType(checker, child.expression)
    ) {
      returnsThenable = true;
    }
    ts.forEachChild(child, visit);
  };
  if (node.body !== undefined) visit(node.body);
  return { hasAwait, hasThrow, returnsThenable };
}

/** An expression-bodied arrow returns its body: `async () => somePromise`. */
function expressionBodyIsThenable(
  checker: ts.TypeChecker,
  node: ts.FunctionLikeDeclaration
): boolean {
  if (!ts.isArrowFunction(node) || ts.isBlock(node.body)) return false;
  return isThenableType(checker, node.body);
}

/**
 * Which arms of the traversal to run. The default is every arm; the non-default
 * values exist only for the guard's `injection` cases, which require the damage
 * they request to be observable.
 *
 * The point of routing the damage through the SAME parameters the real walk
 * reads is that a future edit which removes an arm from this file also removes
 * the ability to honour the matching injection — so `recurse: false`, for
 * instance, stops truncating the walk, the injection stops losing functions,
 * and the injection case fails. A private copy of the walk for the injections
 * would not have that property.
 */
export interface Arm {
  /** `false` models a `visit` that returns without descending — an early `return`. */
  readonly recurse: boolean;
  /** `false` models `isFunctionLikeDeclaration` losing its ArrowFunction arm. */
  readonly arrows: boolean;
}

export const FULL_ARM: Arm = { recurse: true, arrows: true };

function isFunctionLikeDeclaration(
  node: ts.Node,
  arm: Arm = FULL_ARM
): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    (arm.arrows && ts.isArrowFunction(node)) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

/**
 * The `src/` + `packages/` source files of a program, minus declaration files.
 *
 * Extracted so the two async-function mechanisms share ONE file-selection rule:
 * the file axis is cross-checked against git, so a change that narrowed it would
 * land on both mechanisms at once and need the git comparison — not the
 * cross-check — to catch it. Which is exactly what it does.
 */
function scopedSourceFiles(program: ts.Program, root: string): ts.SourceFile[] {
  const out: ts.SourceFile[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    // A `packages/<pkg>/dist/*.d.ts` is generated output the guard is not stated
    // over. `scan` used to reach this line only after counting the file; the
    // exclusion above now keeps it out of the program instead.
    if (sourceFile.isDeclarationFile) continue;
    const rel = toPosix(relativePath(root, sourceFile.fileName));
    if (!TREES.some((tree) => rel.startsWith(`${tree}/`))) continue;
    out.push(sourceFile);
  }
  return out;
}

/** The files a program offers, repo-relative and sorted — the file reach arm. */
export function scopedFileNames(program: ts.Program, root: string): string[] {
  return scopedSourceFiles(program, root)
    .map((sourceFile) => toPosix(relativePath(root, sourceFile.fileName)))
    .sort();
}

/**
 * The same two questions `scan` answers — how many async function-likes are
 * there, and how many of them reach the type checker — asked by a mechanism that
 * shares no traversal with it: an explicit worklist over `node.getChildren()`
 * instead of `ts.forEachChild` recursion. `getChildren` is a different API from
 * the same parser (it hands back the syntax tokens as well, which are never
 * function-like), so the two walks cannot lose the same node kind by accident.
 *
 * This is what makes the reach arm a MEASUREMENT rather than a literal. It
 * replaces `expect(result.asyncFunctions).toBe(578)` /
 * `expect(result.checked).toBe(577)`, which moved on every async function added
 * and had to be re-typed by hand. Measured on this tree: 578 / 577 both ways.
 */
export function collectAsyncReach(program: ts.Program, root: string): AsyncReach {
  let asyncFunctions = 0;
  let checked = 0;
  for (const sourceFile of scopedSourceFiles(program, root)) {
    const stack: ts.Node[] = [sourceFile];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) break;
      if (isFunctionLikeDeclaration(node) && isAsync(node)) {
        asyncFunctions += 1;
        if (!isEmptyBody(node) && node.asteriskToken === undefined) checked += 1;
      }
      for (const child of node.getChildren(sourceFile)) stack.push(child);
    }
  }
  return { asyncFunctions, checked };
}

/**
 * Walk a program's `src/` + `packages/` files and classify every async
 * function-like node. `root` is a parameter rather than the module constant so
 * the guard's behavior arms can drive the same decision from a fixture.
 */
export function scan(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  arm: Arm = FULL_ARM
): Scan {
  let files = 0;
  let asyncFunctions = 0;
  let checked = 0;
  const withoutThenableExemption: Site[] = [];
  const violations: Site[] = [];

  for (const sourceFile of scopedSourceFiles(program, root)) {
    const rel = toPosix(relativePath(root, sourceFile.fileName));
    files += 1;

    const visit = (node: ts.Node): void => {
      if (isFunctionLikeDeclaration(node, arm) && isAsync(node)) {
        asyncFunctions += 1;
        // Conditions 4 and 5, and the cheap half of "is there anything to say".
        if (!isEmptyBody(node) && node.asteriskToken === undefined) {
          checked += 1;
          const own = inspectOwnScope(checker, node);
          const exemptAsThenable = own.returnsThenable || expressionBodyIsThenable(checker, node);
          if (!own.hasAwait && !own.hasThrow && !hasPromiseAnnotation(node)) {
            const site: Site = {
              file: rel,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
            };
            withoutThenableExemption.push(site);
            if (!exemptAsThenable) violations.push(site);
          }
        }
      }
      // `recurse: false` models the early `return` the reach arm exists to
      // catch: the walk classifies what it is standing on and descends no
      // further, so every nested function-like node goes uncounted.
      if (!arm.recurse) return;
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return { files, asyncFunctions, checked, withoutThenableExemption, violations };
}

let repoProgram: ts.Program | undefined;

/**
 * The repo program, built ONCE per worker process (~1.5 s; a fixture is ~50 ms).
 *
 * Shared by the walk and by the second, non-recursive mechanism so the
 * cross-check compares two TRAVERSALS, not two programs: rebuilding it for the
 * second mechanism would make "they agree" also depend on the type checker
 * agreeing with itself.
 */
export function programForRepo(): ts.Program {
  repoProgram ??= ts.createProgram(
    TREES.flatMap((tree) => listTsFiles(join(REPO_ROOT, tree), REPO_ROOT)),
    repoCompilerOptions()
  );
  return repoProgram;
}

let repoScan: Scan | undefined;

/**
 * The real walk. Memoised for the DEFAULT arm only: the injection cases ask for
 * damaged arms, and answering those from a cache keyed on nothing would make the
 * damage unobservable — which is precisely the failure those cases exist to
 * refuse.
 */
export function scanRepo(arm: Arm = FULL_ARM): Scan {
  const program = programForRepo();
  if (arm === FULL_ARM) {
    repoScan ??= scan(program, program.getTypeChecker(), REPO_ROOT);
    return repoScan;
  }
  return scan(program, program.getTypeChecker(), REPO_ROOT, arm);
}

let repoReach: AsyncReach | undefined;

/** Mechanism 2 on the real tree — the independent measurement of the same reach. */
export function reachRepo(): AsyncReach {
  repoReach ??= collectAsyncReach(programForRepo(), REPO_ROOT);
  return repoReach;
}
