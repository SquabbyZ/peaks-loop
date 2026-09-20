// tests/unit/standards/gratuitous-async-guard.test.ts
//
// WHAT THIS GUARD IS FOR
//
// `@typescript-eslint/require-await` was turned OFF repo-wide on 2026-09-20
// (`config/eslint/.peaks-rules.cjs`, and the evidence in
// `.peaks/docs/lint-rule-divergences.md`). It was turned off because 259 of its
// 291 findings in this repo were the rule being wrong, not debt. But it was not
// flagged as noise either: the hazard behind it is real, and this guard carries
// that hazard forward —
//
//   an `async` function with no `await` runs synchronously, so a LATER `await`
//   added at the top makes everything below it asynchronous. If that code has a
//   side effect, the ordering changes with no error and no test that fails.
//
// This guard fires on the residual class: `async`, no `await` in its own scope,
// no declared `Promise<…>` return type, no bare `throw` in its own body, a
// non-empty body, and a non-thenable return. Those are the sites where the
// reordering hazard is live — the other 277 findings were contracts (`async` =
// the interface's Promise) or deliberate rejection semantics (`async f(){throw}`
// moves the throw from the synchronous path into the rejection channel).
//
// WHY THIS IS A TYPE-CHECKER GUARD AND NOT JUST AN AST WALK
//
// The naive sibling of this guard — "flag `async` with no `await`" — reports 21
// sites here, not 14. The extra 7 are `async (x) => pollDispatchRecords(x)` and
// `async () => { …; return base.query(…) }`: their `async` is also gratuitous,
// but the rule this guard replaces **exempts a function whose return expression
// is thenable**, and those 7 are exactly that. Reproducing the class the rule
// actually reported therefore needs the same basis the rule used: the type
// checker. `scan()` keeps BOTH numbers — `withoutThenableExemption` (21) and
// `violations` (14) — so the exemption's effect is visible and pinned rather
// than smuggled in as a sixth condition.
//
// ⚠ THE TRAP, RECORDED BECAUSE IT IS EASY TO FALL INTO
//
// An `async` function's **inferred** return type is ALWAYS a `Promise`. A
// predicate of the form "flag when the return type is not a Promise" flags
// **nothing at all**. The only workable basis is the **explicit annotation** —
// which is what condition 2 below tests, via `node.type`, never via
// `checker.getSignatureFromDeclaration`.
//
// WHAT IT ASSERTS
//
//   violations (load-bearing): exactly the pinned 14 sites, listed `file:line`.
//   reach (the anti-weakening arm): the number of files, async functions and
//            type-checked candidates the walk actually consumed is pinned, so a
//            traversal that returns early, drops a node kind or narrows its root
//            fails HERE instead of passing below. "Proving it can go red" is not
//            enough: a guard that visits nothing also reports nothing.
//   arms (behavior): the contract-less `async` goes red; the `Promise<…>`-
//            annotated one stays green; a nested `await` does NOT excuse its
//            outer function.
//
// SCOPE — `src/` + `packages/` only. `tests/**` is exempt, matching the
// `tests/**` overrides already in `config/eslint/.peaks-rules.cjs` (the 18
// genuinely gratuitous `it`/`test` callbacks there were removed in the same
// slice; a test callback's "no await" is not the hazard this guard measures,
// because vitest awaits the returned value either way).
//
// Omitting the `a11y` dimension: this guard has no human-visible surface of its
// own — it emits no stdout, no exit code and no message. The vitest assertion
// text it fails with is covered by `render`.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative as relativePath, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/standards/gratuitous-async-guard.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The trees this guard is stated over. `tests/` is deliberately NOT a member. */
const TREES: readonly string[] = ['src', 'packages'];

/** Generated output — never part of "the code this guard is stated over". */
const EXCLUDED: readonly string[] = ['dist', 'node_modules', 'coverage'];

/**
 * The 14 sites this guard exists to keep visible, as `file:line`.
 *
 * Pinned as a SET, not just as a count: a count assertion alone cannot tell
 * "the same 14" from "13 of the old ones and a new one", and the whole point of
 * the guard is that a human can inspect the list.
 *
 * This list moves for exactly three reasons:
 *   - a site left the class (an `await` was added, a `Promise<…>` annotation was
 *     written, or the `async` was removed) — that is the guard working;
 *   - a new `async` with no `await`, no contract and no `throw` was written —
 *     that is the guard working too;
 *   - an unrelated edit above one of these sites shifted its LINE NUMBER, with
 *     the same 14 functions still in the class (slice rid-s10-any-roots-ts,
 *     2026-09-20: the three `job-commands.ts` entries moved 349/354/371 ->
 *     429/434/451, a uniform +80, when the option interfaces for that file's
 *     eleven Commander actions were inserted above them. Same three functions,
 *     same reasons they are in the class; only the line moved).
 * All three are edits to THIS list, made by hand, with the reason recorded here.
 */
const PINNED_SITES: readonly string[] = [
  'src/cli/commands/code-job-shape-commands.ts:55',
  'src/cli/commands/job-commands.ts:429',
  'src/cli/commands/job-commands.ts:434',
  'src/cli/commands/job-commands.ts:451',
  'src/services/adapter/codex-adapter.ts:17',
  'src/services/adapter/copilot-adapter.ts:17',
  'src/services/capability-guard-runner/contracts/J04.ts:24',
  'src/services/capability-guard-runner/contracts/J05.ts:76',
  'src/services/evolution/independent-evaluator-runner.ts:122',
  'src/services/evolution/regression-skeptic-runner.ts:98',
  'src/services/llm/stub-runner.ts:35',
  'src/services/slice/slice-decompose-runners.ts:39',
  'src/services/slice/slice-decompose-runners.ts:89',
  'src/services/slice/slice-decompose-runners.ts:153'
];

interface Site {
  /** Repo-relative, POSIX separators — the form an operator can paste. */
  readonly file: string;
  readonly line: number;
}

interface Scan {
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

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function isExcluded(full: string, root: string): boolean {
  const rel = toPosix(relativePath(root, full));
  return EXCLUDED.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
}

function listTsFiles(dir: string, root: string, out: string[] = []): string[] {
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
function repoCompilerOptions(): ts.CompilerOptions {
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

function isFunctionLikeDeclaration(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

/**
 * Walk a program's `src/` + `packages/` files and classify every async
 * function-like node. `root` is a parameter rather than the module constant so
 * the behavior arms can drive the same decision from a fixture.
 */
function scan(program: ts.Program, checker: ts.TypeChecker, root: string): Scan {
  let files = 0;
  let asyncFunctions = 0;
  let checked = 0;
  const withoutThenableExemption: Site[] = [];
  const violations: Site[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const rel = toPosix(relativePath(root, sourceFile.fileName));
    if (!TREES.some((tree) => rel.startsWith(`${tree}/`))) continue;
    files += 1;

    const visit = (node: ts.Node): void => {
      if (isFunctionLikeDeclaration(node) && isAsync(node)) {
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
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return { files, asyncFunctions, checked, withoutThenableExemption, violations };
}

let repoScan: Scan | undefined;

/** Built once per worker process: a full program is ~1.5 s, a fixture is ~50 ms. */
function scanRepo(): Scan {
  if (repoScan === undefined) {
    const program = ts.createProgram(
      TREES.flatMap((tree) => listTsFiles(join(REPO_ROOT, tree), REPO_ROOT)),
      repoCompilerOptions()
    );
    repoScan = scan(program, program.getTypeChecker(), REPO_ROOT);
  }
  return repoScan;
}

function describeViolations(violations: readonly Site[]): string {
  if (violations.length === 0) return '';
  return (
    `${violations.length} async function(s) have no \`await\` in their own scope, no explicit ` +
    '`Promise<…>` return annotation, no `throw` in their own body and a non-thenable return. ' +
    'Each runs synchronously today, so an `await` added at the top would silently make ' +
    'everything below it asynchronous. Remove the `async` (adding a `Promise<…>` annotation ' +
    'if it satisfies a contract), add the missing `await`, or if the `async` is deliberate, ' +
    'say why in the source and update PINNED_SITES: ' +
    violations.map((v) => `${v.file}:${v.line}`).join(', ')
  );
}

function site(s: Site): string {
  return `${s.file}:${s.line}`;
}

function withFixtureProgram(
  files: Readonly<Record<string, string>>,
  body: (result: Scan) => void
): void {
  const root = mkdtempSync(join(tmpdir(), 'peaks-gratuitous-async-'));
  try {
    // `scan` filters by the tree prefix, so the fixture has to materialise one —
    // otherwise every behavior case reports 0 for a reason that has nothing to
    // do with the decision under test. The tree is created explicitly and the
    // walk stays strict: a missing tree is a real error, not something to swallow.
    for (const tree of TREES) mkdirSync(join(root, tree), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const full = join(root, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    const rootNames = TREES.flatMap((tree) => listTsFiles(join(root, tree), root));
    const program = ts.createProgram(rootNames, repoCompilerOptions());
    body(scan(program, program.getTypeChecker(), root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── integration: the real tree ───────────────────────────────────────

describe('Scenario: integration — the guard walks the real src/ + packages/ trees', () => {
  const result = scanRepo();

  it('visits every .ts file under src/ + packages/ (the root is pinned, not sampled)', () => {
    // A probe that samples nothing reports green for the whole space. This pin
    // moves only when a `.ts` file is added to or removed from `src/` or
    // `packages/` — 817 at the moment the guard landed.
    // 817 -> 818 (slice rid-s10-any-roots-ts): +1 is `src/shared/array-guards.ts`,
    // the non-narrowing `isArray` helper. A new file is the documented reason
    // this pin moves.
    expect(result.files).toBe(818);
  });

  it('visits every async function in those files (the recursion is pinned)', () => {
    // A walk that stops early, or that drops one node kind, reports green for
    // everything it no longer reaches. 578 async function-likes, of which 577
    // are non-empty and not generators and therefore reach the type checker.
    expect(result.asyncFunctions).toBe(578);
    expect(result.checked).toBe(577);
  });

  it('keys the class on the rule own thenable exemption, and that exemption is worth 7 sites', () => {
    // The naive predicate — `async`, no own-scope `await`, no `Promise<…>`
    // annotation, no own-body `throw`, non-empty body, not a generator —
    // reports 21 sites, not 14. Measured: the 7-site difference is exactly the
    // functions whose return expression is thenable (`async (x) => poll(x)`,
    // `async () => { …; return base.query(…) }`), which the rule this guard
    // replaces exempts. Both numbers are pinned so the sixth condition is
    // auditable rather than invisible.
    expect(result.withoutThenableExemption).toHaveLength(21);
    expect(result.violations).toHaveLength(14);
  });

  it('finds exactly the pinned residual class, no more and no fewer', () => {
    // The set, not only the count: 14 of the right shape would still be wrong.
    // Sorted on both sides — the walk yields them in the program's file order,
    // which is not a property worth pinning, and sorting keeps the diff readable
    // when one site leaves and another arrives in the same run.
    expect([...result.violations.map(site)].sort(), describeViolations(result.violations)).toEqual(
      [...PINNED_SITES].sort()
    );
  });
});

// ── behavior: the decision, on fixtures ──────────────────────────────

describe('Scenario: behavior — the decision, on fixture programs', () => {
  it('flags a contract-less async function with no await (the class the guard is for)', () => {
    withFixtureProgram(
      { 'src/a.ts': `export async function f() {\n  const x = 1 + 1;\n  return x;\n}\n` },
      (result) => {
        expect(result.violations.map(site)).toEqual(['src/a.ts:1']);
        expect(result.asyncFunctions).toBe(1);
      }
    );
  });

  it('stays green on an async function annotated Promise<…> with no await', () => {
    // THE TRAP, as an executable statement: this function's INFERRED return
    // type is a Promise in both the flagged case above and here, so a predicate
    // that judged the inferred type would either flag both or flag neither. It
    // is the explicit annotation that separates them.
    withFixtureProgram(
      { 'src/a.ts': `export async function f(): Promise<void> {\n  const x = 1 + 1;\n}\n` },
      (result) => {
        expect(result.violations).toEqual([]);
        expect(result.asyncFunctions).toBe(1);
        expect(result.checked).toBe(1);
      }
    );
  });

  it('stays green when the return expression is thenable, annotated or not', () => {
    // `async (x) => poll(x)` — also gratuitous, also exempt: the rule keys on a
    // thenable return, and 7 of the 21 candidates in this repo are exactly this
    // shape. Without this arm the 14 could be reached by a predicate that is
    // simply blind to thenable returns rather than one that tests for them.
    withFixtureProgram(
      {
        'src/a.ts':
          `declare function poll(x: number): Promise<number>;\n` +
          `export const o = {\n` +
          `  run: async (x: number) => poll(x),\n` +
          `  block: async (x: number) => {\n    const y = x + 1;\n    return poll(y);\n  }\n` +
          `};\n`
      },
      (result) => {
        expect(result.violations).toEqual([]);
        expect(result.asyncFunctions).toBe(2);
      }
    );
  });

  it('does NOT let a nested await excuse the function that encloses it', () => {
    // The boundary the line-window grep got wrong: `inner` has the `await`, and
    // `outer` — which is the async function nothing awaits inside — is still
    // the site. Only `outer` is reported; `inner` is exempt on its own merit.
    withFixtureProgram(
      {
        'src/a.ts':
          `declare function poll(): Promise<void>;\n` +
          `export async function outer() {\n` +
          `  const inner = async () => {\n    await poll();\n  };\n` +
          `  return inner;\n}\n`
      },
      (result) => {
        expect(result.violations.map(site)).toEqual(['src/a.ts:2']);
        expect(result.asyncFunctions).toBe(2);
      }
    );
  });

  it('stays green on an own-body throw, an empty body, a generator and a real await', () => {
    // Each is one of the rule's own exemptions, kept: `async f(){throw}` is
    // deliberate rejection semantics; an empty body has nothing to reorder; a
    // generator is a separate contract; a real `await` is the signal itself.
    withFixtureProgram(
      {
        'src/a.ts':
          `export async function thrown() {\n  throw new Error('nope');\n}\n` +
          `export async function empty() {}\n` +
          `export async function* gen() {\n  yield 1;\n}\n` +
          `declare function poll(): Promise<void>;\n` +
          `export async function awaited() {\n  await poll();\n}\n`
      },
      (result) => {
        expect(result.violations).toEqual([]);
        expect(result.asyncFunctions).toBe(4);
      }
    );
  });

  it('stays green on a body that holds only a comment (empty after parsing)', () => {
    // `{}` and `{ // documented }` are different source and the same parse; the
    // answer has to be the same too.
    withFixtureProgram(
      { 'src/a.ts': `export async function f(): Promise<void> {\n  // documented\n}\n` },
      (result) => expect(result.violations).toEqual([])
    );
  });
});

// ── render: the failure message ──────────────────────────────────────

describe('Scenario: render — the failure message names every site and the two ways out', () => {
  it('names each offending site and says what the reader has to decide', () => {
    const message = describeViolations([
      { file: 'src/services/llm/stub-runner.ts', line: 35 },
      { file: 'src/cli/commands/job-commands.ts', line: 349 }
    ]);
    expect(message).toContain('src/services/llm/stub-runner.ts:35');
    expect(message).toContain('src/cli/commands/job-commands.ts:349');
    expect(message).toContain('Remove the `async`');
    expect(message).toContain('PINNED_SITES');
  });

  it('says nothing at all when there is no violation', () => {
    expect(describeViolations([])).toBe('');
  });
});
