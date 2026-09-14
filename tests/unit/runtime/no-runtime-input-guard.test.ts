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
//
// The property, in one sentence:
//
//   A `join()` / `resolve()` that places an EXPRESSION in the segment slot
//   immediately after the `'_runtime'` literal must have that expression
//   guarded by `isUnsafePathInput` (or a peer control) somewhere in the file.
//
// Why the segment slot and not the flag: the measured class is not "a command
// forgot to check its `--session-id`". It is that each join site RE-DERIVES
// whether to apply the control, so a command's guardedness is uncorrelated
// with whether its id reaches a path. `evidence-generator.ts` and
// `verdict-aggregate-command.ts` guard their sid; their neighbours three files
// over do not. The join is the invariant's home.
//
// Why the guards are a CLOSED set: `isUnsafePathInput` is the canonical control
// (`src/shared/path-safety.ts`), but two peers exist and are equally sound —
// `validateSessionId` (a throwing validator whose `SESSION_ID_PATTERN` admits
// no separator, no dot and no drive letter) and `assertSafePathSegment`.
// Recognising them is not a widening: a rule that did not would flag
// `final-review-commands.ts`, which IS guarded, and the remedy for a false
// positive is an allowlist — which is how this kind of guard dies.
//
// REACH, stated because a guard whose reach is unstated reads as total:
//   scanned  `src/cli/commands/**/*.ts` (the layer where a flag becomes an id)
//            + `MEASURED_ESCAPE_MODULES`
//   NOT      the ~75 service-layer joins whose id comes from the canonical
//            binding / `PEAKS_SESSION_ID` / `session.json` (the job's §4.2 —
//            a different trust class, deferred not cleared); NOT the segments
//            after the id slot (limit (k)); and NOT a join whose id slot is a
//            PINNED LITERAL (limit (l)).
//
// Limit (l), stated as the rule's own blind spot because it was read as a
// clearance once: the rule asserts on the slot IMMEDIATELY after `'_runtime'`,
// and ONLY when that slot is not a pinned literal. `join(root,'.peaks','_runtime',
// SESSIONS_DIR, sid)` therefore produces NO finding — not "unguarded", but
// invisible, numerator and denominator alike. Measured 2026-09-14: 7 such joins
// in `src/` (1 in this rule's reach):
//
//   src/cli/commands/playwright-commands.ts:282   later=[terminalId]        IN REACH
//   src/services/prd/prd-blocks-checker.ts:62,63  later=[requestId]         not scanned
//   src/services/session/caller-binding-service.ts:38  later=[callerId]     not scanned
//   src/services/workflow/artifact-paths.ts:63    later=[sessionId]         not scanned
//   src/services/workflow/pipeline-verify-gate-support.ts:261,333  later=[rdEvidenceDir]  not scanned
//   (line numbers measured by the census on 2026-09-14, after this cycle's
//    `sessionFilePath` guard was added.)
//
// The in-reach one is not free of consequence: on 2026-09-14 a LIVE escape
// (`playwright stop --terminal ../../../../X` → SIGTERM + unlink outside the
// project root under `ok: true`) lived one call away from that site, and this
// rule could not have named it. Fixed at the join; `findLiteralFirstIdJoins`
// below makes the shape countable so a new one fails a test instead of relying
// on being noticed. Widening the rule into the "not scanned" rows is a separate
// decision: `caller-binding-service.ts` is guarded by `CALLER_ID_REGEX`, which
// is not in the recognised set, so widening without an allowlist trades a
// blind spot for a false positive.
// ===========================================================================

/** A module-level `const X = 'literal'` — a pinned name, not an id. */
function moduleStringConstants(sourceFile: ts.SourceFile): ReadonlySet<string> {
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

/** Identifier names handed to a recognised control anywhere in the file. */
function guardedNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = collapse(node.expression.getText(sourceFile));
      const recognised = ID_GUARD_NAMES.some((guard) => callee === guard || callee.endsWith(`.${guard}`));
      // `REQUEST_ID_PATTERN.test(rid)` is the rid axis's control and is spelled
      // as a predicate call rather than as a guard function.
      const ridAxis = callee.includes('REQUEST_ID_PATTERN');
      if (recognised || ridAxis) {
        for (const argument of node.arguments) {
          const collect = (n: ts.Node): void => {
            if (ts.isIdentifier(n)) names.add(n.text);
            ts.forEachChild(n, collect);
          };
          collect(argument);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

const ID_GUARD_NAMES: readonly string[] = ['isUnsafePathInput', 'validateSessionId', 'assertSafePathSegment'];

const isJoinCall = (callee: string): boolean => /(^|\.)(join|resolve)$/.test(callee);

export interface UnguardedIdJoin {
  readonly file: string;
  readonly line: number;
  readonly segment: string;
}

export function findUnguardedRuntimeIdJoins(sourceFile: ts.SourceFile): UnguardedIdJoin[] {
  const constants = moduleStringConstants(sourceFile);
  const guarded = guardedNames(sourceFile);
  const found: UnguardedIdJoin[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
      const args = node.arguments;
      const runtimeAt = args.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
      const segment = runtimeAt >= 0 ? args[runtimeAt + 1] : undefined;
      if (segment !== undefined) {
        const pinnedName =
          ts.isStringLiteral(segment) ||
          ts.isNoSubstitutionTemplateLiteral(segment) ||
          (ts.isIdentifier(segment) && constants.has(segment.text));
        if (!pinnedName) {
          const tails = new Set<string>();
          const collect = (n: ts.Node): void => {
            if (ts.isIdentifier(n)) tails.add(n.text);
            ts.forEachChild(n, collect);
          };
          collect(segment);
          const isGuarded = [...tails].some((name) => guarded.has(name));
          if (!isGuarded) {
            found.push({
              file: sourceFile.fileName,
              line: lineOf(sourceFile, node),
              segment: collapse(segment.getText(sourceFile))
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

/**
 * LIMIT (l) — the census of joins rule D cannot see, made countable.
 *
 * When the slot immediately after `'_runtime'` is a pinned literal, rule D
 * returns nothing for the whole join: the site is invisible to the id-slot
 * numerator AND to the `idJoinSites` denominator, so the rule reads as having
 * looked and found nothing. That is not the same as "safe", and on 2026-09-14 a
 * LIVE ESCAPE sat behind exactly this shape (`playwright-commands.ts`: the
 * `'_runtime'` literal is inside `playwrightSessionsDir()`, whose slot is the
 * pinned `PLAYWRIGHT_SESSIONS_DIR`; the caller-supplied terminal id is joined in
 * a SECOND call, `sessionFilePath()`, which contains no `_runtime` literal at
 * all). Fixed at that join in repair cycle 1; this function is why it cannot
 * happen silently again.
 *
 * It reports every join inside rule D's reach whose id slot is pinned while a
 * LATER argument carries something that is not a pinned literal of this file —
 * i.e. every shape rule D is blind to. Guarded or not, the fact reported is the
 * blindness, so the caller cannot mistake the rule's silence for a clearance.
 *
 * Measured 2026-09-14: 1 such join in rule D's reach (`playwright-commands.ts`
 * `join(…, 'playwright-userdata', terminalId)`) and 7 in the whole of `src/`.
 * The 6 outside this reach are named in the reach note above and are NOT
 * scanned; a repo-wide census is `probe-src-joins.mjs`'s job, not this file's.
 */
export interface LiteralFirstIdJoin {
  readonly file: string;
  readonly line: number;
  /** The pinned literal / module constant written in the slot after `'_runtime'`. */
  readonly pinned: string;
  /** Identifier names appearing in the segments AFTER that slot. */
  readonly later: readonly string[];
}

const isPinnedName = (node: ts.Node, constants: ReadonlySet<string>): boolean =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  (ts.isIdentifier(node) && constants.has(node.text));

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
 * escape was MEASURED this job (`qa-business-review-state.ts`,
 * `slice-review-state.ts` — RD sweep cases A17/A26) or where the id slot of a
 * command layer's join lives. A NEW measured escape adds its module here
 * together with its guard. The set only grows, and a test pins its contents.
 */
const MEASURED_ESCAPE_MODULES: readonly string[] = [
  'src/services/qa/qa-business-review-state.ts',
  'src/services/slice/slice-review-state.ts'
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
    // Every `_runtime` join whose id slot is not a pinned name, guarded or not:
    // the denominator the hit count is reported against.
    const countIdSlots = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
        const args = node.arguments;
        const runtimeAt = args.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
        const segment = runtimeAt >= 0 ? args[runtimeAt + 1] : undefined;
        if (segment !== undefined && !ts.isStringLiteral(segment) && !ts.isNoSubstitutionTemplateLiteral(segment)) {
          idJoinSites += 1;
        }
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
    // …while the modules rule D DOES cover are the command layer plus the
    // measured-escape set, and nothing else.
    expect(SRC_SCAN.scannedFiles.every((f) => {
      const rel = relativeToRoot(f);
      return rel.startsWith('src/cli/commands/') || MEASURED_ESCAPE_MODULES.includes(rel);
    })).toBe(true);
  });

  it('limit (k): segments AFTER the id slot are not asserted', () => {
    // `join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, F)` has two
    // caller-supplied segments and only the first is asserted. Pinned because
    // this is the shape the slice fixed BY HAND in
    // `sub-agent-shutdown-commands.ts` (`--dispatch-id`), and the next reader
    // should not infer the rule covers it. Widening it needs the rid axis's
    // `REQUEST_ID_PATTERN` control folded in, which is a separate decision.
    const fixture =
      `const p = join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, 'x.json');`;
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', fixture)).map((h) => h.segment)).toEqual(['sid']);
  });

  it('limit (l): a pinned literal in the id slot makes the whole join invisible', () => {
    // The rule reads as having looked and found nothing. That is NOT a clearance
    // — on 2026-09-14 a live escape (`playwright stop --terminal ../../../../X`)
    // sat one call away from exactly this shape. Both halves are asserted: the
    // rule is blind, and the census sees it (so the blindness cannot be silent).
    const fixture = [
      `const SESSIONS_DIR = 'playwright-sessions';`,
      `export const dir = (root: string, sid: string) =>`,
      `  join(root, '.peaks', '_runtime', SESSIONS_DIR, sid, 'x.json');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findUnguardedRuntimeIdJoins(parsed)).toEqual([]);
    expect(findLiteralFirstIdJoins(parsed).map((h) => `${h.line}:${h.pinned}:[${h.later.join(',')}]`)).toEqual([
      '3:SESSIONS_DIR:[sid]'
    ]);
  });

  it('pins the literal-first census inside the rule\'s reach (measurement, not assurance)', () => {
    // Every join in the scanned layer that rule D cannot see. A NEW one fails
    // here — that is the point: the shape that hid a live escape must announce
    // itself, not wait to be noticed. Measured 2026-09-14: 7 in the whole of
    // `src/`, of which this is the only one in reach (the other 6 are named in
    // the reach note and are NOT scanned).
    expect(
      SRC_SCAN.literalFirstJoins.map((h) => `${relativeToRoot(h.file)}:${h.line} pinned=${h.pinned} later=[${h.later.join(',')}]`)
    ).toEqual([
      "src/cli/commands/playwright-commands.ts:282 pinned='playwright-userdata' later=[terminalId]"
    ]);
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
