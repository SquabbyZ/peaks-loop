// tests/unit/runtime/no-runtime-input-guard.test.ts
//
// `.peaks/_runtime/` must never be an INPUT of a test.
//
// Why this file exists:
//   `.peaks/_runtime/**` is gitignored, session-scoped and single-use. A test
//   that reads session artifacts out of it is red the moment that session is
//   pruned — and red for a reason that has nothing to do with the product. It
//   is also red on CI by construction, because CI has no session artifacts at
//   all. Six integration tests shipped that way: they pinned
//   `EXISTING_RID`/`EXISTING_SESSION` and
//   `.peaks/_runtime/2026-07-25-session-6da9d9/rd/requests/…`, told the CLI the
//   REPOSITORY was the project root, and so passed only on a machine that still
//   held a July session.
//
// The property, in one sentence:
//   A test may create the runtime state it reads (a tmp project it made
//   itself); it may not consume the repository's own runtime state.
//
// ---------------------------------------------------------------------------
// HOW "DEPENDENCY" IS SEPARATED FROM "MENTION" — the whole design.
//
//   Not by the string. Peaks writes `.peaks/_runtime/<sessionId>/…` while it
//   runs, so that path is all over the test tree as a value a test is asserting
//   ABOUT (an output) or as the tail of a path joined to a directory the test
//   made. What makes a reference a DEPENDENCY is the ROOT it resolves against:
//
//     REPOSITORY ROOT          `__dirname` and anything declared from it
//                              (`const REPO = resolve(__dirname, '../..')`),
//                              plus `process.cwd()` — but ONLY where it is
//                              handed to another process (rules C/D below).
//     A TEST-MADE ROOT         `mkdtempSync(...)`, a `project` parameter,
//                              `process.cwd()` inside a suite that chdir'd into
//                              a tmp workspace. NOT anchored, NOT flagged.
//
//   And not by the ID either. A hardcoded session-id literal is NOT by itself
//   a dependency: `tests/**` legitimately contains dozens of them as INPUTS to
//   pure functions and as labels in tmp projects (measured: 50+ sites, all
//   green, e.g. `tests/unit/skills/caller-first-session-resolution.test.ts`).
//   What makes an id a dependency is being USED TO RESOLVE SESSION STATE FROM
//   THE REPOSITORY — which is what rule C asserts, and what a literal-only rule
//   could never assert without drowning in false positives.
//
// ---------------------------------------------------------------------------
// WHY IT PARSES INSTEAD OF GREPPING
//
//   A line/regex scan cannot tell a path in CODE from the same path in a
//   COMMENT (this repo documents the layout in prose constantly), and it cannot
//   tell `join(project, '.peaks', '_runtime', sid, …)` from a pinned literal.
//   That difference IS the property. So every `tests/**/*.ts` file is parsed
//   with the repo's own `typescript` devDependency and the AST is asked for the
//   property: this is the `guard-verifies-syntax-shape-not-the-property` lesson
//   applied the right way round.
//
// ---------------------------------------------------------------------------
// WHAT THIS GUARD DOES NOT CATCH — read before treating the tree as proven.
// This list is the guard's LIMIT, not a disclaimer. Every item is a live
// rewrite that stays invisible, and each is pinned by a passing test below.
//
//   a. ANCHOR LAUNDERING. `const here = () => process.cwd();` and then
//      `join(here(), '.peaks', '_runtime', sid)` is the same dependency and is
//      not flagged: the anchor set is a closed list of syntactic forms on
//      purpose — a dataflow analysis is a different, much larger tool.
//   b. AN ID SMUGGLED THROUGH A CONTAINER is invisible to a hypothetical
//      id-literal rule (`const SIDS = ['…']; … SIDS[0]`). It is NOT invisible
//      to rule C, which keys on the repo-root anchor rather than on the id —
//      pinned as a test so the difference is not lost.
//   c. A RUNTIME PATH ASSEMBLED FROM PARTS. `'.peaks/' + '_runtime' + …`, or a
//      path read out of a JSON fixture, defeats a path-literal rule.
//   d. `process.cwd()` INSIDE A SUITE THAT CHDIR'd. `tests/unit/_setup/tmp-workspace.ts`
//      chdirs into a tmp dir, so `process.cwd()` at those call sites is a
//      test-made root. Rule B therefore does NOT treat `process.cwd()` as a
//      repository anchor — three `compact-visibility` suites write
//      `join(process.cwd(), '.peaks', '_runtime', …)` and every one of them is
//      creating its own tree. The cost: a direct
//      `readFileSync(join(process.cwd(), '.peaks', '_runtime', …))` in a
//      NON-chdir test is invisible (no live instance). The gain: a rule with
//      zero false positives, which is what keeps this guard from being
//      allowlisted into uselessness.
//   e. AN ARTIFACT READER OUTSIDE `ARTIFACT_READERS`. The set is closed and
//      hand-written: a NEW command that resolves `.peaks/_runtime/<sid>/<role>/…`
//      is invisible here until someone adds it. Rule C is a command-family rule
//      precisely because "does this command touch on-disk session state" is
//      product knowledge, not syntax. Pinned by a limit test using
//      `workflow plan detect-trigger`, which takes `--rid`/`--session-id` and
//      looks identical at the call site but reads no on-disk artifact.
//   f. A READER GIVEN NO `--project`/`--artifact` AT ALL. It inherits the repo
//      root from cwd and rule C has no anchor argument to match. This is the
//      most likely next occurrence of the same defect and it is NOT covered.
//   g. FILES OUTSIDE `tests/**/*.ts`. `scripts/**`, `packages/**`,
//      `examples/**` and non-TypeScript assets are not scanned — including
//      `tests/fixtures/**`, which holds captured markdown naming old sessions.
//      That is data the product reads, not a test asserting on state, so it is
//      out of scope by construction.
//   h. THE REPOSITORY'S COMMITTED STATE. Nothing here constrains tests that
//      read `.peaks/memory/**`, `.peaks/sops/**` or `PROJECT.md`: those are
//      tracked, so depending on them is reproducible. Only the gitignored
//      `_runtime` tree is the subject.
//   i. It says nothing about whether a tmp fixture is REALISTIC. A test can
//      hand-build a shape the product never produces and be green.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const TESTS_ROOT = join(PROJECT_ROOT, 'tests');
/** Rule D's primary reach — the layer where a commander flag becomes an id. */
const SRC_COMMANDS_ROOT = join(PROJECT_ROOT, 'src', 'cli', 'commands');

/** POSIX-normalised path relative to the project root. */
function relativeToRoot(absolutePath: string): string {
  return absolutePath.slice(PROJECT_ROOT.length + 1).split(sep).join('/');
}

/** Every TypeScript file under `tests/`, recursively. `fs`, not a shell (Windows). */
function listTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseSourceFile(absolutePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const collapse = (text: string): string => text.replace(/\s+/g, '');

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * Identifiers in this file whose declaration is derived from the MODULE
 * LOCATION — `const REPO = resolve(__dirname, '../..')`. Those are the names a
 * test uses to mean "the repository", so they anchor exactly like `__dirname`.
 * Collected per file rather than assumed, because the repo spells it `REPO`,
 * `REPO_ROOT` and `PROJECT_ROOT` in different files.
 */
function moduleLocationNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      if (/__dirname|import\.meta/.test(node.initializer.getText(sourceFile))) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

/** `__dirname`, `import.meta.url`, or a file-level constant derived from them. */
function isModuleLocationAnchor(
  node: ts.Node | undefined,
  sourceFile: ts.SourceFile,
  names: ReadonlySet<string>
): boolean {
  if (node === undefined) return false;
  const text = node.getText(sourceFile).trim();
  if (text === '__dirname') return true;
  if (text.startsWith('import.meta')) return true;
  return ts.isIdentifier(node) && names.has(node.text);
}

/** `.peaks` and `_runtime` both named — in one literal or across a path chain. */
const mentionsRuntimeTree = (node: ts.Node, sourceFile: ts.SourceFile): boolean => {
  const text = node.getText(sourceFile);
  return text.includes('.peaks') && text.includes('_runtime');
};

export interface AnchoredRuntimePath {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Rule B — the runtime tree resolved against the MODULE LOCATION, i.e. the
 * repository checkout: `readFileSync(join(__dirname, '..', '..', '.peaks', '_runtime', sid, …))`,
 * `resolve(REPO, '.peaks/_runtime')`, `existsSync(join(REPO_ROOT, …))`.
 *
 * These are the "读产物" and "断言其存在" shapes. The anchor check is what
 * separates them from the legal `join(project, '.peaks', '_runtime', sid)`
 * whose anchor is a tmp dir — and from `process.cwd()` in a chdir'd suite
 * (limit d), which is why `process.cwd()` is not an anchor here.
 */
export function findModuleLocationRuntimePaths(sourceFile: ts.SourceFile): AnchoredRuntimePath[] {
  const names = moduleLocationNames(sourceFile);
  const found: AnchoredRuntimePath[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      mentionsRuntimeTree(node, sourceFile) &&
      node.arguments.some((argument) => isModuleLocationAnchor(argument, sourceFile, names))
    ) {
      found.push({
        file: sourceFile.fileName,
        line: lineOf(sourceFile, node),
        text: collapse(node.getText(sourceFile))
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The command families that RESOLVE role/session artifacts from disk: they read
 * `.peaks/_runtime/<sid>/<role>/requests/…`, or an `--artifact` path inside the
 * project. Pointing one of these at the REPOSITORY root means the test consumes
 * the repository's session state, whatever it asserts afterwards.
 *
 * Closed, hand-written set — see limit (e). It is product knowledge ("which
 * command touches on-disk session state") and cannot be inferred from syntax.
 */
const ARTIFACT_READERS: readonly (readonly [string, string])[] = [
  ['request', 'lint'],
  ['request', 'show'],
  ['request', 'list'],
  ['request', 'repair-status'],
  ['scan', 'diff-vs-scope'],
  ['memory', 'extract']
];

/** Flags whose value is the root the command resolves artifacts against. */
const ROOT_FLAGS: readonly string[] = ['--project', '--artifact'];

export interface RepoRootedArtifactRead {
  readonly file: string;
  readonly line: number;
  readonly command: string;
  readonly flag: string;
  readonly anchor: string;
}

/**
 * `process.cwd()` resolves the repository root in an integration test — the
 * test process runs at the repo root and hands the path to a CHILD process,
 * which cannot have been chdir'd by the tmp-workspace helper. It only counts
 * for a subprocess argument (see limit d for why it must not count for a
 * direct fs call).
 */
const isSubprocessCwdAnchor = (
  node: ts.Node | undefined,
  sourceFile: ts.SourceFile,
  names: ReadonlySet<string>
): boolean => {
  if (node === undefined) return false;
  if (collapse(node.getText(sourceFile)) === 'process.cwd()') return true;
  return isModuleLocationAnchor(node, sourceFile, names);
};

/**
 * Rule C — an artifact-reading command aimed at the repository root.
 *
 * The artifact it resolves is session-scoped and gitignored, so every version
 * of this is a dependency on one machine's leftovers; there is no reproducible
 * form. This is the rule that catches the six defects: the id may be a literal,
 * a constant, or smuggled through a container — the anchor is what is asserted
 * on, so none of those rewrites escapes it (pinned by a test below).
 */
export function findRepoRootedArtifactReads(sourceFile: ts.SourceFile): RepoRootedArtifactRead[] {
  const names = moduleLocationNames(sourceFile);
  const found: RepoRootedArtifactRead[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      if (first === undefined || !ts.isArrayLiteralExpression(first)) {
        ts.forEachChild(node, visit);
        return;
      }
      const elements = first.elements;
      const word = (element: ts.Node | undefined): string | undefined =>
        element !== undefined && ts.isStringLiteral(element) ? element.text : undefined;
      const family = ARTIFACT_READERS.find(([verb, noun]) => word(elements[0]) === verb && word(elements[1]) === noun);
      if (family !== undefined) {
        for (let index = 0; index < elements.length; index += 1) {
          const flag = word(elements[index]);
          if (flag === undefined || !ROOT_FLAGS.includes(flag)) continue;
          const value = elements[index + 1];
          if (isSubprocessCwdAnchor(value, sourceFile, names)) {
            found.push({
              file: sourceFile.fileName,
              line: lineOf(sourceFile, node),
              command: `${family[0]} ${family[1]}`,
              flag,
              anchor: collapse(value?.getText(sourceFile) ?? '')
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

// ===========================================================================
// RULE D — an id joined into the runtime tree must carry a guard.
//
// Added 2026-09-14 (slice `2026-09-14-cli-id-escape-instrumentation`, AC2).
// REWRITTEN 2026-09-14 (repair R1), because two review passes measured that the
// class it claimed to instrument was not closed — one of them running the CLI
// and getting files on disk, the other measuring this rule's own functions on a
// file the rule said was clean. Three things were wrong; all three are stated
// here because "the guard was extended" without the delta is not an instrument.
//
//   THE PREDICATE WAS NAME-BASED. `guardedNames` collected every identifier
//   inside a guard's ARGUMENTS. `REQUEST_ID_PATTERN.test(options.requestId)`
//   therefore marked the NAME `options` guarded, and every `options.<anything>`
//   later in the file read as covered — including
//   `request-artifact-service.ts`'s `join(…'_runtime', options.sessionId, …)`.
//   Measured with this file's own functions on the pre-fix tree: NOT reported,
//   while the repo-wide assertion below was green. Fixed: the guarded entity is
//   the ARGUMENT EXPRESSION (`isGuardedSlot`), never a container name.
//
//   THE SLOT WAS ONE SLOT WIDE. The rule asserted the argument IMMEDIATELY
//   after `'_runtime'` and nothing else, so `join(… sid, 'loop', rid, 'cycles')`
//   had its sid asserted and its rid — the CLI positional — not asserted at
//   all. Fixed: every non-pinned argument at or after `'_runtime'`.
//
//   A JOIN ONE FUNCTION LATER WASN'T A JOIN. `getQaReviewPath` and
//   `getReviewPath` take the guarded directory and join a SECOND id to it; the
//   join carries no `'_runtime'` literal, so the rule never looked. Fixed: a
//   join whose root is a same-file runtime builder is a runtime join
//   (`runtimeBuilderNames`).
//
// The sensitivity control is recorded, not asserted in prose: with the five
// measured escapes pre-fix, this rule reports 16 findings across the scanned set
// and 0 after the repair — same file set (161 files: `src/cli/commands/**/*.ts`
// plus the 11 `MEASURED_ESCAPE_MODULES`), both runs, and the "negative control"
// test below pins each of the five shapes so a future softening fails here.
//
// THE 16 IS A DEFINED QUANTITY, because a count with no definition is not a
// measurement. It is: the number of (join, slot) pairs `findUnguardedRuntimeIdJoins`
// returns when the rule is applied to the `HEAD` bytes of that 161-file set,
// using `runtimeJoinSlots` for the slot definition. 8 of the 16 come from the
// pre-R5 three-module reach, 8 from `src/services/artifacts/**`. Repair R7
// changed the PREDICATE, not the reach, and re-measured this figure at 16.
//
// Why the join and not the flag: the measured class is not "a command forgot to
// check its `--session-id`". It is that each join site RE-DERIVES whether to
// apply the control, so a command's guardedness is uncorrelated with whether
// its id reaches a path. `evidence-generator.ts` and
// `verdict-aggregate-command.ts` guard their sid; their neighbours three files
// over do not. The join is the invariant's home.
//
// Why the guards are a CLOSED set: `isUnsafePathInput` is the canonical control
// (`src/shared/path-safety.ts`), and the peers that are equally sound are
// recognised — `assertSafePathSegment`, the returning `validateSessionId`, and
// the pinned-format predicates `REQUEST_ID_PATTERN` / `SLICE_ID_PATTERN`.
// Recognising them is not a widening: a rule that did not would flag files that
// ARE guarded, and the remedy for a false positive is an allowlist — which is
// how this kind of guard dies.
//
// REACH, stated because a guard whose reach is unstated reads as total:
//   scanned  `src/cli/commands/**/*.ts` (the layer where a flag becomes an id)
//            + `MEASURED_ESCAPE_MODULES`
//   NOT      the service-layer joins whose id comes from the canonical
//            binding / `PEAKS_SESSION_ID` / `session.json` (the job's §4.2 —
//            a different trust class, deferred not cleared), and NOT a join
//            whose ROOT is a local `const` (limit (m), pinned as a test).
//
// REPAIR R5 (2026-09-15) widened the second half of that reach to
// `src/services/artifacts/**` — all eight modules. The reason is the one R1 left
// standing: a scanner that no longer lies about a file it does not SCAN has not
// made that file SAFE. R1 fixed this rule's predicate on
// `request-artifact-service.ts` and then named the file as residue, so the two
// unguarded slots it had just learned to report stayed unguarded in fact —
// measured: `transitionRequestArtifact` with `--session-id ../../../PWNED-R34`
// resolved `.peaks/_runtime/../../../PWNED-R34`, WROTE `state: blocked` to a file
// outside the project root, and only then threw, from `emitObservabilityEvent`'s
// own session-id check. The repair guards the ids at the join
// (`requestArtifactRequestsDir`) instead of at the entry points, which is what
// the "why the join and not the flag" note below already argued for.
//
// The widening cost exactly one finding beyond the calibrated file
// (`artifact-prerequisites.ts:570`, a read-only probe, also repaired), so the
// reach note below is a measurement and not a hope.
//
// Limits (k) and (l) were CLOSED by the rewrite and are recorded so the closure
// is not mistaken for a widening:
//
//   (k) "segments after the id slot are not asserted" — closed. The rid slot in
//       `loop-eval-commands.ts` was the measured escape; `sub-agent-shutdown-
//       commands.ts` guards both its ids and is the shape this now enforces.
//   (l) "a pinned literal in the id slot makes the whole join invisible" — the
//       rule used to produce NO finding for `join(root,'.peaks','_runtime',
//       SESSIONS_DIR, sid)`: not "unguarded" but invisible, numerator and
//       denominator alike. Measured 2026-09-14: 7 such joins in `src/`, of which
//       `playwright-commands.ts:282` was in reach, and a LIVE escape
//       (`playwright stop --terminal ../../../../X` → SIGTERM + unlink outside
//       the project root under `ok: true`) sat one call away from it. Closed:
//       the slot after a pinned slot is asserted now. `findLiteralFirstIdJoins`
//       remains as a census of the shape, not as the rule's blind spot.
//
// Still open, and named so the silence is not read as coverage:
//   * limit (m) — a join whose root is a local `const` alias of a runtime path.
//     One live instance (`slice-integrate-commands.ts:30`, read-only) and it is
//     guarded by hand; the rule does not see it.
//   * the 6 "not scanned" rows of the limit (l) census. Repair R5 replaced this
//     list with the words "unchanged", which took the names out of the artifact
//     while the literal-first test went on asserting they were named here —
//     the same "claim the artifact no longer supports" defect the line exists
//     to remove, in the test layer. Named again, RE-MEASURED by R7 on
//     2026-09-15 with `findLiteralFirstIdJoins` over all of `src/` (7 rows
//     total, 1 in reach, these 6 not scanned):
//       src/services/prd/prd-blocks-checker.ts:62        later=[requestId]
//       src/services/prd/prd-blocks-checker.ts:63        later=[requestId]
//       src/services/session/caller-binding-service.ts:38 later=[callerId]
//       src/services/workflow/artifact-paths.ts:63       later=[sessionId]
//       src/services/workflow/pipeline-verify-gate-support.ts:260 later=[rdEvidenceDir]
//       src/services/workflow/pipeline-verify-gate-support.ts:332 later=[rdEvidenceDir]
//   * `handoff-auto-regen.ts` — a cross-file constructor, invisible to both
//     routes; guarded in fact through `handoffRelativePath`.
//
// REPAIR R7 (2026-09-15) — WHAT IT FIXED, AND WHAT IT DID NOT.
//
// Fixed, and now pinned by fixtures: the predicate read a `BinaryExpression` /
// `ConditionalExpression` as an OR over its branches, so one pinned literal on
// either side cleared the whole slot (`'run-' + sid`, `ok ? sid : 'adhoc'`,
// `rid + '.json'`); and it read a `CallExpression` as
// `arguments.every(isGuardedSlot)` — vacuously TRUE for zero arguments, so
// `currentSid()` and `sid.trim()` cleared. Both are measured defects that QA
// reproduced against this rule and that the pre-R1 predicate reported
// correctly. 4 of QA's 12 attack fixtures were caught before R7, 10 after, and
// the repo-wide assertion above stayed at 0 — so the change is a strict gain in
// sensitivity at zero measured cost.
//
// NOT fixed: the guard set is keyed on EXPRESSION TEXT and is FILE-scoped, so a
// guard in one function clears an identically-spelled slot in another. QA's
// E7/E8 pin it; the live instance is `playwright-commands.ts:282`. R7 measured
// the two available repairs and rejected both, because each trades this hole
// for a worse one:
//   * FUNCTION-SCOPING the guard set catches E7/E8 and takes the attack to
//     12/12, and R7 measured it: 7 findings across 3 live scanned files
//     (`playwright-commands.ts:282`, `verdict-aggregate-command.ts:218/225/238`,
//     `handoff-service.ts:103`). Two of those are not tuning artefacts —
//     `assertSafeHandoffIds` is a GUARD HELPER, so with a text-keyed set the
//     guard's text lives in a different function from every call site BY
//     CONSTRUCTION, and `verdict-aggregate`'s readers take the guarded value as
//     a PARAMETER. The remedy is an allowlist or a `src/` edit at each join,
//     and QA's E7 fixture is SYNTACTICALLY IDENTICAL to the verdict-aggregate
//     case, so no scoping rule can separate them.
//   * ONE-HOP ARGUMENT FLOW (follow the guarded name into the function it is
//     passed to) would separate them, and is a call graph — not an
//     expression-text rule.
//
// And scoping is not sufficient either: R7's AC4 attack measured four residual
// false negatives INSIDE A SINGLE FUNCTION, where scope is not the problem —
// a value reassigned between guard and join, a guard written AFTER the join, a
// guard in a sibling branch, and an id carried on the RECEIVER of a method call
// (`[sid].join('')`). The first three are DOMINATION failures: the guard is in
// scope but does not dominate the join, and no expression-text key can see
// that. So: the rule's green is checked against the shapes it was attacked
// with, and is NOT a soundness proof. Do not read a 0 above as "no unguarded id
// is joined anywhere".
//
// CLOSED by repair R5 (2026-09-15): `src/services/artifacts/**` is IN the reach.
// The residue row that named `request-artifact-service.ts` is retired rather
// than restated, because "reported but not reached" was the whole defect.
// ===========================================================================

const isPinnedName = (node: ts.Node, constants: ReadonlySet<string>): boolean =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  (ts.isIdentifier(node) && constants.has(node.text));

/** A module-level `const X = 'literal'` — a pinned name, not an id. */
export function moduleStringConstants(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

/**
 * The recognised controls, split by the SHAPE of what they guarantee — because
 * the shape decides what counts as guarded, and getting that wrong is the
 * defect this predicate was rewritten for on 2026-09-14 (repair R1).
 *
 *   ID_GUARD_NAMES      take the id itself and refuse it (`isUnsafePathInput`
 *                       returns a predicate; `assertSafePathSegment` throws).
 *                       Their ARGUMENT is the guarded thing, and nothing else.
 *   ID_VALIDATOR_NAMES  return a RECORD carrying the normalised id
 *                       (`const v = validateSessionId(x)`), so `v.field` is
 *                       guarded. Their argument is guarded too — the throwing
 *                       peer in `workspace-service.ts` shares the name.
 *   ID_PATTERN_NAMES    pinned-format controls spelled `X.test(value)`.
 *
 * WHAT CHANGED AND WHY. `guardedNames` collected every IDENTIFIER inside a
 * guard's arguments. So `REQUEST_ID_PATTERN.test(options.requestId)` marked the
 * name `options` guarded, and every later `options.<anything>` in the file —
 * including `join(…'_runtime', options.sessionId, …)` in
 * `request-artifact-service.ts` — read as covered. Measured with this file's own
 * functions before the rewrite: that join was NOT reported while the repo-wide
 * assertion below stayed green. A guard whose coverage claim is broader than its
 * predicate is the whole defect class; the predicate was its last instance.
 *
 * The set is still FILE-scoped, deliberately: `verdict-aggregate-command.ts`
 * guards `rid` once at the action entry and three helpers 100 lines below reuse
 * the name. Tightening to a function scope would score those three as
 * offenders and the remedy for that false positive is an allowlist — which is
 * how this kind of guard dies. What is asserted is the EXPRESSION, not the
 * identifier that happens to appear inside it.
 */
const ID_GUARD_NAMES: readonly string[] = ['isUnsafePathInput', 'assertSafePathSegment'];
const ID_VALIDATOR_NAMES: readonly string[] = ['validateSessionId'];
const ID_PATTERN_NAMES: readonly string[] = ['REQUEST_ID_PATTERN', 'SLICE_ID_PATTERN'];

interface GuardSets {
  /** Exact collapsed texts of expressions a recognised control was applied to. */
  readonly expressions: ReadonlySet<string>;
  /** Identifiers bound to a validator's RESULT — `<root>.<field>` is guarded. */
  readonly validatedRoots: ReadonlySet<string>;
}

function collectGuards(sourceFile: ts.SourceFile): GuardSets {
  const expressions = new Set<string>();
  const validatedRoots = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = collapse(node.expression.getText(sourceFile));
      const named = (guard: string): boolean => callee === guard || callee.endsWith(`.${guard}`);
      const isGuard =
        ID_GUARD_NAMES.some(named) ||
        ID_VALIDATOR_NAMES.some(named) ||
        ID_PATTERN_NAMES.some((pattern) => named(`${pattern}.test`));
      if (isGuard) {
        for (const argument of node.arguments) {
          expressions.add(collapse(argument.getText(sourceFile)));
        }
        if (ID_VALIDATOR_NAMES.some(named)) {
          let parent: ts.Node | undefined = node.parent;
          while (parent !== undefined && ts.isParenthesizedExpression(parent)) parent = parent.parent;
          if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            validatedRoots.add(parent.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { expressions, validatedRoots };
}

export const isJoinCall = (callee: string): boolean => /(^|\.)(join|resolve)$/.test(callee);

/**
 * Is this expression guarded? Expression-shaped, never name-shaped: a guard on
 * `options.requestId` does not clear `options.sessionId`.
 *
 * `pinned` is the file's module-level string constants — a name the product
 * wrote, not a call. A binary or conditional is guarded only when EVERY branch
 * is, so `request-commands.ts`'s `resolvedSessionId ?? 'default'` still clears:
 * the id half is guarded at its own function's entry and the fallback is a
 * pinned literal. The AND is what makes `'run-' + sid` report.
 */
function isGuardedSlot(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  guards: GuardSets,
  constants: ReadonlySet<string>
): boolean {
  if (isPinnedName(node, constants)) return true;
  if (ts.isParenthesizedExpression(node)) return isGuardedSlot(node.expression, sourceFile, guards, constants);
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.every((span) => isGuardedSlot(span.expression, sourceFile, guards, constants));
  }
  // EVERY branch of a binary or conditional carries the id, so EVERY branch
  // must be guarded. Reading this as an OR over the branches is repair R7's
  // first measured defect: one pinned literal on either side made the whole
  // expression "guarded", so `'run-' + sid`, `ok ? sid : 'adhoc'` and a builder
  // call's `rid + '.json'` all cleared while carrying an unchecked id.
  if (ts.isBinaryExpression(node)) {
    return (
      isGuardedSlot(node.left, sourceFile, guards, constants) &&
      isGuardedSlot(node.right, sourceFile, guards, constants)
    );
  }
  if (ts.isConditionalExpression(node)) {
    return (
      isGuardedSlot(node.whenTrue, sourceFile, guards, constants) &&
      isGuardedSlot(node.whenFalse, sourceFile, guards, constants)
    );
  }
  if (ts.isCallExpression(node)) {
    // A call's ID-BEARING parts are its arguments; the receiver is the string
    // being operated on (`rel.replace('<rid>', rid)` — `rel` is a path fragment
    // from a closed list, `rid` is the caller's id).
    //
    // ZERO arguments is NOT "all arguments are guarded": `every()` on an empty
    // list is vacuously true, so `currentSid()` and `sid.trim()` both read as
    // guarded while carrying an unchecked id — repair R7's second measured
    // defect. A call with no arguments is not a guard.
    return (
      node.arguments.length > 0 &&
      node.arguments.every((argument) => isGuardedSlot(argument, sourceFile, guards, constants))
    );
  }
  if (guards.expressions.has(collapse(node.getText(sourceFile)))) return true;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return guards.validatedRoots.has(node.expression.text);
  }
  return false;
}

export interface UnguardedIdJoin {
  readonly file: string;
  readonly line: number;
  readonly segment: string;
}

/**
 * Every id-shaped segment at or after the `'_runtime'` literal, plus the
 * segments of a `join`/`resolve` whose root is built by a same-file runtime
 * constructor one function earlier.
 *
 * LIMIT (m), stated because it is the shape the previous version's limit (l)
 * hid: a join whose ROOT is a local `const` (`const dir = resolve(… '_runtime'
 * …); join(dir, \`${sliceId}.json\`)`) is invisible — the root is an identifier,
 * not a call. Measured 2026-09-14: one live instance, read-only
 * (`slice-integrate-commands.ts:30`), fixed by hand and NAMED here rather than
 * silently covered. Following a `const` one hop is a dataflow step, and the
 * version of it that also follows array elements
 * (`verdict-aggregate-command.ts`'s `candidates` → `join(dir, name)`) would
 * flag a chain whose ids ARE guarded at the source. Recorded, not crossed.
 */
export function findUnguardedRuntimeIdJoins(sourceFile: ts.SourceFile): UnguardedIdJoin[] {
  const constants = moduleStringConstants(sourceFile);
  const guards = collectGuards(sourceFile);
  const builders = runtimeBuilderNames(sourceFile);
  const found: UnguardedIdJoin[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
      const slots = runtimeJoinSlots(node, sourceFile, constants, builders);
      for (const slot of slots) {
        if (!isGuardedSlot(slot, sourceFile, guards, constants)) {
          found.push({
            file: sourceFile.fileName,
            line: lineOf(sourceFile, node),
            segment: collapse(slot.getText(sourceFile))
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The functions in this file that BUILD a runtime path — a returned `join` /
 * `resolve` mentioning `'_runtime'`. `getQaReviewDir` and `getReviewDir` are the
 * measured pair: each guards its sid and hands the root to a caller one function
 * later, where the second id is joined.
 */
export function runtimeBuilderNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      if (containsRuntimeJoin(node.body, sourceFile)) names.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      containsRuntimeJoin(node.initializer, sourceFile)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

function containsRuntimeJoin(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const visit = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && isJoinCall(collapse(n.expression.getText(sourceFile)))) {
      if (n.arguments.some((a) => ts.isStringLiteral(a) && a.text === '_runtime')) return true;
    }
    return ts.forEachChild(n, visit) ?? false;
  };
  return visit(node);
}

/**
 * The slots a runtime join must have guarded. Two routes in:
 *
 *   (a) the join carries the `'_runtime'` literal — the slots are the arguments
 *       AFTER it, pinned literals excluded. This is the widening: the old rule
 *       asserted only the ONE slot immediately after `'_runtime'`, so
 *       `join(root, '.peaks', '_runtime', sid, 'loop', rid, 'cycles')` had its
 *       sid asserted and its rid — the CLI positional — not asserted at all.
 *   (b) the join has no `'_runtime'` literal but its root is a same-file
 *       runtime constructor — the slots are the arguments OTHER than that
 *       constructor, which IS the root.
 */
/** Exported for the AC4 enumeration probe: the repo-wide census must use the
 *  same slot definition the assertion uses, or the two disagree. */
export function runtimeJoinSlots(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  constants: ReadonlySet<string>,
  builders: ReadonlySet<string>
): ts.Node[] {
  const args = call.arguments;
  const runtimeAt = args.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
  const assertable = (node: ts.Node | undefined): node is ts.Node =>
    node !== undefined && !isPinnedName(node, constants);

  if (runtimeAt >= 0) return args.slice(runtimeAt + 1).filter(assertable);

  const builderArg = args.find(
    (a) => ts.isCallExpression(a) && ts.isIdentifier(a.expression) && builders.has(a.expression.text)
  );
  if (builderArg !== undefined) return args.filter((a) => a !== builderArg && assertable(a));

  return [];
}

/**
 * The census of joins whose id slot is a PINNED literal while a LATER argument
 * carries something that is not.
 *
 * This WAS limit (l) — the shape rule D returned nothing for, numerator and
 * denominator alike, so the rule read as having looked and found nothing. On
 * 2026-09-14 a LIVE ESCAPE sat behind exactly this shape
 * (`playwright-commands.ts`: the `'_runtime'` literal is inside
 * `playwrightSessionsDir()`, whose slot is the pinned `PLAYWRIGHT_SESSIONS_DIR`;
 * the caller-supplied terminal id is joined in a SECOND call,
 * `sessionFilePath()`, which contains no `_runtime` literal at all).
 *
 * Repair R1 closed the limit: the slot after a pinned slot IS asserted now, so
 * `playwright-commands.ts:282`'s `terminalId` is IN the numerator. What R1 did
 * not check is whether the assertion MEANS anything there, and repair R7
 * measured that it does not:
 *
 *   Delete the `isUnsafePathInput(terminalId)` block from `sessionFilePath`
 *   (source text, in memory; the file on disk verified unchanged) and the rule
 *   reports `:279 joins terminalId` — the same slot, three lines up — plus
 *   `:71`. Clean tree: 0 findings. The ONLY thing keeping `:282` green is a
 *   guard 210 lines away in a DIFFERENT function, on a different binding that
 *   happens to share the name. So the sentence R1 wrote here — that `:282`'s
 *   `terminalId` "is required to be guarded" — was false when it was written:
 *   the rule passes it silently. It is safe IN FACT (`deriveTerminalId`
 *   sanitises, and `opts.terminal` is guarded upstream), so this is a latent
 *   false negative, not a live escape. Repair R7 did NOT close it; see the
 *   limit note below for why, and for the measurement that makes it a
 *   decision rather than a bug.
 *
 * Measured 2026-09-15 (R7, re-run rather than restated): 1 such join in rule
 * D's reach (`playwright-commands.ts` `join(…, 'playwright-userdata',
 * terminalId)`) and 7 in the whole of `src/`. The 6 outside this reach are NOT
 * scanned and are NAMED in the reach note above; a repo-wide census is
 * `probe-src-joins.mjs`'s job, not this file's.
 */
export interface LiteralFirstIdJoin {
  readonly file: string;
  readonly line: number;
  /** The pinned literal / module constant written in the slot after `'_runtime'`. */
  readonly pinned: string;
  /** Identifier names appearing in the segments AFTER that slot. */
  readonly later: readonly string[];
}

export function findLiteralFirstIdJoins(sourceFile: ts.SourceFile): LiteralFirstIdJoin[] {
  const constants = moduleStringConstants(sourceFile);
  const found: LiteralFirstIdJoin[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
      const args = node.arguments;
      const runtimeAt = args.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
      const segment = runtimeAt >= 0 ? args[runtimeAt + 1] : undefined;
      if (segment !== undefined && isPinnedName(segment, constants)) {
        const later = args.slice(runtimeAt + 2).filter((a) => !isPinnedName(a, constants));
        if (later.length > 0) {
          const names = new Set<string>();
          for (const argument of later) {
            const collect = (n: ts.Node): void => {
              if (ts.isIdentifier(n)) names.add(n.text);
              ts.forEachChild(n, collect);
            };
            collect(argument);
          }
          found.push({
            file: sourceFile.fileName,
            line: lineOf(sourceFile, node),
            pinned: collapse(segment.getText(sourceFile)),
            later: [...names]
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The second half of rule D's reach. `src/cli/commands/**` is the layer where a
 * commander flag becomes an id; these service modules are where an id->path
 * escape was MEASURED (`qa-business-review-state.ts`, `slice-review-state.ts` —
 * RD sweep cases A17/A26; `handoff-service.ts` — security audit F2 of
 * `2026-09-14-cli-id-escape-instrumentation`, the site `0536d5bd` INTRODUCED
 * while instrumenting this class and could not see, because the module was
 * outside the scanned layer). A NEW measured escape adds its module here
 * together with its guard. The set only grows, and a test pins its contents.
 *
 * `handoff-auto-regen.ts` is deliberately NOT here and is the named residue:
 * its join is `join(root, handoffRelativePath(sid, rid))` — no `'_runtime'`
 * literal, and the constructor is imported rather than same-file, so neither
 * route reaches it. It is guarded in fact, through that constructor.
 *
 * Repair R5 added all eight `src/services/artifacts/**` modules, not just the
 * calibrated one. A one-file reach would have re-created the defect R1 left:
 * the surface a caller is routed THROUGH is the surface an id escapes through,
 * and `artifact-prerequisites.ts` — reached from `transitionRequestArtifact`
 * one call after the join — turned out to hold the second instance of the same
 * shape. Measured pre-fix, this list produced 8 findings; post-fix, 0.
 */
const MEASURED_ESCAPE_MODULES: readonly string[] = [
  'src/services/qa/qa-business-review-state.ts',
  'src/services/slice/slice-review-state.ts',
  'src/services/prd/handoff-service.ts',
  'src/services/artifacts/artifact-lint-service.ts',
  'src/services/artifacts/artifact-prerequisites.ts',
  'src/services/artifacts/artifact-service.ts',
  'src/services/artifacts/artifact-templates.ts',
  'src/services/artifacts/repair-cycle-service.ts',
  'src/services/artifacts/request-artifact-service.ts',
  'src/services/artifacts/request-artifact-state-helpers.ts',
  'src/services/artifacts/workspace-service.ts'
];

/**
 * The 6 limit-(l) rows OUTSIDE rule D's reach — named in the reach note above
 * and re-measured by repair R7 on 2026-09-15 with `findLiteralFirstIdJoins`
 * over all of `src/` (7 rows total; the 7th is the in-reach one the test above
 * pins). Held here as data, not as prose, so the note's claim that these rows
 * are named is checked against the files rather than asserted in a comment.
 */
const NOT_SCANNED_LITERAL_FIRST: readonly {
  readonly file: string;
  readonly line: number;
  readonly pinned: string;
  readonly later: string;
}[] = [
  { file: 'src/services/prd/prd-blocks-checker.ts', line: 62, pinned: 'prd', later: 'requestId' },
  { file: 'src/services/prd/prd-blocks-checker.ts', line: 63, pinned: 'change', later: 'requestId' },
  { file: 'src/services/session/caller-binding-service.ts', line: 38, pinned: 'callers', later: 'callerId' },
  { file: 'src/services/workflow/artifact-paths.ts', line: 63, pinned: 'change', later: 'sessionId' },
  {
    file: 'src/services/workflow/pipeline-verify-gate-support.ts',
    line: 260,
    pinned: 'change',
    later: 'rdEvidenceDir'
  },
  {
    file: 'src/services/workflow/pipeline-verify-gate-support.ts',
    line: 332,
    pinned: 'change',
    later: 'rdEvidenceDir'
  }
];

interface ScanResult {
  readonly scannedFiles: number;
  readonly anchoredPaths: readonly AnchoredRuntimePath[];
  readonly repoRootedReads: readonly RepoRootedArtifactRead[];
}

function scanProject(): ScanResult {
  const files = listTestFiles(TESTS_ROOT);
  const anchoredPaths: AnchoredRuntimePath[] = [];
  const repoRootedReads: RepoRootedArtifactRead[] = [];
  for (const absolutePath of files) {
    // This is the one file in the tree that must be able to NAME a violating
    // fixture in order to test the rules against it. Its fixtures are ASSEMBLED
    // at runtime (`['2026','07','25'].join('-')`) rather than written as
    // literals, so it does not trip the rules it defines and needs no
    // self-exemption — an exemption by name would reopen exactly the hole this
    // guard exists to close.
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    anchoredPaths.push(...findModuleLocationRuntimePaths(sourceFile));
    repoRootedReads.push(...findRepoRootedArtifactReads(sourceFile));
  }
  return { scannedFiles: files.length, anchoredPaths, repoRootedReads };
}

interface SrcScanResult {
  readonly scannedFiles: readonly string[];
  readonly unguardedIdJoins: readonly UnguardedIdJoin[];
  readonly idJoinSites: number;
  readonly literalFirstJoins: readonly LiteralFirstIdJoin[];
}

function scanSourceLayer(): SrcScanResult {
  const files = [
    ...listTestFiles(SRC_COMMANDS_ROOT),
    ...MEASURED_ESCAPE_MODULES.map((rel) => join(PROJECT_ROOT, rel))
  ];
  const unguardedIdJoins: UnguardedIdJoin[] = [];
  const literalFirstJoins: LiteralFirstIdJoin[] = [];
  let idJoinSites = 0;
  for (const absolutePath of files) {
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    unguardedIdJoins.push(...findUnguardedRuntimeIdJoins(sourceFile));
    literalFirstJoins.push(...findLiteralFirstIdJoins(sourceFile));
    // Every asserted slot of every recognised runtime join, guarded or not: the
    // denominator the hit count is reported against. Counted by the SAME
    // `runtimeJoinSlots` the finder uses, so the two cannot drift into a
    // numerator the denominator does not describe.
    const constants = moduleStringConstants(sourceFile);
    const builders = runtimeBuilderNames(sourceFile);
    const countIdSlots = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
        idJoinSites += runtimeJoinSlots(node, sourceFile, constants, builders).length;
      }
      ts.forEachChild(node, countIdSlots);
    };
    ts.forEachChild(sourceFile, countIdSlots);
  }
  return { scannedFiles: files, unguardedIdJoins, idJoinSites, literalFirstJoins };
}

const SCAN = scanProject();
const SRC_SCAN = scanSourceLayer();

const where = (file: string, line: number): string => `${relativeToRoot(file)}:${line}`;

describe('`.peaks/_runtime` is never a test input (slice 2026-09-13)', () => {
  it('parses a real part of the tree (anti-silence: a broken scanner must not pass)', () => {
    // A scanner that walked nothing, or that stopped recognising anchors, would
    // make every assertion below vacuously green. Pin the walk, the artifact
    // reader set, and both anchor mechanisms against fixtures that MUST hit.
    expect(SCAN.scannedFiles).toBeGreaterThan(100);
    expect(ARTIFACT_READERS.length).toBeGreaterThan(0);
    const withAnchor = [
      `const REPO = resolve(__dirname, '../..');`,
      `const p = join(REPO, '.peaks', '_runtime', sid);`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', withAnchor))).toHaveLength(1);
    expect(
      findRepoRootedArtifactReads(
        parseSourceFile(
          'fixture.ts',
          `runCli(['request', 'show', 'x', '--project', process.cwd(), '--json'], process.cwd());`
        )
      )
    ).toHaveLength(1);
  });

  it('no test resolves the runtime tree against the module location', () => {
    const offenders = SCAN.anchoredPaths.map((hit) => `${where(hit.file, hit.line)} ${hit.text}`);
    expect(offenders).toEqual([]);
  });

  it('no artifact-reading command is aimed at the repository root', () => {
    const offenders = SCAN.repoRootedReads.map(
      (hit) => `${where(hit.file, hit.line)} \`peaks ${hit.command}\` resolves via ${hit.flag} ${hit.anchor}`
    );
    expect(offenders).toEqual([]);
  });
});

describe('rule D — an id joined into the runtime tree carries a guard (slice 2026-09-14)', () => {
  it('parses a real part of the command layer (anti-silence)', () => {
    // Rule D's off-switch is silence: if the walk stops finding files, or the
    // join recogniser stops recognising joins, every assertion below is
    // vacuously green. Pin both against the live tree and against a fixture
    // that MUST be counted.
    expect(SRC_SCAN.scannedFiles.length).toBeGreaterThan(50);
    expect(SRC_SCAN.idJoinSites).toBeGreaterThan(0);
    expect(MEASURED_ESCAPE_MODULES.length).toBeGreaterThan(0);
    for (const rel of MEASURED_ESCAPE_MODULES) {
      expect(existsSync(join(PROJECT_ROOT, rel))).toBe(true);
    }
  });

  it('no unguarded id is joined into the runtime tree', () => {
    const offenders = SRC_SCAN.unguardedIdJoins.map(
      (hit) => `${relativeToRoot(hit.file)}:${hit.line} joins ${hit.segment} after '_runtime' with no guard in the file`
    );
    expect(offenders).toEqual([]);
  });

  it('catches the measured escapes this rule was written for, and spares the guarded forms', () => {
    const BAD = [
      `const sid = opts.sessionId ?? 'ad-hoc';`,
      `const dir = join(projectRoot, '.peaks', '_runtime', sid, 'slice-reviews');`,
      `mkdirSync(dir, { recursive: true });`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', BAD)).map((h) => h.line)).toEqual([2]);

    // A guard anywhere in the file is enough — `verdict-aggregate-command.ts`
    // guards `sid` once at the action entry and three helpers 100 lines below
    // reuse it. A function-scoped rule would score those three as offenders.
    const GUARDED = [
      `function read(projectRoot: string, sid: string) {`,
      `  return join(projectRoot, '.peaks', '_runtime', sid, 'audit');`,
      `}`,
      `function action(opts: any) {`,
      `  const sid = opts.sid ?? 'default';`,
      `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
      `  return read(opts.project, sid);`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', GUARDED))).toEqual([]);

    // A PINNED NAME is not an id: `join(root, '.peaks', '_runtime', 'playwright-sessions')`
    // is a fixed directory, and flagging it would force a guard whose only
    // effect is to reject a literal the product wrote itself.
    const PINNED = [
      `const SESSIONS_DIR = 'playwright-sessions';`,
      `export const sessionsDir = (root: string) => join(root, '.peaks', '_runtime', SESSIONS_DIR);`,
      `export const fixed = (root: string) => join(root, '.peaks', '_runtime', 'fixtures');`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', PINNED))).toEqual([]);

    // `validateSessionId` throws and is a peer of `isUnsafePathInput`; a rule
    // that did not recognise it would flag a file that IS guarded, and the
    // remedy for a false positive is an allowlist — which is how this kind of
    // guard dies.
    const VALIDATED = [
      `function run(opts: any) {`,
      `  const v = validateSessionId(opts.sessionId);`,
      `  return join(opts.project, '.peaks', '_runtime', v.sessionId, 'audit-goal');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', VALIDATED))).toEqual([]);
  });

  it('pins rule D\'s reach, so it is not read as covering the service layer', () => {
    // The ~75 service-layer joins whose id comes from the canonical binding are
    // the job's §4.2 — a different trust class, deferred not cleared. They are
    // NOT scanned, and this test is the statement of that bound rather than a
    // comment someone can miss.
    expect(SRC_SCAN.scannedFiles.some((f) => relativeToRoot(f) === 'src/services/loop/loop-store.ts')).toBe(false);
    // …and the surface repair R5 added is scanned rather than merely listed, so
    // a future edit that drops it from `MEASURED_ESCAPE_MODULES` fails here
    // instead of quietly restoring the file-outside-the-reach defect.
    expect(
      SRC_SCAN.scannedFiles.some((f) => relativeToRoot(f) === 'src/services/artifacts/request-artifact-service.ts')
    ).toBe(true);
    // …while the modules rule D DOES cover are the command layer plus the
    // measured-escape set, and nothing else.
    expect(SRC_SCAN.scannedFiles.every((f) => {
      const rel = relativeToRoot(f);
      return rel.startsWith('src/cli/commands/') || MEASURED_ESCAPE_MODULES.includes(rel);
    })).toBe(true);
  });

  it('segments AFTER the id slot ARE asserted (was limit (k), closed 2026-09-14)', () => {
    // `join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, F)` has two
    // caller-supplied segments. The rule used to assert only the first — the one
    // immediately after `'_runtime'` — and this test PINNED that as a limit.
    // Repair R1 measured the cost of the limit: `loop-eval-commands.ts`'s
    // `join(… sid, 'loop', rid, 'cycles')` guarded `sid` and left `rid`, the CLI
    // positional, open; `peaks loop eval '../../../../…/EVILCYC' --capture-score`
    // created a directory outside the project root under `ok: true`.
    //
    // Both segments are asserted now. `sub-agent-shutdown-commands.ts` guards
    // both (`:49`/`:52`) and is the shape the fix copies.
    const fixture =
      `const p = join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, 'x.json');`;
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', fixture)).map((h) => h.segment)).toEqual([
      'sid',
      'dispatchId'
    ]);
    const guarded = [
      `function f(root: string, sid: string, dispatchId: string) {`,
      `  if (isUnsafePathInput(sid)) throw new Error('bad sid');`,
      `  if (isUnsafePathInput(dispatchId)) throw new Error('bad dispatch');`,
      `  return join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, 'x.json');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', guarded))).toEqual([]);
  });

  it('a pinned literal in the FIRST id slot no longer hides a later id (was limit (l))', () => {
    // The rule used to return nothing for the whole join when the slot after
    // `'_runtime'` was a pinned literal: not "guarded" and not "unguarded" —
    // INVISIBLE, numerator and denominator alike. On 2026-09-14 a live escape sat
    // one call away from exactly this shape. Two things changed in repair R1:
    // the later id is asserted, and the census below still names the shape.
    const fixture = [
      `const SESSIONS_DIR = 'playwright-sessions';`,
      `export const dir = (root: string, sid: string) =>`,
      `  join(root, '.peaks', '_runtime', SESSIONS_DIR, sid, 'x.json');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findUnguardedRuntimeIdJoins(parsed).map((h) => h.segment)).toEqual(['sid']);
    expect(findLiteralFirstIdJoins(parsed).map((h) => `${h.line}:${h.pinned}:[${h.later.join(',')}]`)).toEqual([
      '3:SESSIONS_DIR:[sid]'
    ]);
  });

  it('negative control — the five escapes of repair R1 are all detected', () => {
    // Each fixture is the PRE-FIX source shape of a site the security audit of
    // `2026-09-14-cli-id-escape-instrumentation` measured with a live CLI write
    // outside the project root under `ok: true`. Pinning them here is the
    // difference between an instrument and a description: if a future edit
    // softens the predicate or the slot rule, these fail.
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      // The predicate fix, in one fixture — and the sharpest form of the AC3
      // sensitivity control. `REQUEST_ID_PATTERN.test(options.requestId)` is a
      // guard on the EXPRESSION `options.requestId`. Under the old name-based
      // predicate it marked the NAME `options` guarded and thereby cleared the
      // whole join below: measured on `request-artifact-service.ts:431`, which
      // this rule reported as NOTHING while the repo-wide assertion stayed
      // green. Under the expression predicate the same join reports BOTH of its
      // unguarded id slots, which is the true answer.
      //
      // `options.role` is included deliberately: in the live file that segment
      // is a role name, and no guard covered it either. Repair R5 did NOT widen
      // the predicate to recognise `VALID_ROLES.has(...)` — a file-scoped
      // guard-set change would alter every scanned file to silence one slot.
      // The role is guarded at the join instead. The fixture is unchanged, so a
      // future softening of the expression predicate still fails here.
      [
        'guard on `options.requestId` must not clear `options.sessionId`',
        [
          `function find(options: any) {`,
          `  if (!REQUEST_ID_PATTERN.test(options.requestId)) throw new Error('bad rid');`,
          `  const dir = join(options.projectRoot, '.peaks', '_runtime', options.sessionId, options.role, 'requests');`,
          `  return dir;`,
          `}`
        ].join('\n'),
        ['options.sessionId', 'options.role']
      ],
      // qa-business-review-state.ts:74-76. The sid is guarded one function
      // earlier, which is why the sid-only reader called this file covered.
      [
        '`getQaReviewPath` joins a second id one function after the guarded dir',
        [
          `function getQaReviewDir(projectRoot: string, sessionId: string): string {`,
          `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
          `  return resolve(projectRoot, '.peaks', '_runtime', sessionId, 'qa-business-reviews');`,
          `}`,
          `function getQaReviewPath(projectRoot: string, sessionId: string, requestId: string): string {`,
          `  return join(getQaReviewDir(projectRoot, sessionId), \`\${requestId}.json\`);`,
          `}`
        ].join('\n'),
        ['`${requestId}.json`']
      ],
      // slice-review-state.ts:80 — the identical shape on the slice-id axis.
      [
        '`getReviewPath` joins a second id one function after the guarded dir',
        [
          `function getReviewDir(projectRoot: string, sessionId: string): string {`,
          `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
          `  return resolve(projectRoot, '.peaks', '_runtime', sessionId, 'slice-reviews');`,
          `}`,
          `function getReviewPath(projectRoot: string, sessionId: string, sliceId: string): string {`,
          `  return join(getReviewDir(projectRoot, sessionId), \`\${sliceId}.json\`);`,
          `}`
        ].join('\n'),
        ['`${sliceId}.json`']
      ],
      // loop-eval-commands.ts:229 — TWO ids in one join, the first guarded.
      [
        'a guarded first id does not clear a later id in the same join',
        [
          `function write(projectRoot: string, options: any, rid: string) {`,
          `  if (isUnsafePathInput(options.session)) throw new Error('bad sid');`,
          `  const dir = join(projectRoot, '.peaks', '_runtime', options.session, 'loop', rid, 'cycles');`,
          `  mkdirSync(dir, { recursive: true });`,
          `}`
        ].join('\n'),
        ['rid']
      ],
      // handoff-service.ts:63-65, added by the commit that instrumented this
      // class. BOTH ids are caller-supplied, so both are asserted.
      [
        'an unguarded two-id join reports BOTH ids, not the first',
        [
          `export function handoffRelativePath(sessionId: string, requestId: string): string {`,
          `  return join('.peaks', '_runtime', sessionId, 'prd', \`handoff-\${requestId}.md\`);`,
          `}`
        ].join('\n'),
        ['sessionId', '`handoff-${requestId}.md`']
      ]
    ];

    for (const [name, source, expected] of cases) {
      expect(
        findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', source)).map((h) => h.segment),
        name
      ).toEqual(expected);
    }
  });

  it('negative control — a guard at the CALLER does not reach the builder (repair R5)', () => {
    // AC4's ruling, pinned. The measured defect was not "one unguarded
    // function": `createRequestArtifact` guarded its session id and its sibling
    // `transitionRequestArtifact` did not — and the sibling performs NO join of
    // its own (it delegates the path to `showRequestArtifact`), so a rule that
    // asserted entry points would have had nothing to assert on. What both end
    // at is one join, and that is where the guard belongs.
    //
    // The fixture makes the consequence visible: a guard written on the caller's
    // expression (`options.sessionId`) does not clear the builder's PARAMETER
    // (`sessionId`), because the predicate is expression-shaped. A guard at the
    // caller therefore cannot make the shared builder safe — only a guard inside
    // it can, which is what `requestArtifactRequestsDir` now carries.
    const callerOnlyGuard = [
      `function createRequestArtifact(options: any, sessionId: string, role: string) {`,
      `  if (isUnsafePathInput(options.sessionId)) throw new Error('bad sid');`,
      `  return requestArtifactRequestsDir(options.projectRoot, sessionId, role);`,
      `}`,
      `function requestArtifactRequestsDir(projectRoot: string, sessionId: string, role: string) {`,
      `  return join(projectRoot, '.peaks', '_runtime', sessionId, role, 'requests');`,
      `}`
    ].join('\n');
    expect(
      findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', callerOnlyGuard)).map((h) => h.segment)
    ).toEqual(['sessionId', 'role']);

    const guardInBuilder = [
      `function createRequestArtifact(options: any, sessionId: string, role: string) {`,
      `  return requestArtifactRequestsDir(options.projectRoot, sessionId, role);`,
      `}`,
      `function requestArtifactRequestsDir(projectRoot: string, sessionId: string, role: string) {`,
      `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
      `  if (isUnsafePathInput(role)) throw new Error('bad role');`,
      `  return join(projectRoot, '.peaks', '_runtime', sessionId, role, 'requests');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', guardInBuilder))).toEqual([]);
  });

  it('negative control — QA\'s shape attack: the 10 catchable shapes are caught (repair R7)', () => {
    // Repair R7's AC1/AC3. Every fixture below is a PRE-FIX source shape that
    // the shipped predicate CLEARED while carrying an unchecked id. They are
    // here, and not merely in a session-scoped probe, because R1's sensitivity
    // control passed on the sites it already knew about and that is exactly why
    // this regression shipped.
    //
    // The pre-R1 name-based predicate reported 8 of QA's 12; the R1 predicate
    // reported 4. Six of the eight misses were the two defects fixed here:
    //   * `BinaryExpression` / `ConditionalExpression` read as an OR over the
    //     branches, so ONE pinned literal on either side cleared the slot.
    //   * `CallExpression` read as `arguments.every(...)`, vacuously TRUE for
    //     zero arguments.
    // Measured: 4/12 caught before, 10/12 after, repo-wide assertion still 0.
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      [
        'literal-prefixed concatenation clears an id',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', 'run-' + sid, 'x');`,
          `}`
        ].join('\n'),
        [`'run-'+sid`]
      ],
      [
        'nullish-coalesce with a pinned fallback does not clear the id half',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', sid ?? 'default', 'x');`,
          `}`
        ].join('\n'),
        [`sid??'default'`]
      ],
      [
        'conditional with a literal branch clears an id',
        [
          `function f(root: string, sid: string, ok: boolean) {`,
          `  return join(root, '.peaks', '_runtime', ok ? sid : 'adhoc', 'x');`,
          `}`
        ].join('\n'),
        [`ok?sid:'adhoc'`]
      ],
      [
        'a zero-argument call in the id slot is not a guard (vacuous `every`)',
        [
          `function f(root: string) {`,
          `  return join(root, '.peaks', '_runtime', currentSid(), 'x');`,
          `}`
        ].join('\n'),
        ['currentSid()']
      ],
      [
        'a zero-argument METHOD call in the id slot is not a guard',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', sid.trim(), 'x');`,
          `}`
        ].join('\n'),
        ['sid.trim()']
      ],
      [
        'a second id joined to a builder one function later is reported',
        [
          `function runtimeDir(root: string, sid: string) {`,
          `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
          `  return resolve(root, '.peaks', '_runtime', sid, 'reviews');`,
          `}`,
          `function reviewPath(root: string, sid: string, rid: string) {`,
          `  return join(runtimeDir(root, sid), rid + '.json');`,
          `}`
        ].join('\n'),
        [`rid+'.json'`]
      ]
    ];
    for (const [name, source, expected] of cases) {
      expect(
        findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', source)).map((h) => h.segment),
        name
      ).toEqual(expected);
    }

    // The other four fixtures of the 12 — E1 baseline, E9, E10, E11 — were
    // ALREADY caught and are pinned by the tests above (the two-slot case, the
    // template literal, and the spread), so they are not restated here.
    //
    // AND the counterweight, without which the two fixes above are a rule that
    // reports everything: a live site whose `??` fallback is a pinned literal
    // and whose id half IS guarded at its own function's entry must stay GREEN.
    // `request-commands.ts:372` is that site; this is its shape.
    const liveShaped =
      [
        `function action(root: string, sid: string | undefined) {`,
        `  let resolvedSessionId = sid;`,
        `  if (resolvedSessionId !== undefined && isUnsafePathInput(resolvedSessionId)) {`,
        `    throw new Error('bad sid');`,
        `  }`,
        `  return join(root, '.peaks', '_runtime', resolvedSessionId ?? 'default');`,
        `}`
      ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', liveShaped))).toEqual([]);
  });

  it('limit (n): a guard clears a slot by FILE-scoped expression text, not by scope or domination', () => {
    // REPAIR R7 DID NOT CLOSE THIS, and this test is the statement of that —
    // a passing test, not a disclaimer, so the residue cannot be mistaken for
    // coverage. Four shapes are missed; the first two are QA's E7/E8, the rest
    // are R7's AC4 extension. Each was attacked against the shipped rule and
    // each clears.
    //
    // (1) A guard in a DIFFERENT FUNCTION with a same-named binding. This is
    //     the live `playwright-commands.ts:282` shape: deleting the guard from
    //     `sessionFilePath` (a different function) makes the rule report that
    //     join, which is how we know the guard, not the rule, was clearing it.
    //     This is also the fixture QA wrote as E7.
    //
    // (2) A guard AFTER the join, (3) a value REASSIGNED between the guard and
    //     the join, and (4) an id on the RECEIVER of a method call — which
    //     `isGuardedSlot` never walks, since it asks about a call's ARGUMENTS
    //     only. R7's AC4 extension found these; (2) and (3) are DOMINATION
    //     failures, so no scoping rule reaches them either: the guard is in the
    //     join's own function and still does not govern it.
    const missed: ReadonlyArray<readonly [string, string]> = [
      [
        'guard in a sibling function with a same-named binding',
        [
          `function a(sid: string) {`,
          `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
          `  return sid;`,
          `}`,
          `function b(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', sid, 'x');`,
          `}`
        ].join('\n')
      ],
      [
        'guard written AFTER the join (does not dominate it)',
        [
          `function f(root: string, sid: string) {`,
          `  const p = join(root, '.peaks', '_runtime', sid, 'x');`,
          `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
          `  return p;`,
          `}`
        ].join('\n')
      ],
      [
        'value reassigned between the guard and the join',
        [
          `function f(root: string, sid: string, other: string) {`,
          `  let id = sid;`,
          `  if (isUnsafePathInput(id)) throw new Error('bad');`,
          `  id = other;`,
          `  return join(root, '.peaks', '_runtime', id, 'x');`,
          `}`
        ].join('\n')
      ],
      [
        'id carried on the RECEIVER of a method call',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', [sid].join(''), 'x');`,
          `}`
        ].join('\n')
      ]
    ];
    for (const [name, source] of missed) {
      expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', source)), name).toEqual([]);
    }

    // (1) and (2) are the reason a FUNCTION-SCOPED guard set was measured and
    // rejected, not merely unconsidered: scoping closes (1) and takes the
    // 12-fixture attack to 12/12, but it reports 7 findings across 3 live
    // scanned files, because a guard HELPER (`assertSafeHandoffIds`) puts the
    // guard's text in a different function from every call site by
    // construction, and `verdict-aggregate-command.ts`'s readers take the
    // guarded value as a parameter — syntactically identical to fixture (1).
    // See the reach note for the full measurement. (2) and (3) remain after
    // any scoping rule, because scope is not domination.
  });

  it('limit (m): a join whose ROOT is a local const is still invisible', () => {
    // Stated as a passing test because it is the shape limit (l) used to hide,
    // one level down. `slice-integrate-commands.ts:30` is the live instance
    // (`const dir = resolve(… '_runtime' …); join(dir, \`${sliceId}.json\`)`); it
    // is guarded by hand and named in AC4's residue rather than covered here.
    // Following the const is a dataflow step, and the version of it that also
    // follows ARRAY elements would flag `verdict-aggregate-command.ts`'s
    // `candidates` → `join(dir, name)`, whose ids ARE guarded at the source.
    const fixture = [
      `function load(projectRoot: string, sessionId: string, sliceId: string) {`,
      `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
      `  const dir = resolve(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');`,
      `  return join(dir, \`\${sliceId}.json\`);`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('pins the literal-first census inside the rule\'s reach (measurement, not assurance)', () => {
    // Every join in the scanned layer that rule D cannot see. A NEW one fails
    // here — that is the point: the shape that hid a live escape must announce
    // itself, not wait to be noticed. Measured 2026-09-15: 7 in the whole of
    // `src/`, of which this is the only one in reach (the other 6 are named in
    // the reach note and are NOT scanned).
    expect(
      SRC_SCAN.literalFirstJoins.map((h) => `${relativeToRoot(h.file)}:${h.line} pinned=${h.pinned} later=[${h.later.join(',')}]`)
    ).toEqual([
      "src/cli/commands/playwright-commands.ts:282 pinned='playwright-userdata' later=[terminalId]"
    ]);
  });

  it('the 6 literal-first rows OUTSIDE the reach are named, and each named row is really there', () => {
    // Repair R7. The reach note used to ENUMERATE these rows; R5 replaced the
    // list with the words "unchanged" and this file went on asserting they were
    // named — a claim no artifact supported, which is the same defect class as
    // the rule passing a slot it never looked at. The names are back in the
    // reach note, and they are re-MEASURED here rather than trusted: read each
    // named file, and require the named line, slot and id to be what the note
    // says they are. If the note drifts, this fails; if a row is fixed and the
    // note is not updated, this fails too.
    const measured = NOT_SCANNED_LITERAL_FIRST.map((named) => {
      const parsed = parseSourceFile(named.file, readFileSync(join(PROJECT_ROOT, named.file), 'utf8'));
      const hit = findLiteralFirstIdJoins(parsed).find((h) => h.line === named.line);
      return hit === undefined
        ? `${named.file}:${named.line} NOT FOUND`
        : `${named.file}:${named.line} pinned=${hit.pinned} later=[${hit.later.join(',')}]`;
    });
    expect(measured).toEqual(
      NOT_SCANNED_LITERAL_FIRST.map(
        (named) => `${named.file}:${named.line} pinned='${named.pinned}' later=[${named.later}]`
      )
    );
  });
});

describe('negative control — the six defects this guard exists for are all detected', () => {
  // Fixtures are ASSEMBLED, never written as literals: this file lives inside
  // the scanned tree, so a literal `.peaks/_runtime/<dated-session>` here would
  // make the guard fail on itself.
  const SESSION = ['2026', '07', '25'].join('-') + '-session-' + '6da9d9';
  const RUNTIME_PATH = ['.peaks', '_runtime', SESSION, 'rd', 'requests', '001-x.md'].join('/');

  it('catches the `request …` family aimed at process.cwd() (defects 14-17)', () => {
    const fixture = [
      `const EXISTING_RID = 'x';`,
      `const EXISTING_SESSION = ${JSON.stringify(SESSION)};`,
      `runCli(['request', 'lint', EXISTING_RID, '--role', 'rd', '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`,
      `runCli(['request', 'repair-status', EXISTING_RID, '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`,
      `runCli(['request', 'list', '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`,
      `runCli(['request', 'show', EXISTING_RID, '--role', 'rd', '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`
    ].join('\n');
    expect(
      findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map(
        (hit) => `${hit.line}:${hit.command}:${hit.flag}`
      )
    ).toEqual([
      '3:request lint:--project',
      '4:request repair-status:--project',
      '5:request list:--project',
      '6:request show:--project'
    ]);
  });

  it('catches `scan diff-vs-scope` aimed at a REPO constant (defect 18)', () => {
    const fixture = [
      `const REPO = resolve(__dirname, '../..');`,
      `runCli(['scan', 'diff-vs-scope', '--rid', EXISTING_RID, '--project', REPO, '--session-id', EXISTING_SESSION, '--json'], REPO);`
    ].join('\n');
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map((hit) => hit.line)).toEqual([2]);
  });

  it('catches `memory extract` pointed at the repo root with a pinned artifact path (defect 13)', () => {
    const fixture =
      `runCli(['memory', 'extract', '--project', process.cwd(), '--artifact', ` +
      `join(process.cwd(), ${JSON.stringify(RUNTIME_PATH)}), '--dry-run', '--json'], process.cwd());`;
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map((hit) => hit.line)).toEqual([1]);
  });
});

describe('negative control — creating and reading your own runtime tree is NOT a violation', () => {
  const SESSION = ['2026', '09', '13'].join('-') + '-session-' + 'fixture0';

  it('a tmp project the test made anchors its own runtime paths', () => {
    const fixture = [
      `const project = mkdtempSync(join(tmpdir(), 'fixture-'));`,
      `bindSession(project);`,
      `mkdirSync(join(project, '.peaks', '_runtime', ${JSON.stringify(SESSION)}), { recursive: true });`,
      `writeFileSync(join(project, '.peaks', '_runtime', 'active-skill.json'), '{}');`,
      `writeFileSync(join(project, '.peaks', '_runtime', ${JSON.stringify(SESSION)}, 'rd', 'requests', 'r.md'), BODY);`,
      `runCli(['request', 'lint', FIXTURE_RID, '--project', project, '--session-id', FIXTURE_SESSION, '--json'], project);`,
      `runCli(['memory', 'extract', '--project', project, '--artifact', join(project, 'notes', 'x.md'), '--dry-run', '--json'], project);`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
  });

  it('a hardcoded session-id literal alone is a mention, not a dependency', () => {
    // The measured reason rule C is anchored on the ROOT rather than on the id:
    // `tests/**` holds dozens of these as pure-function inputs and tmp labels,
    // all legitimate. Only using one to resolve session state FROM THE
    // REPOSITORY makes it a dependency.
    const fixture = [
      `const SID = ${JSON.stringify(SESSION)};`,
      `const index = readMemoryIndex(tmpProjectRoot, SID);`,
      `expect(renderStatusLine({ sessionId: SID, isTTY: false })).toContain('Peaks');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
  });

  it('a test that chdir\'d into a tmp workspace and writes process.cwd()/.peaks is legal', () => {
    // Limit (d), pinned. `tests/unit/_setup/tmp-workspace.ts` chdirs, so
    // `process.cwd()` here is the tmp root, not the repository — which is
    // exactly why rule B does not accept `process.cwd()` as an anchor.
    const fixture = [
      `withTmpWorkspacePerTest();`,
      `const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);`,
      `mkdirSync(runtime, { recursive: true });`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('mentioning the runtime tree in an assertion about OUTPUT is not a violation', () => {
    const bareDir = ['.peaks', '_runtime'].join('/');
    const layout = ['.peaks', '_runtime', '<sid>', '<role>', 'requests', '<rid>.md'].join('/');
    const fixture = [
      `expect(envelope.data.path).toContain(${JSON.stringify(bareDir)});`,
      `// prose: peaks writes envelopes only to .peaks/_runtime/<sessionId>/<role>/`,
      `const doc = ${JSON.stringify(layout)};`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
  });
});

describe('limits — pinned as passing tests, not left implicit', () => {
  it('limit (a): an anchor laundered through a helper is invisible', () => {
    const fixture = [
      `function here() { return process.cwd(); }`,
      `const p = join(here(), '.peaks', '_runtime', sid);`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (b) is NOT a limit for rule C: a smuggled id does not escape it', () => {
    // An id-literal rule would miss `SIDS[0]`. Rule C asserts on the ANCHOR, so
    // it does not care how the id was spelled.
    const fixture = [
      `const SIDS = [${JSON.stringify(['2026', '07', '25'].join('-') + '-session-' + '6da9d9')}];`,
      `runCli(['request', 'show', 'x', '--project', process.cwd(), '--session-id', SIDS[0], '--json'], process.cwd());`
    ].join('\n');
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map((hit) => hit.line)).toEqual([2]);
  });

  it('limit (c): a runtime path assembled from parts is invisible', () => {
    const fixture = [
      `const dir = ${JSON.stringify('.peaks/')} + ${JSON.stringify('_runtime')};`,
      `const p = join(__dirname, dir, 'x');`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (d): process.cwd() in a direct fs call is invisible (chdir\'d suites)', () => {
    const fixture =
      `const p = readFileSync(join(process.cwd(), '.peaks', '_runtime', sid, 'session.json'), 'utf8');`;
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (e): a non-listed reader is invisible', () => {
    // `workflow plan detect-trigger` takes `--rid`/`--session-id` and looks
    // identical to a reader at the call site, but reads no artifact — verified
    // by running it with a synthetic session id in an empty tmp project, which
    // returns ok:true. Which commands read session state is product knowledge,
    // so the set is explicit rather than inferred.
    const fixture = [
      `const REPO = resolve(__dirname, '../..');`,
      `runCli(['workflow', 'plan', 'detect-trigger', '--rid', EXISTING_RID, '--project', REPO, '--session-id', EXISTING_SESSION, '--json'], REPO);`
    ].join('\n');
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (f): an artifact reader given no --project at all is invisible', () => {
    // It inherits the repo root from cwd, with no anchor argument to match.
    // Named so the next reader does not read rule C as "artifact readers cannot
    // consume the repository".
    const fixture = `runCli(['request', 'show', 'x', '--json'], process.cwd());`;
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
  });
});
