// tests/unit/runtime/no-runtime-input-guard-scan.ts
//
// The enumeration + scan half of `no-runtime-input-guard.test.ts`, moved
// VERBATIM into this sibling for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-5). THIS FILE OWNS THE GUARD'S REACH:
// `scanProject` enumerates every `tests/**/*.ts` file by recursively walking
// `tests/` with `fs.readdirSync`, and `scanSourceLayer` enumerates
// `src/cli/commands/**/*.ts` the same way PLUS the literal
// `MEASURED_ESCAPE_MODULES` list. Neither walk filters what it enumerates. Any
// edit that narrows these walks narrows what the guard proves while every
// assertion in the test files stays green — the failure mode lint-gate §4b
// row 2 and §4c record. The RULE D banner below carries the reach statement.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import * as ts from 'typescript';

import {
  collapse,
  findModuleLocationRuntimePaths,
  findRepoRootedArtifactReads,
  type AnchoredRuntimePath,
  type RepoRootedArtifactRead
} from './no-runtime-input-guard-detect-bc.js';
import {
  findLiteralFirstIdJoins,
  findUnguardedRuntimeIdJoins,
  isJoinCall,
  moduleStringConstants,
  runtimeBuilderNames,
  runtimeJoinSlots,
  type LiteralFirstIdJoin,
  type UnguardedIdJoin
} from './no-runtime-input-guard-detect-ruled.js';

export const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const TESTS_ROOT = join(PROJECT_ROOT, 'tests');
/** Rule D's primary reach — the layer where a commander flag becomes an id. */
const SRC_COMMANDS_ROOT = join(PROJECT_ROOT, 'src', 'cli', 'commands');

/** POSIX-normalised path relative to the project root. */
export function relativeToRoot(absolutePath: string): string {
  return absolutePath
    .slice(PROJECT_ROOT.length + 1)
    .split(sep)
    .join('/');
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

export function parseSourceFile(absolutePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
//     total, 1 in reach, these 6 not scanned). Named by WHAT they join, not by
//     the line they sit on — the test that re-measures them keys on the same
//     identity, so this note cannot go stale on a line shift without the suite
//     going red first:
//       src/services/prd/prd-blocks-checker.ts              pinned 'prd'    later=[requestId]
//       src/services/prd/prd-blocks-checker.ts              pinned 'change' later=[requestId]
//       src/services/session/caller-binding-service.ts      pinned 'callers' later=[callerId]
//       src/services/workflow/artifact-paths.ts             pinned 'change' later=[sessionId]
//       src/services/workflow/pipeline-verify-gate-support.ts pinned 'change' later=[rdEvidenceDir]  (two rows)
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
export const MEASURED_ESCAPE_MODULES: readonly string[] = [
  'src/services/qa/qa-business-review-state.ts',
  'src/services/slice/slice-review-state.ts',
  'src/services/prd/handoff-service.ts',
  // Slice `b1-filesplit-campaign` wave 3: `handoffRelativePath` /
  // `resolveHandoffPath` and their guard moved VERBATIM out of
  // `handoff-service.ts` into this sibling. The joins did not change and neither
  // did the guard, so the module joins the scanned set in its predecessor's
  // place — leaving it out would have narrowed rule D's reach by a file split,
  // which is the R1 defect shape this list exists to prevent.
  'src/services/prd/handoff-path-resolution.ts',
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
 * are named is checked against the files rather than asserted in prose.
 *
 * No `line` field. These rows are named by the slot they pin and the id joined after
 * it, which is what makes one of them a problem; two of the six share a file AND a
 * slot, so the re-measurement compares them as a multiset, and a line number here
 * would be a pointer nothing checks.
 */
export const NOT_SCANNED_LITERAL_FIRST: readonly {
  readonly file: string;
  readonly pinned: string;
  readonly later: string;
}[] = [
  { file: 'src/services/prd/prd-blocks-checker.ts', pinned: 'prd', later: 'requestId' },
  { file: 'src/services/prd/prd-blocks-checker.ts', pinned: 'change', later: 'requestId' },
  { file: 'src/services/session/caller-binding-service.ts', pinned: 'callers', later: 'callerId' },
  { file: 'src/services/workflow/artifact-paths.ts', pinned: 'change', later: 'sessionId' },
  {
    file: 'src/services/workflow/pipeline-verify-gate-support.ts',
    pinned: 'change',
    later: 'rdEvidenceDir'
  },
  {
    file: 'src/services/workflow/pipeline-verify-gate-support.ts',
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

export const SCAN = scanProject();
export const SRC_SCAN = scanSourceLayer();

export const where = (file: string, line: number): string => `${relativeToRoot(file)}:${line}`;
