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
//   reach (the anti-weakening arm): the file set, the async-function count and
//            the type-checked count the walk actually consumed are each
//            CROSS-MEASURED against a source outside this traversal, so a walk
//            that returns early, drops a node kind or narrows its root fails
//            HERE instead of passing below. "Proving it can go red" is not
//            enough: a guard that visits nothing also reports nothing.
//   arms (behavior): the contract-less `async` goes red; the `Promise<…>`-
//            annotated one stays green; a nested `await` does NOT excuse its
//            outer function.
//
// WHY THE REACH ARM IS CROSS-MEASURED AND NOT A LITERAL (slice rid-b4)
//
// The reach arm used to be three hand-kept literals: `result.files` (823),
// `result.asyncFunctions` (578) and `result.checked` (577). The file one moved
// four times in four slices (817→818→821→823), each time because a slice added a
// file for a reason the guard had nothing to say about. A literal that must be
// edited on every legitimate change is a tax — but replacing it with a number
// computed by the very traversal it guards would be strictly worse: that guard
// is green forever and means nothing.
//
// The reach arm is therefore THREE measurements from sources that do not read
// back out of the guarded walk, and none needs an edit when the tree grows:
//
//   1. FILE SET — compared, set for set, against `git ls-files` (tracked ∪
//      untracked-not-ignored), because git's index is not this walk's recursion.
//   2. ASYNC-FUNCTION COUNT and TYPE-CHECKED COUNT — compared against a SECOND
//      traversal that shares none of the first's mechanism: an explicit worklist
//      over `node.getChildren()` instead of `forEachChild` recursion.
//   3. COLLAPSE FLOOR — a loose floor tied to the git-reported file count, whose
//      only job is to stop two agreeing-but-EMPTY mechanisms.
//
// The residual assumption is that both mechanisms could be broken TOGETHER (they
// share `isFunctionLikeDeclaration` and `isEmptyBody`). The `injection` describe
// below refuses to leave that unexamined: it drives the real walk through
// deliberately damaged arms and requires the damage to be visible — and requires
// the two mechanisms to then DISAGREE, which is the state the cross-check fails
// on. Because each damage is requested through the same parameter the real walk
// reads, deleting a real arm turns the matching injection into a no-op, and that
// injection case then fails instead of silently agreeing with the damaged walk.
//
// What this does NOT remove: `PINNED_SITES` is still `file:line`, so an unrelated
// edit above one of the 14 sites still moves three entries by hand. That list is a
// deliberate spec pin — the guard's whole point is that a human can read the 14 —
// and it is the one place a line shift is meant to be seen.
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
//
// WHERE THE WALK LIVES. The traversal, its second mechanism, the git
// enumeration and the memoised program are in the bare `.ts` sibling
// `./_gratuitous-async-scan.ts`, extracted there in slice rid-b4 when the new
// reach arm pushed this file to 439 non-comment lines against the repo's 400
// `max-lines` cap and 835 physical lines against the 800-line file cap. The
// extraction moved CODE, not prose: `max-lines` is configured with
// `skipComments: true`, so trimming the explanations here would not have
// changed a single counted line. What stays in THIS file is the part that is a
// claim about this repository — `PINNED_SITES`, the failure message, the fixture
// lifecycle, and the assertions.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  FULL_ARM,
  REPO_ROOT,
  TREES,
  listTsFiles,
  listTsFilesFromGit,
  programForRepo,
  reachRepo,
  repoCompilerOptions,
  scan,
  scanRepo,
  scopedFileNames,
  type Scan,
  type Site
} from './_gratuitous-async-scan.js';

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
 *
 * THE LAST EDIT, AND WHY IT IS NOT THE ONE THIS GUARD WAS SUPPOSED TO STOP NEEDING
 *
 * Slice rid-b4 (2026-09-22): the three `slice-decompose-runners.ts` entries moved
 * 39/89/153 -> 74/127/191, a uniform +35, when Task 1 of that slice replaced the
 * two `JSON.parse(stdout)` sites in that file with `parseJson(stdout, schema)` and
 * the schemas' docblocks were inserted above them. Same three functions, same
 * reasons they are in the class; only the line moved. This is the third reason
 * above, and it is the ONE list whose entries are `file:line` — the reach
 * numbers next to it no longer need a hand edit at all (see the reach arm below).
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
  'src/services/slice/slice-decompose-runners.ts:74',
  'src/services/slice/slice-decompose-runners.ts:127',
  'src/services/slice/slice-decompose-runners.ts:191'
];
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
  // Measured once, from git, and reused by the reach assertions below.
  const filesFromGit = listTsFilesFromGit(REPO_ROOT);

  it('reaches exactly the .ts files git reports under src/ + packages/', () => {
    // Set equality, not a count: a duplicate, a dropped subtree and a narrowed
    // root each break it, and a NEW FILE does not — both sides see it. This is
    // what replaced `expect(result.files).toBe(823)` (817 -> 818 -> 821 -> 823,
    // four hand edits for four slices that each added a file).
    //
    // `scan` skips declaration files before counting, and so does the git
    // enumeration, which is why both sides are the same set rather than the git
    // set minus a number.
    const walked = scopedFileNames(programForRepo(), REPO_ROOT);
    expect(walked).toEqual(filesFromGit);
    // Guard against the degenerate agreement this arm could otherwise hide: an
    // empty enumeration is a set that equals an empty walk.
    expect(walked.length).toBeGreaterThan(0);
  });

  it('reaches every async function-like, as measured by a second, non-recursive walk', () => {
    // The anti-weakening arm. `reachRepo()` comes from `collectAsyncReach`,
    // which uses an explicit worklist over `node.getChildren()` and never
    // recurses with `forEachChild`; a walk that stops early (measured: 349 of
    // 578 survive) or drops the ArrowFunction arm (measured: 412) can no longer
    // agree with it. This is what replaced `expect(result.asyncFunctions)
    // .toBe(578)` / `expect(result.checked).toBe(577)`.
    const reach = reachRepo();
    expect(result.asyncFunctions).toBe(reach.asyncFunctions);
    expect(result.checked).toBe(reach.checked);
  });

  it('reaches a non-collapsed number of async functions (a collapse floor)', () => {
    // A floor, deliberately loose, tied to the INDEPENDENT file enumeration: two
    // mechanisms that agreed on ZERO would satisfy the cross-check above and mean
    // nothing. This cannot detect a subtle drop — the cross-check does that — but
    // it cannot pass a walk that has collapsed to nothing either.
    //
    // The ratio is arbitrary and is not a claim about the tree (measured today
    // it is 578 against a floor of 206); its only job is to be far above zero
    // while staying far below anything a real edit could move.
    expect(result.asyncFunctions).toBeGreaterThanOrEqual(Math.ceil(filesFromGit.length / 4));
    // Structural invariant: `checked` is a SUBSET of `asyncFunctions`, so a
    // counter wired to the wrong branch of the walk breaks here.
    expect(result.checked).toBeGreaterThan(0);
    expect(result.checked).toBeLessThanOrEqual(result.asyncFunctions);
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

// ── injection: damaging the traversal must be visible ────────────────

describe('Scenario: injection — damage to the traversal is visible, not absorbed', () => {
  const full = scanRepo();
  const reach = reachRepo();

  it('loses async functions when the walk does not descend (an early return)', () => {
    // The concrete regression this refuses to leave uncovered: a `visit` that
    // stops after classifying the node it is standing on. Measured on this tree,
    // 349 of the 578 survive.
    const truncated = scanRepo({ ...FULL_ARM, recurse: false });
    expect(truncated.asyncFunctions).toBeLessThan(full.asyncFunctions);
  });

  it('loses async functions when the ArrowFunction arm is dropped', () => {
    // One node kind removed from `isFunctionLikeDeclaration`. Measured: 412 of
    // the 578 survive, i.e. that arm carries 166 of them.
    const withoutArrows = scanRepo({ ...FULL_ARM, arrows: false });
    expect(withoutArrows.asyncFunctions).toBeLessThan(full.asyncFunctions);
  });

  it('makes the two mechanisms DISAGREE, which is the arm that catches it', () => {
    // The two cases above show the damage is real; this one shows the guard
    // NOTICES. `collectAsyncReach` is mechanism 2 and is untouched by `arm`, so a
    // damaged mechanism 1 is exactly the situation the integration cross-check
    // fails on. If a future edit removes an arm from the real walk, the matching
    // injection stops damaging anything and this assertion fails with it.
    const damaged = scanRepo({ ...FULL_ARM, arrows: false });
    expect(damaged.asyncFunctions).not.toBe(reach.asyncFunctions);
  });

  it('leaves the file reach untouched, so the two arms cannot mask each other', () => {
    // The file axis has its own cross-check (against git) and is not routed
    // through `arm`. Stated as a test rather than left implicit: if a later edit
    // made the damage also shrink the file set, this case goes red and says so,
    // instead of the file arm silently absorbing a traversal defect.
    const damaged = scanRepo({ ...FULL_ARM, recurse: false, arrows: false });
    expect(damaged.files).toBe(full.files);
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
