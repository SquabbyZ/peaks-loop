/**
 * `pre-post-diff` producer — the missing evidence source for the
 * `existing-functionality-intact` dimension of `peaks prepare-final-review`.
 *
 * THE GAP THIS CLOSES. The dimension's own contract
 * (`skills/peaks-final-review/references/4-dimensions.md`) asks for "a pre/post
 * baseline diff [showing] no unintended drift in the test surface, public API,
 * or key behavior" — an `EvidenceItem` of kind `pre-post-diff`. Nothing in
 * peaks-loop produced one: the sources mapped to that dimension were
 * `rd/tech-doc.md` (design intent) and `prd/handoff.md` (approved scope), and
 * the reviewer LLM itself reported the mismatch ("the only FOUND source is a
 * design-intent document, not a regression assessment"). `allPass === true`
 * was therefore unreachable by construction, on every workflow.
 *
 * WHAT IT DOES. Compares a base ref against the working tree with git (no new
 * dependency; `git` is already the repo's baseline tool) and records two
 * structural surfaces:
 *   1. test surface  — the test FILE lists, and `it(` / `test(` case counts,
 *      before/after;
 *   2. public API surface — the `.ts` / `.tsx` SOURCE FILE lists, the top-level
 *      `export` statement count, and the ADDED/REMOVED export NAMES over the
 *      changed files.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never invents a baseline. When no base
 * ref resolves — or the project is not a git work tree at all, or the base
 * resolves to HEAD itself so the compared range is empty — it returns
 * `unavailable` with a reason and writes NO artifact, so the dimension has no
 * `pre-post-diff` evidence and cannot be reported `pass` on the strength of a
 * fabricated (or empty) diff.
 *
 * HONESTY BOUNDARY (also written into the artifact itself). Export detection is
 * a line-anchored REGEX, not a type checker. It detects a structural loss — an
 * export that was removed or renamed — and it CANNOT detect a signature change,
 * a narrowed type, or a behaviour change inside a function body. It is a drift
 * detector, not proof that the API is unchanged. File-level deletion IS visible,
 * because it is read from the file lists rather than inferred from the counts.
 *
 * THE VERDICT COMES FIRST. The artifact opens with its `VERDICT:` line, above
 * the metadata and the counts. The consumer may legitimately receive only the
 * head of this file (it is an evidence source under a per-file byte cap), and
 * with the conclusion at the end every such truncation dropped exactly the part
 * the dimension has to judge — so a partially delivered artifact was
 * indistinguishable from a clean comparison. Conclusion-first makes "the
 * reviewer got the answer" a property of the bytes received.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Path segments (under `.peaks/_runtime/<sessionId>/`) the artifact lands at. */
export const API_DIFF_ARTIFACT_SEGMENTS = ['final-review', 'api-diff.txt'] as const;

/**
 * The literal that opens the artifact's conclusion line.
 *
 * Exported because the consumer must be able to test for the CONCLUSION, not
 * for a byte count (F-BLOCK-1BYTE): one byte of `api-diff.txt` satisfied
 * "status: found" while conveying nothing, and the delivery gate it fed then let
 * a `pass` stand on a comparison nobody saw. The producer writes the line this
 * marker opens and `final-review-service.ts` requires it in the delivered
 * bytes, so the two cannot drift apart into the same hole again.
 */
export const PRE_POST_DIFF_VERDICT_MARKER = 'VERDICT: ';

/**
 * The three conclusions the artifact may open with, exported as the same
 * literals the writer interpolates below.
 *
 * They are constants because reading the conclusion is now part of the
 * consumer's job (F2): the pre/post-diff source is the one source whose
 * conclusion had a machine-readable form all along, and the envelope threw it
 * away — a delivered `STRUCTURAL DRIFT DETECTED` produced `allPass: true` with
 * an empty `needsAttention`. A consumer that must classify the conclusion may
 * only do so against the producer's own literals, never against a re-typed
 * copy of them.
 */
export const PRE_POST_DIFF_NO_DRIFT = 'NO STRUCTURAL DRIFT';
export const PRE_POST_DIFF_ADDITIONS_ONLY = 'ADDITIONS ONLY';
export const PRE_POST_DIFF_DRIFT_DETECTED = 'STRUCTURAL DRIFT DETECTED';

/**
 * What the artifact's conclusion LINE says, read from the bytes a consumer
 * actually received.
 *
 * `indeterminate` is not "nothing to report": it is "the line is there (or is
 * not) and this consumer cannot classify it", which for a drift DETECTOR is a
 * fact a human has to see — see `enforceStructuralDriftAttention`.
 */
export type PrePostDiffConclusion =
  | 'no-drift'
  | 'additions-only'
  | 'drift-detected'
  | 'indeterminate';

/**
 * Classify the delivered conclusion. Pure and total: a caller passes the bytes
 * it received (possibly a head slice) and gets back what the artifact says.
 *
 * Only the FIRST `VERDICT:` line is read. The artifact's header promises the
 * verdict "is repeated nowhere" and that it is the file's conclusion, so a
 * later line cannot be the answer, and reading further would let a document's
 * prose masquerade as its conclusion.
 */
export function classifyPrePostDiffVerdict(content: string): PrePostDiffConclusion {
  const line = content.split(/\r?\n/).find(candidate => candidate.startsWith(PRE_POST_DIFF_VERDICT_MARKER));
  if (line === undefined) return 'indeterminate';
  const conclusion = line.slice(PRE_POST_DIFF_VERDICT_MARKER.length);
  if (conclusion.startsWith(PRE_POST_DIFF_DRIFT_DETECTED)) return 'drift-detected';
  if (conclusion.startsWith(PRE_POST_DIFF_ADDITIONS_ONLY)) return 'additions-only';
  if (conclusion.startsWith(PRE_POST_DIFF_NO_DRIFT)) return 'no-drift';
  return 'indeterminate';
}

/** Test-file globs — the single definition both the file count and the case
 *  count use, so the two can never disagree about what a "test file" is. */
export const TEST_FILE_GLOBS = [
  '*.test.ts',
  '*.test.tsx',
  '*.spec.ts',
  '*.spec.tsx'
] as const;

/** Source globs for the public-API surface. */
export const API_SOURCE_GLOBS = ['*.ts', '*.tsx'] as const;

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

/** A `.ts` / `.tsx` file that is not a test file — the file-level source surface. */
function isSourcePath(path: string): boolean {
  return /\.(ts|tsx)$/.test(path) && !TEST_FILE_RE.test(path);
}

/**
 * One `it(` / `test(` declaration per matching LINE — the same unit `git grep -c`
 * counts on the base side. Counting raw matches instead would double-count a
 * line holding two of them, and the two sides of the delta would then disagree
 * about a file neither of them changed.
 *
 * Modifiers count (`it.skip(`, `it.only(`, `test.each(`, `test.concurrent(`…),
 * and they count on BOTH sides — the JS regex and the POSIX ERE below are the
 * same expression. Missing them made a plain rewrite (`it(` -> `test.each(`)
 * read as two deleted cases; a class that is half-counted is worse than a class
 * that is not counted at all.
 *
 * What is deliberately NOT modelled: an occurrence inside a comment or a string
 * literal still matches. That is symmetric — the same expression is evaluated on
 * both sides — so it cancels out of the DELTA, which is the only thing a removal
 * is ever derived from.
 */
const TEST_CASE_LINE_RE = /\b(it|test)(\.[A-Za-z]+)*\(/;
const TEST_CASE_ERE = '\\b(it|test)(\\.[A-Za-z]+)*\\(';
/**
 * Column-0 `export` — an export STATEMENT, not a type-checked symbol.
 *
 * Deliberately a literal space rather than a character class: `[ \t]` is a tab
 * in JS and "backslash or t" in POSIX ERE, so a pattern that spells the two
 * differently would make the two sides of the count silently disagree.
 */
const EXPORT_LINE_RE = /^export /;
const EXPORT_LINE_ERE = '^export ';

const EXPORT_DECL_RE =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;
/**
 * `export type { T }` — a TYPE-ONLY re-export list.
 *
 * It has to be parsed on its own because `EXPORT_LIST_RE` below anchors `{`
 * immediately after `export`, so `export type { T }` matched neither rule and
 * bound NO name — while the inline spelling `export { type T }` was parsed and
 * DID bind `T`. One construct, two spellings, opposite conclusions: the
 * approximation has to pick a direction and hold it. Both spellings now bind
 * `T`: a type-only export IS an export.
 */
const EXPORT_TYPE_LIST_RE = /^export\s+type\s*\{([^}]*)\}/;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}/;
const EXPORT_DEFAULT_RE = /^export\s+default\b/;

export interface PrePostDiffComputed {
  readonly status: 'computed';
  readonly summary: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly content: string;
}

export interface PrePostDiffUnavailable {
  readonly status: 'unavailable';
  /** Why no baseline exists, in the operator's terms. */
  readonly reason: string;
  /**
   * `true` when the project root IS a git work tree — i.e. a baseline was
   * expected to be computable and was not. That distinction shapes the REASON
   * the operator is given (a tooling failure to fix, versus a project that has
   * no baseline to offer), and the service refuses a `pass` on this dimension
   * either way: "not a git repository" is the CAUSE of the missing evidence,
   * never a licence to trust the claim the evidence was supposed to support.
   */
  readonly inGitWorkTree: boolean;
}

export type PrePostDiffResult = PrePostDiffComputed | PrePostDiffUnavailable;

export interface ProducePrePostDiffOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  /** Explicit base ref. Unset ⇒ merge-base with the upstream default branch. */
  readonly baseRef?: string;
}

interface GitRun {
  readonly ok: boolean;
  readonly stdout: string;
  readonly detail: string;
}

/**
 * Run git read-only. Exit code 1 is `grep`-found-nothing and `merge-base`-no-
 * common-ancestor, which are answers rather than failures — every caller
 * therefore checks the CONTENT it needs (`ok` alone is never enough for a ref).
 */
function runGit(cwd: string, args: readonly string[]): GitRun {
  try {
    const stdout = execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    });
    return { ok: true, stdout, detail: '' };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message?: string;
    };
    const stdout = failure.stdout === undefined ? '' : String(failure.stdout);
    const stderr = failure.stderr === undefined ? '' : String(failure.stderr);
    if (failure.status === 1) return { ok: true, stdout, detail: stderr.trim() };
    return { ok: false, stdout: '', detail: (stderr || failure.message || '').trim() };
  }
}

function lines(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function isTestPath(path: string): boolean {
  return TEST_FILE_RE.test(path);
}

/**
 * The names bound by one `{ ... }` re-export list. The `type` marker is
 * stripped, so `export { type T }` and `export type { T }` agree — see
 * `EXPORT_TYPE_LIST_RE`.
 */
function namesInExportList(body: string): readonly string[] {
  return body
    .split(',')
    .map(part => part.replace(/^\s*type\s+/, '').trim())
    .filter(part => part.length > 0)
    .map(part => {
      const alias = /\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
      return alias === null ? part : (alias[1] as string);
    })
    .filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * The exported NAMES bound by one source line. Approximate by design: the
 * column-0 anchor is what keeps it to top-level declarations, and
 * `export { a as b }` binds `b` (the name importers get).
 */
export function extractExportedNames(line: string): readonly string[] {
  if (EXPORT_DEFAULT_RE.test(line)) return ['default'];
  const typedList = EXPORT_TYPE_LIST_RE.exec(line);
  if (typedList !== null) return namesInExportList(typedList[1] ?? '');
  const list = EXPORT_LIST_RE.exec(line);
  if (list !== null) return namesInExportList(list[1] ?? '');
  const declaration = EXPORT_DECL_RE.exec(line);
  return declaration === null ? [] : [declaration[1] as string];
}

/** Sum of the `N` in `git grep -c`'s `<rev>:<path>:N` / `<path>:N` lines. */
function sumGrepCounts(stdout: string): number {
  let total = 0;
  for (const line of lines(stdout)) {
    const count = Number.parseInt(line.slice(line.lastIndexOf(':') + 1), 10);
    if (Number.isInteger(count)) total += count;
  }
  return total;
}

/** Lines of `source` matching `re` — never raw occurrences; see the regexes. */
function countMatchingLines(source: string, re: RegExp): number {
  let total = 0;
  for (const line of source.split(/\r?\n/)) if (re.test(line)) total += 1;
  return total;
}

/**
 * Count on the WORKING TREE by reading the files `afterFiles` already lists.
 *
 * This cannot be delegated to `git grep --untracked`: with that flag git greps
 * through its directory walker, and a TRACKED file that also matches
 * `.gitignore` is dropped from the walk without a word. Measured on this repo —
 * `.gitignore` carries `best-practice/`, and `src/services/best-practice/*.ts`
 * is tracked, so `git grep --untracked -- '*.ts'` silently omitted all three of
 * its files while `git grep -- '*.ts'` (index-based) found them. A count that
 * quietly loses files makes a delta that looks like drift.
 */
function countFilesMatching(
  repoRoot: string,
  paths: readonly string[],
  re: RegExp
): number {
  let total = 0;
  for (const path of paths) {
    try {
      total += countMatchingLines(readFileSync(join(repoRoot, path), 'utf8'), re);
    } catch {
      // Unreadable working-tree file: it is already excluded from the file
      // count by the existence filter, so counting it as 0 is consistent.
    }
  }
  return total;
}

interface BaseResolution {
  readonly ok: boolean;
  readonly ref: string;
  readonly label: string;
  readonly reason: string;
}

/**
 * The baseline. An explicit `--base` wins; otherwise the merge-base with the
 * upstream default branch (the point the current work forked from), and
 * `HEAD~1` only as a last resort for a repo with no upstream.
 *
 * `origin/main` alone was not enough: a repository whose default branch is
 * `master` (still the default `git init` name on many installs), or a
 * `clone --depth 1` that never writes `origin/HEAD`, resolved NOTHING — and
 * with the availability gate in place that means the dimension can never pass
 * for reasons that have nothing to do with the work under review. `origin/master`
 * is therefore tried too, and when every candidate fails the reason names the
 * way out instead of leaving the operator with a silent dead end.
 */
function resolveBaseRef(repoRoot: string, explicit?: string): BaseResolution {
  if (explicit !== undefined && explicit.trim() !== '') {
    const requested = explicit.trim();
    const resolved = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${requested}^{commit}`]);
    if (resolved.stdout.trim() !== '') {
      return { ok: true, ref: resolved.stdout.trim(), label: requested, reason: '' };
    }
    return {
      ok: false,
      ref: '',
      label: requested,
      reason: `the requested --base ref "${requested}" does not resolve to a commit in this repository`
    };
  }

  const tried: string[] = [];
  for (const upstream of ['origin/HEAD', 'origin/main', 'origin/master']) {
    tried.push(`${upstream} (merge-base)`);
    const mergeBase = runGit(repoRoot, ['merge-base', 'HEAD', upstream]);
    if (mergeBase.stdout.trim() !== '') {
      return { ok: true, ref: mergeBase.stdout.trim(), label: upstream, reason: '' };
    }
  }

  tried.push('HEAD~1');
  const previous = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD~1^{commit}']);
  if (previous.stdout.trim() !== '') {
    return { ok: true, ref: previous.stdout.trim(), label: 'HEAD~1', reason: '' };
  }

  return {
    ok: false,
    ref: '',
    label: '',
    reason:
      `no usable base ref: none of ${tried.join(', ')} resolved against HEAD. ` +
      'Pass an explicit base with --base <ref> (a branch, a tag, or a commit sha) ' +
      'to compare against the point this work started from'
  };
}

/** `  + name (path)` lines, ordered and de-duplicated. */
function renderNameList(
  entries: readonly { name: string; path: string }[],
  sign: '+' | '-'
): string {
  const seen = new Set<string>();
  const rendered: string[] = [];
  for (const entry of entries) {
    const line = `  ${sign} ${entry.name} (${entry.path})`;
    if (seen.has(line)) continue;
    seen.add(line);
    rendered.push(line);
  }
  return rendered.join('\n');
}

/** `1→2 (delta +1)` — the shape a reviewer (and a test) can read at a glance. */
function delta(before: number, after: number): string {
  const change = after - before;
  return `${String(before)} -> ${String(after)} (delta ${change >= 0 ? '+' : ''}${String(change)})`;
}

/**
 * The per-path file lists, rendered by NET direction.
 *
 * A set of removed paths on its own is not a removal: `git mv` produces one
 * removed path and one added path with no net change, and printing
 * "Removed test files (1)" above a verdict that says nothing was removed is the
 * exact contradiction this renderer must not create. The lists therefore follow
 * the net delta, and an offsetting pair is reported for what it is — a path
 * change, not a loss.
 */
function renderFileList(
  label: string,
  added: readonly string[],
  removed: readonly string[],
  netDelta: number
): readonly string[] {
  const lines: string[] = [];
  if (netDelta < 0 && removed.length > 0) {
    lines.push(`Removed ${label} (${String(removed.length)}):`, ...removed.map(p => `  - ${p}`));
  }
  if (netDelta > 0 && added.length > 0) {
    lines.push(`Added ${label} (${String(added.length)}):`, ...added.map(p => `  + ${p}`));
  }
  if (netDelta === 0 && (added.length > 0 || removed.length > 0)) {
    lines.push(
      `${label}: ${String(removed.length)} path(s) gone / ${String(added.length)} new, with NO net change — so this is a path change (a move or a rename), not a removal.`
    );
  }
  return lines;
}

/**
 * Produce the diff, or say why it could not be produced. Total: it never
 * throws, because a final review must not die on a missing git binary — it
 * must report a dimension it could not assess.
 */
export function producePrePostDiff(opts: ProducePrePostDiffOptions): PrePostDiffResult {
  const absolutePath = join(
    opts.projectRoot,
    '.peaks',
    '_runtime',
    opts.sessionId,
    ...API_DIFF_ARTIFACT_SEGMENTS
  );
  const relativePath = ['.peaks', '_runtime', opts.sessionId, ...API_DIFF_ARTIFACT_SEGMENTS].join(
    '/'
  );

  // A stale artifact from an earlier run must never be read as this run's
  // evidence, so it is dropped before anything else can go wrong.
  try {
    rmSync(absolutePath, { force: true });
  } catch {
    // An undeletable stale file would be read as evidence, so refuse instead.
    return {
      status: 'unavailable',
      reason: `a stale artifact at ${relativePath} could not be removed`,
      inGitWorkTree: false
    };
  }

  const insideWorkTree = runGit(opts.projectRoot, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree.stdout.trim() !== 'true') {
    return {
      status: 'unavailable',
      reason: `${opts.projectRoot} is not inside a git work tree, so no pre/post baseline can be computed`,
      inGitWorkTree: false
    };
  }

  const topLevel = runGit(opts.projectRoot, ['rev-parse', '--show-toplevel']);
  const repoRoot = topLevel.stdout.trim() === '' ? opts.projectRoot : topLevel.stdout.trim();

  const base = resolveBaseRef(repoRoot, opts.baseRef);
  if (!base.ok) {
    return { status: 'unavailable', reason: base.reason, inGitWorkTree: true };
  }

  const headSha = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();

  // F8 — "nothing was compared" must never be written up as "nothing drifted".
  //
  // Every count below is delta-shaped, so an EMPTY range makes them all
  // trivially equal and the report proves nothing. That happens when the base
  // ref resolves to HEAD itself and nothing on the compared surfaces moved: the
  // comparison then covers only the uncommitted changes, and there are none. A
  // shallow clone whose `merge-base` IS `HEAD` lands exactly here on its
  // DEFAULT path, which is how a whole repository could get a clean bill of
  // health for a slice nobody had compared yet.
  //
  // The check is on the SURFACES, not on the working tree at large: a project
  // mid-slice is full of untracked artifacts that have nothing to do with the
  // comparison, and a `git mv` of a test file is a surface change even though
  // its net deltas are all zero.
  const baseIsHead = headSha !== '' && base.ref === headSha;
  const surfaceTouched =
    runGit(repoRoot, ['status', '--porcelain', '--', ...API_SOURCE_GLOBS]).stdout.trim() !== '';
  if (baseIsHead && !surfaceTouched) {
    return {
      status: 'unavailable',
      reason:
        `the resolved base ref "${base.label}" IS HEAD and nothing on the compared surfaces ` +
        'changed, so there is no comparable range — nothing was compared, and an empty range ' +
        'is not evidence that nothing drifted. Pass an explicit base with --base <ref> to ' +
        'compare against the point this work started from',
      inGitWorkTree: true
    };
  }

  // ---- file sets -----------------------------------------------------------
  const baseFiles = lines(
    runGit(repoRoot, ['ls-tree', '-r', '--name-only', '--full-tree', base.ref]).stdout
  );
  const trackedFiles = lines(
    runGit(repoRoot, ['ls-files', '-co', '--exclude-standard']).stdout
  );
  const untrackedFiles = lines(
    runGit(repoRoot, ['ls-files', '--others', '--exclude-standard']).stdout
  );
  // `ls-files` lists INDEX entries, and an entry can outlive its file on disk.
  const afterFiles = trackedFiles.filter(path => existsSync(join(repoRoot, path)));

  const testFilesBefore = baseFiles.filter(isTestPath);
  const testFilesAfter = afterFiles.filter(isTestPath);
  const addedTestFiles = testFilesAfter.filter(path => !baseFiles.includes(path));
  const removedTestFiles = testFilesBefore.filter(path => !afterFiles.includes(path));

  // F4 — the SOURCE FILE lists, so a deleted module is visible even when the
  // counts it would have moved do not move at all: a `.ts` module with no
  // top-level `export ` line leaves the export count untouched, and a module
  // with no `it(` leaves the case count untouched, so a deleted file used to
  // produce four identical counts and a "NO STRUCTURAL DRIFT" that was simply
  // false. The file lists are the structural fact that does not depend on
  // either approximation. Test files are excluded here because they have their
  // own list above — the two surfaces stay disjoint, so one deleted file is
  // never counted twice.
  const sourceFilesBefore = baseFiles.filter(isSourcePath);
  const sourceFilesAfter = afterFiles.filter(isSourcePath);
  const addedSourceFiles = sourceFilesAfter.filter(path => !baseFiles.includes(path));
  const removedSourceFiles = sourceFilesBefore.filter(path => !afterFiles.includes(path));

  // ---- test surface --------------------------------------------------------
  // Before: the base TREE (a tree grep cannot hit the ignore-walk trap above).
  // After: the working tree, read from the files `afterFiles` lists.
  const testCasesBefore = sumGrepCounts(
    runGit(repoRoot, ['grep', '-c', '-E', TEST_CASE_ERE, base.ref, '--', ...TEST_FILE_GLOBS])
      .stdout
  );
  const testCasesAfter = countFilesMatching(repoRoot, testFilesAfter, TEST_CASE_LINE_RE);

  // ---- public API surface (changed .ts / .tsx files only) ------------------
  // The COUNT keeps the `*.ts` / `*.tsx` glob semantics on both sides — the base
  // side is a `git grep` over the same globs, so it cannot exclude test files
  // and the working-tree side must not either, or the two sides would count
  // different file sets. The FILE LISTS (`sourceFiles*`) are the disjoint
  // non-test surface used for the artifact and the removal rule.
  const countedSourceAfter = afterFiles.filter(path => /\.(ts|tsx)$/.test(path));
  const exportsBefore = sumGrepCounts(
    runGit(repoRoot, ['grep', '-c', '-E', EXPORT_LINE_ERE, base.ref, '--', ...API_SOURCE_GLOBS])
      .stdout
  );
  const exportsAfter = countFilesMatching(repoRoot, countedSourceAfter, EXPORT_LINE_RE);

  const addedExports: { name: string; path: string }[] = [];
  const removedExports: { name: string; path: string }[] = [];
  let currentPath = '';
  const diffText = runGit(repoRoot, [
    'diff',
    '--no-color',
    '-U0',
    base.ref,
    '--',
    ...API_SOURCE_GLOBS
  ]).stdout;
  const namesAddedByPath = new Map<string, Set<string>>();
  const namesRemovedByPath = new Map<string, Set<string>>();
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      currentPath = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ') || line.length === 0) continue;
    if (!line.startsWith('-') && !line.startsWith('+')) continue;
    const names = extractExportedNames(line.slice(1));
    if (names.length === 0) continue;
    const byPath = line.startsWith('-') ? namesRemovedByPath : namesAddedByPath;
    const bucket = byPath.get(currentPath) ?? new Set<string>();
    for (const name of names) bucket.add(name);
    byPath.set(currentPath, bucket);
  }
  // F6 — a name that appears on BOTH sides of the same file was REWRITTEN or
  // re-listed, not removed: `export { a }` -> `export { a, b }` diffs as
  // `-export { a }` / `+export { a, b }`, and reading the minus side alone
  // reported a removal of `a` that never happened. A false removal is the same
  // class of defect as a false pass — it turns the gate red for a change that
  // is not one — so the per-file set difference is what decides, and an
  // unresolved name is simply not reported.
  for (const [path, names] of namesRemovedByPath) {
    const rewritten = namesAddedByPath.get(path) ?? new Set<string>();
    for (const name of names) if (!rewritten.has(name)) removedExports.push({ name, path });
  }
  for (const [path, names] of namesAddedByPath) {
    const preexisting = namesRemovedByPath.get(path) ?? new Set<string>();
    for (const name of names) if (!preexisting.has(name)) addedExports.push({ name, path });
  }
  // Untracked files are invisible to `git diff`, and in this repo's workflow the
  // slice's new files are exactly the ones still untracked.
  for (const path of untrackedFiles.filter(path => /\.(ts|tsx)$/.test(path))) {
    try {
      for (const name of readFileSync(join(repoRoot, path), 'utf8')
        .split(/\r?\n/)
        .flatMap(line => extractExportedNames(line))) {
        addedExports.push({ name, path });
      }
    } catch {
      // Unreadable new file: its exports simply do not appear in the added list.
    }
  }

  // ---- verdict -------------------------------------------------------------
  const caseDelta = testCasesAfter - testCasesBefore;
  const testFileDelta = testFilesAfter.length - testFilesBefore.length;
  const sourceFileDelta = sourceFilesAfter.length - sourceFilesBefore.length;
  const exportStatementDelta = exportsAfter - exportsBefore;

  // Every entry here is a NET LOSS, and the list is exhaustive over the counted
  // quantities: a negative delta that has no entry would let the verdict say
  // "nothing was removed" directly above a count that says otherwise. Two rules
  // follow from that, and both favour UNDER-reporting:
  //   - a file that was removed while an equal number was added is a MOVE, not a
  //     deletion, so the net delta (not the per-path lists) decides;
  //   - an unresolved name is still a loss (`export {}` binds nothing to name),
  //     so it is reported as a count rather than dropped.
  const removals: string[] = [];
  if (removedExports.length > 0) {
    removals.push(`${String(removedExports.length)} export name(s)`);
  } else if (exportStatementDelta < 0) {
    removals.push(
      `${String(-exportStatementDelta)} export statement(s) (the removed names could not be resolved — an \`export {}\` list or a deleted module)`
    );
  }
  if (sourceFileDelta < 0) removals.push(`${String(-sourceFileDelta)} source file(s)`);
  if (testFileDelta < 0) removals.push(`${String(-testFileDelta)} test file(s)`);
  if (caseDelta < 0) {
    removals.push(
      `${String(-caseDelta)} test case declaration line(s) (\`it(\` / \`test(\` — a data-driven rewrite such as \`it.each(\` lowers this line count without losing a case, so confirm it is a loss before treating it as one)`
    );
  }

  const changed =
    addedExports.length +
    removedExports.length +
    Math.abs(sourceFileDelta) +
    Math.abs(testFileDelta) +
    Math.abs(caseDelta) +
    Math.abs(exportStatementDelta);

  const verdict =
    changed === 0
      ? `${PRE_POST_DIFF_VERDICT_MARKER}${PRE_POST_DIFF_NO_DRIFT} — the test file count, the test case count, the source file count, the top-level export statement count and the export name set are all IDENTICAL before and after.`
      : removals.length === 0
        ? `${PRE_POST_DIFF_VERDICT_MARKER}${PRE_POST_DIFF_ADDITIONS_ONLY} — the structural surface grew and nothing was removed; the deltas above are the whole change.`
        : `${PRE_POST_DIFF_VERDICT_MARKER}${PRE_POST_DIFF_DRIFT_DETECTED} — the following structural removals were detected: ${removals.join('; ')}. A removal is not automatically wrong, but it is exactly the "unintended drift" this dimension exists to catch: judge whether each removal was authorized by the approved scope.`;

  // The verdict is the FIRST thing in the file — above the metadata, the method
  // notes and the counts — because a consumer may legitimately receive only the
  // head of it (the per-file evidence cap) and, when it did, the head used to be
  // a comment block: every truncation deterministically dropped the conclusion,
  // so a truncated delivery could not be told from "nothing drifted". Putting
  // the conclusion first makes "the reviewer received the verdict" a fact the
  // bytes themselves can be asked about, and it costs nothing to read.
  const content = [
    '# Pre/post baseline diff — existing-functionality-intact',
    '#',
    '## Verdict',
    verdict,
    '',
    '# The verdict above is repeated nowhere: it is the file\'s conclusion. The method',
    '# and the raw counts it rests on follow, for a human who wants to check it.',
    '#',
    `# Base ref : ${base.label} (${base.ref})`,
    `# After    : working tree${headSha === '' ? ' (unborn HEAD)' : ` at HEAD ${headSha}`} — uncommitted changes included`,
    `# Generated: ${new Date().toISOString()}`,
    '#',
    '# METHOD — test surface',
    `#   Test files : the file lists from \`git ls-tree --full-tree <base>\` and`,
    `#                \`git ls-files -co --exclude-standard\` (working tree, untracked`,
    `#                files included), matched against ${TEST_FILE_GLOBS.join(', ')}.`,
    '#   Test cases : declaration lines matching `it(` / `test(`, MODIFIERS INCLUDED',
    '#                (`it.skip(`, `test.each(`, `test.concurrent(`...) — counted',
    '#                with `git grep -c` against the base tree, and by reading the',
    '#                working-tree files with the same expression.',
    '#',
    '# METHOD — public API surface (changed .ts / .tsx files only)',
    '#   Top-level `export` statements (lines anchored at column 0) are counted with',
    "#   `git grep -c` on both sides. The added/removed NAMES come from the changed",
    "#   lines of `git diff -U0 <base> -- '*.ts' '*.tsx'`, plus any untracked file",
    '#   read from disk. The FILE lists below cover non-test `.ts` / `.tsx` files.',
    '#',
    '# HONEST BOUNDARY',
    '#   Export detection is APPROXIMATE — a line-anchored regex, NOT a type checker.',
    '#   It detects a structural loss (an export that was removed or renamed). It',
    '#   CANNOT detect a changed signature, a narrowed type, or a behaviour change',
    '#   inside a function body. `export { a, b }` counts as ONE export statement.',
    '#   Type-only exports ARE counted, both spellings: `export type { T }` and',
    '#   `export { type T }` both bind `T`. Read this as a drift DETECTOR, not as',
    '#   proof that the API is unchanged.',
    '#   File DELETIONS are visible: a removed test file or a removed non-test',
    '#   `.ts` / `.tsx` module is reported from the file LISTS, independently of the',
    '#   counts — which a deleted module can leave unchanged (a module with no',
    '#   top-level `export ` line has no exports to lose, and no `it(` to lose',
    '#   either, so all four counts would have stayed identical). A path that was',
    '#   removed while an equal number of files was added is reported as the NET',
    '#   change only, so a `git mv` is not read as a deletion.',
    '#   Test-case counting is a LINE count of `it(` / `test(` declaration lines.',
    '#   The same expression is evaluated on both sides, so an occurrence inside a',
    '#   comment or a string literal is counted on BOTH sides and cancels out of the',
    '#   delta instead of skewing it. A data-driven `*.each(...)` line stands for',
    '#   many cases: folding several `it(` lines into one `.each(` line lowers the',
    '#   count without losing a case, so a case-count drop is a signal to inspect,',
    '#   not proof of a lost test.',
    '#   IDEMPOTENCE: two runs over the same base differ on exactly one line — the',
    '#   `Generated:` timestamp above. A wall-clock timestamp is not drift.',
    '',
    '## Test surface',
    `Test files: before ${String(testFilesBefore.length)}, after ${String(testFilesAfter.length)}, delta ${testFilesAfter.length - testFilesBefore.length >= 0 ? '+' : ''}${String(testFilesAfter.length - testFilesBefore.length)}`,
    `Test cases: before ${String(testCasesBefore)}, after ${String(testCasesAfter)}, delta ${caseDelta >= 0 ? '+' : ''}${String(caseDelta)}`,
    ...renderFileList('test files', addedTestFiles, removedTestFiles, testFileDelta),
    '',
    '## Public API surface (changed .ts / .tsx files only)',
    `Source files (non-test): before ${String(sourceFilesBefore.length)}, after ${String(sourceFilesAfter.length)}, delta ${sourceFileDelta >= 0 ? '+' : ''}${String(sourceFileDelta)}`,
    ...renderFileList('source files', addedSourceFiles, removedSourceFiles, sourceFileDelta),
    `Top-level export statements: before ${String(exportsBefore)}, after ${String(exportsAfter)}, delta ${exportStatementDelta >= 0 ? '+' : ''}${String(exportStatementDelta)}`,
    ...(addedExports.length === 0
      ? ['Added exports: none']
      : [`Added exports (${String(addedExports.length)}):`, renderNameList(addedExports, '+')]),
    ...(removedExports.length === 0
      ? ['Removed exports: none']
      : [
          `Removed exports (${String(removedExports.length)}):`,
          renderNameList(removedExports, '-')
        ]),
    ''
  ].join('\n');

  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `the baseline diff was computed but could not be written to ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      inGitWorkTree: true
    };
  }

  const summary =
    `Pre/post baseline diff ${base.label} (${base.ref.slice(0, 8)}) -> working tree: ` +
    `test files ${delta(testFilesBefore.length, testFilesAfter.length)}, ` +
    `test cases ${delta(testCasesBefore, testCasesAfter)}, ` +
    `non-test source files ${delta(sourceFilesBefore.length, sourceFilesAfter.length)}, ` +
    `top-level export statements ${delta(exportsBefore, exportsAfter)}, ` +
    `+${String(addedExports.length)} / -${String(removedExports.length)} export names. ` +
    (removals.length === 0 ? 'No structural removal detected.' : `Structural removals: ${removals.join('; ')}.`);

  return { status: 'computed', summary, relativePath, absolutePath, content };
}
