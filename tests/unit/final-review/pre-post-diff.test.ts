// tests/unit/final-review/pre-post-diff.test.ts
//
// The `pre-post-diff` producer — the evidence source that lets the 4th review
// dimension (`existing-functionality-intact`) be assessed at all.
//
// Before this slice, nothing in peaks-loop produced a pre/post baseline diff:
// the dimension was fed `rd/tech-doc.md` (design intent) and `prd/handoff.md`
// (approved scope), so `allPass === true` was unreachable by construction and
// the gate was permanently red. These tests pin the three states the producer
// can be in, and — the one that matters most — that "I could not compute a
// baseline" is NEVER answered with a fabricated empty diff or a `pass`.
//
// Every test here FAILS against the pre-change service: there was no producer,
// no `final-review/api-diff.txt`, no producer status block, and a model-supplied
// `pass` on that dimension survived untouched (see the inline notes).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractExportedNames,
  producePrePostDiff
} from '~/src/services/final-review/pre-post-diff';
import {
  prepareFinalReview,
  type LlmRunner
} from '~/src/services/final-review/final-review-service';

const RID = '2026-09-12-pre-post-diff-fixture';
const SESSION_ID = '2026-09-12-session-fixture';
const ARTIFACT_RELATIVE = `.peaks/_runtime/${SESSION_ID}/final-review/api-diff.txt`;

const REQUIRED = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
] as const;
type RequiredDimension = (typeof REQUIRED)[number];

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function write(root: string, relativePath: string, content: string): string {
  const file = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return file;
}

/** A temp git repo whose single commit is the baseline for every test below. */
function makeRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-pre-post-diff-'));
  tempRoots.push(root);
  git(root, ['init', '-q', '.']);
  git(root, ['config', 'user.email', 'fixture@peaks.local']);
  git(root, ['config', 'user.name', 'peaks fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  for (const [relativePath, content] of Object.entries(files)) write(root, relativePath, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'baseline']);
  return root;
}

/**
 * Commit more files on top of the baseline and return the BASELINE sha, so a
 * test can compare against a real ancestor instead of against `HEAD`.
 */
function commitMore(root: string, files: Readonly<Record<string, string>>): string {
  const baseline = git(root, ['rev-parse', 'HEAD']).trim();
  for (const [relativePath, content] of Object.entries(files)) write(root, relativePath, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'second']);
  return baseline;
}

function writeAuditGoal(root: string): void {
  write(
    root,
    `.peaks/_runtime/${SESSION_ID}/audit-goal/${RID}.json`,
    JSON.stringify({ successCriteria: ['AC1: the widget renders'] })
  );
}

function reviewJson(verdict: 'pass' | 'fail' | 'inconclusive'): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-09-12T00:00:00.000Z',
    dimensions: REQUIRED.map((dimension: RequiredDimension) => ({
      dimension,
      verdict,
      summary: `model summary for ${dimension}`,
      evidence: [{ kind: 'test-result', description: `${dimension} evidence` }],
      confidence: 'high'
    })),
    overallSummary: 'model overall summary',
    allPass: verdict === 'pass',
    needsAttention: []
  });
}

function captureRunner(output: string): { runner: LlmRunner; prompts: string[] } {
  const prompts: string[] = [];
  const runner: LlmRunner = {
    async call(_systemPrompt, userPrompt) {
      prompts.push(userPrompt);
      return { output, tokens: { input: 0, output: 0 } };
    }
  };
  return { runner, prompts };
}

describe('producePrePostDiff — a computable baseline', () => {
  it('writes the artifact with before/after counts, deltas, and the added/removed export names', () => {
    // FAILS BEFORE THE CHANGE: nothing in peaks-loop produced this file.
    const root = makeRepo({
      'src/a.ts': 'export const alpha = 1;\nexport const gamma = 2;\n',
      'tests/a.test.ts': "it('keep-one', () => {});\nit('keep-two', () => {});\n"
    });

    // The slice: one export removed, one added, one new test file with one case.
    write(root, 'src/a.ts', 'export const beta = 1;\nexport const gamma = 2;\n');
    write(root, 'tests/b.test.ts', "it('three', () => {});\n");

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;

    expect(result.relativePath).toBe(ARTIFACT_RELATIVE);
    expect(existsSync(join(root, ...ARTIFACT_RELATIVE.split('/')))).toBe(true);

    const artifact = readFileSync(result.absolutePath, 'utf8');
    // Before/after counts AND the delta, for both surfaces.
    expect(artifact).toContain('Test files: before 1, after 2, delta +1');
    expect(artifact).toContain('Test cases: before 2, after 3, delta +1');
    expect(artifact).toContain('Top-level export statements: before 2, after 2, delta +0');
    expect(artifact).toContain('+ tests/b.test.ts');
    // The name sets, so a reviewer sees WHICH symbol moved, not just a count.
    expect(artifact).toContain('+ beta (src/a.ts)');
    expect(artifact).toContain('- alpha (src/a.ts)');
    expect(artifact).toMatch(/VERDICT: STRUCTURAL DRIFT DETECTED/);
    expect(artifact).toContain('alpha (src/a.ts)');
    // The honesty boundary is part of the artifact, not only of the code.
    expect(artifact).toContain('APPROXIMATE');
    expect(artifact).toContain('CANNOT detect a changed signature');
  });

  it('feeds the dimension a real pre-post-diff evidence item so it can actually pass', async () => {
    // FAILS BEFORE THE CHANGE: the dimension could not reach `pass`, so
    // `allPass` was false even with every artifact on disk and a 4/4 pass.
    const root = makeRepo({
      'src/a.ts': 'export const alpha = 1;\n',
      'tests/a.test.ts': "it('keep-one', () => {});\n"
    });
    writeAuditGoal(root);
    // The nine pre-existing sources, so every dimension has evidence on disk.
    const markers: Readonly<Record<string, string>> = {
      [`qa/test-reports/${RID}.md`]: 'MARKER-QA-TEST-REPORT 1 file / 1 test passed',
      [`qa/test-cases/${RID}.md`]: 'MARKER-QA-TEST-CASES AC1 -> tests/a.test.ts',
      [`qa/security-findings-${RID}.md`]: 'MARKER-QA-SECURITY 0 findings',
      [`qa/performance-findings-${RID}.md`]: 'MARKER-QA-PERFORMANCE no regression',
      'rd/code-review.md': 'MARKER-RD-CODE-REVIEW 0 blockers',
      'rd/security-review.md': 'MARKER-RD-SECURITY-REVIEW 0 findings',
      'rd/tech-doc.md': 'MARKER-RD-TECH-DOC no public API change',
      'rd/bug-analysis.md': 'MARKER-RD-BUG-ANALYSIS original repro',
      'prd/handoff.md': 'MARKER-PRD-HANDOFF scope + non-goals'
    };
    for (const [relativePath, content] of Object.entries(markers)) {
      write(root, `.peaks/_runtime/${SESSION_ID}/${relativePath}`, content);
    }
    // A real working-tree change, so the diff is not a trivial "no drift".
    write(root, 'src/a.ts', 'export const alpha = 1;\nexport const beta = 2;\n');

    const { runner, prompts } = captureRunner(reviewJson('pass'));
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner,
      baseRef: 'HEAD'
    });

    const prompt = prompts[0] ?? '';
    expect(prompt).toContain('STATUS: COMPUTED');
    expect(prompt).toContain('final-review-pre-post-diff');
    expect(prompt).toContain('+ beta (src/a.ts)');

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    const diffEvidence = (dimension?.evidence ?? []).filter(item => item.kind === 'pre-post-diff');
    expect(diffEvidence).toHaveLength(1);
    expect(diffEvidence[0]?.artifact).toBe(ARTIFACT_RELATIVE);
    expect(diffEvidence[0]?.description).toContain('test files 1 -> 1');
    // The whole point: with a real baseline behind it, the dimension is no
    // longer structurally barred from `pass`.
    expect(dimension?.verdict).toBe('pass');
    expect(out.allPass).toBe(true);
  });
});

describe('producePrePostDiff — an uncomputable baseline', () => {
  it('reports why, writes no artifact, and keeps the dimension inconclusive in a real git work tree', async () => {
    // FAILS BEFORE THE CHANGE in the assertion that matters: `rd/tech-doc.md`
    // is a FOUND source for this dimension, so the pre-change service had
    // nothing that could stop a model-supplied `pass` from surviving.
    const root = makeRepo({ 'src/a.ts': 'export const alpha = 1;\n' });
    writeAuditGoal(root);
    // The ONLY other source backing this dimension — deliberately present, so
    // the downgrade can only be attributed to the pre/post-diff gate.
    write(
      root,
      `.peaks/_runtime/${SESSION_ID}/rd/tech-doc.md`,
      'MARKER-RD-TECH-DOC design intent, not a regression assessment'
    );

    // A single-commit repo with no upstream: origin/HEAD, origin/main and HEAD~1
    // all fail to resolve.
    const probe = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID });
    expect(probe.status).toBe('unavailable');
    if (probe.status !== 'unavailable') return;
    expect(probe.reason).toContain('no usable base ref');
    // F7 — the dead end names the way out instead of leaving the operator with
    // a permanently unavailable dimension and no stated remedy.
    expect(probe.reason).toContain('--base');
    expect(probe.inGitWorkTree).toBe(true);
    expect(existsSync(join(root, ...ARTIFACT_RELATIVE.split('/')))).toBe(false);

    const { runner, prompts } = captureRunner(reviewJson('pass'));
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = prompts[0] ?? '';
    expect(prompt).toContain('STATUS: UNAVAILABLE');
    expect(prompt).toContain('no usable base ref');
    expect(prompt).toContain('Do NOT report "pass"');

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.verdict).not.toBe('pass');
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).toContain('no usable base ref');
    // No fabricated evidence to make it look assessed.
    expect((dimension?.evidence ?? []).filter(item => item.kind === 'pre-post-diff')).toHaveLength(0);
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('existing-functionality-intact');
  });

  it('does not fabricate a diff for an unusable --base, and clears any stale artifact', () => {
    // FAILS BEFORE THE CHANGE: there was no `--base` handling and no artifact
    // lifecycle at all, so a stale file from an earlier run could be read as
    // this run's evidence.
    const root = makeRepo({ 'src/a.ts': 'export const alpha = 1;\n' });
    const stale = write(root, ARTIFACT_RELATIVE, 'VERDICT: NO STRUCTURAL DRIFT\n');

    const result = producePrePostDiff({
      projectRoot: root,
      sessionId: SESSION_ID,
      baseRef: 'no-such-ref-anywhere'
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toContain('no-such-ref-anywhere');
    expect(result.reason).toContain('does not resolve to a commit');
    expect(existsSync(stale)).toBe(false);
  });

  it('reports a non-git project as unavailable without pretending otherwise', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-pre-post-diff-plain-'));
    tempRoots.push(root);

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.inGitWorkTree).toBe(false);
    expect(result.reason).toContain('not inside a git work tree');
  });
});

describe('producePrePostDiff — no drift', () => {
  it('says so explicitly instead of writing an empty file or a silent pass', () => {
    // FAILS BEFORE THE CHANGE: the file did not exist.
    const root = makeRepo({
      'src/a.ts': 'export const alpha = 1;\nexport const gamma = 2;\n',
      'tests/a.test.ts': "it('keep-one', () => {});\n"
    });
    // A second commit that changes nothing structural, so the base is a real
    // ANCESTOR (a real range to compare) rather than `HEAD` — the latter being
    // the empty-range case, which is reported as unavailable (F8 below).
    const base = commitMore(root, { 'README.md': '# fixture\n' });

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: base });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    expect(artifact).toContain('VERDICT: NO STRUCTURAL DRIFT');
    expect(artifact).toContain('Test files: before 1, after 1, delta +0');
    expect(artifact).toContain('Test cases: before 1, after 1, delta +0');
    expect(artifact).toContain('Top-level export statements: before 2, after 2, delta +0');
    expect(artifact).toContain('Added exports: none');
    expect(artifact).toContain('Removed exports: none');
    // A "no drift" report has to be a report — not a zero-byte file that a
    // reader (or a model) can mistake for "nothing was checked".
    expect(artifact.length).toBeGreaterThan(500);
    expect(result.summary).toContain('No structural removal detected');
  });
});

describe('extractExportedNames — the approximate surface', () => {
  it('names the bindings of the declarations and re-export lists it can see', () => {
    expect(extractExportedNames('export const alpha = 1;')).toEqual(['alpha']);
    expect(extractExportedNames('export async function beta() {}')).toEqual(['beta']);
    expect(extractExportedNames('export interface Gamma {}')).toEqual(['Gamma']);
    expect(extractExportedNames('export { delta, epsilon as zeta };')).toEqual(['delta', 'zeta']);
    expect(extractExportedNames('export default function () {}')).toEqual(['default']);
    // F11 — the two TYPE-ONLY spellings must agree. FAILS BEFORE THE CHANGE:
    // `export type { T }` bound nothing while `export { type T }` bound `T`,
    // so the same construct was half-counted depending on how it was written.
    expect(extractExportedNames('export type { theta };')).toEqual(['theta']);
    expect(extractExportedNames('export { type iota, kappa };')).toEqual(['iota', 'kappa']);
    expect(extractExportedNames('export type Lambda = { a: 1 };')).toEqual(['Lambda']);
    // The boundary: an INDENTED export is not top-level, and `export *` binds
    // no name — both are deliberately invisible to the approximation.
    expect(extractExportedNames('  export const nested = 1;')).toEqual([]);
    expect(extractExportedNames("export * from './other.js';")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F4 / F5 — a deleted module must be visible, and a count that went DOWN must
// never be reported as "nothing was removed".
//
// The four counts were the ONLY structural facts the artifact reported, and a
// module can be deleted without moving any of them: a `.ts` file with no
// top-level `export ` line has no exports to lose, and no `it(` to lose either,
// so the measured result was "VERDICT: NO STRUCTURAL DRIFT" for a deletion.
//
// The mirror image was as bad: deleting a module holding `export {};` moved the
// export-statement count DOWN while the removals list stayed empty, so the same
// artifact printed "delta -1" and "ADDITIONS ONLY — nothing was removed" two
// lines apart.
// ---------------------------------------------------------------------------
describe('producePrePostDiff — a deletion is visible (F4) and never contradicted (F5)', () => {
  it('reports a deleted module that carried no export line and no test case (F4)', () => {
    // FAILS BEFORE THE CHANGE: all four counts are identical before and after,
    // so the producer wrote "VERDICT: NO STRUCTURAL DRIFT" for a deleted file.
    const root = makeRepo({
      'src/helper.ts': 'export { internal as helper };\nconst internal = 1;\n',
      'src/gone.ts': 'const privateThing = 1;\n'
    });
    rmSync(join(root, 'src', 'gone.ts'));

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    expect(artifact).toContain('Source files (non-test): before 2, after 1, delta -1');
    expect(artifact).toContain('Removed source files (1):');
    expect(artifact).toContain('- src/gone.ts');
    expect(artifact).toContain('1 source file(s)');
    expect(artifact).toContain('VERDICT: STRUCTURAL DRIFT DETECTED');
    expect(artifact).not.toContain('VERDICT: NO STRUCTURAL DRIFT');
    // The export surface really did not move — the deletion is caught by the
    // file list, which is the fact that does not depend on the counts.
    expect(artifact).toContain('Top-level export statements: before 1, after 1, delta +0');
    // And the blind spot the artifact used to have is stated inside it.
    expect(artifact).toContain('File DELETIONS are visible');
  });

  it('reports a count drop whose names cannot be resolved instead of "nothing was removed" (F5)', () => {
    // FAILS BEFORE THE CHANGE: the count went 2 -> 1 while `removedExports`
    // stayed empty (`export { }` binds no name), so the verdict read
    // "ADDITIONS ONLY — nothing was removed" directly under "delta -1".
    const root = makeRepo({ 'src/a.ts': 'export { };\nexport const alpha = 1;\n' });
    write(root, 'src/a.ts', 'export const alpha = 1;\n');

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    expect(artifact).toContain('Top-level export statements: before 2, after 1, delta -1');
    expect(artifact).toContain('Removed exports: none');
    // The contradiction is gone: a negative delta is reported as a removal even
    // when no name could be attached to it.
    expect(artifact).toContain('1 export statement(s) (the removed names could not be resolved');
    expect(artifact).toContain('VERDICT: STRUCTURAL DRIFT DETECTED');
    expect(artifact).not.toContain('ADDITIONS ONLY');
  });
});

// ---------------------------------------------------------------------------
// F6 — a structural REWRITE is not a removal.
//
// Three measured false positives: `export { a }` -> `export { a, b }` reported
// `a` as removed (the minus side of the diff was read alone); an `it(` ->
// `test.each(` rewrite reported its cases as removed (the modifier spelling was
// not counted on either side); and `git mv` of a test file reported "1 test
// file(s)" removed (per-path lists were used where the net delta is the fact).
//
// A false removal turns the gate red for a change that is not one — the same
// class of defect as a false pass, only louder. The direction chosen is to
// UNDER-report: an unresolved name is dropped, a move is not a deletion.
// ---------------------------------------------------------------------------
describe('producePrePostDiff — rewrites are not removals (F6)', () => {
  it('does not report a re-export list that merely grew', () => {
    const root = makeRepo({
      'src/a.ts': 'export { alpha };\nconst alpha = 1;\nconst beta = 2;\n'
    });
    write(root, 'src/a.ts', 'export { alpha, beta };\nconst alpha = 1;\nconst beta = 2;\n');

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    // FAILS BEFORE THE CHANGE: `-export { alpha }` alone bound `alpha`, so the
    // artifact listed `- alpha (src/a.ts)` and called it drift.
    expect(artifact).not.toContain('- alpha (src/a.ts)');
    expect(artifact).toContain('+ beta (src/a.ts)');
    expect(artifact).toContain('Removed exports: none');
    expect(artifact).not.toContain('VERDICT: STRUCTURAL DRIFT DETECTED');
  });

  it('does not report an `it(` -> `test.each(` rewrite as removed cases', () => {
    const root = makeRepo({
      'tests/a.test.ts': "it('one', () => {});\nit('two', () => {});\n"
    });
    write(
      root,
      'tests/a.test.ts',
      "test.each([1, 2])('case %i', () => {});\ntest.each([3])('case %i', () => {});\n"
    );

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    // FAILS BEFORE THE CHANGE: `test.each(` did not match the case expression,
    // so the after count was 0 and the artifact reported 2 cases REMOVED.
    expect(artifact).toContain('Test cases: before 2, after 2, delta +0');
    expect(artifact).not.toContain('test case declaration line(s)');
    expect(artifact).toContain('VERDICT: NO STRUCTURAL DRIFT');
  });

  it('does not report a moved test file as a removed one', () => {
    const root = makeRepo({ 'tests/a.test.ts': "it('one', () => {});\n" });
    git(root, ['mv', 'tests/a.test.ts', 'tests/renamed.test.ts']);

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    // FAILS BEFORE THE CHANGE: the old path was reported as a removed test
    // file and the new path as an addition — a rename read as a deletion.
    expect(artifact).not.toContain('Removed test files');
    expect(artifact).not.toContain('test file(s)');
    expect(artifact).toContain('VERDICT: NO STRUCTURAL DRIFT');
  });
});

// ---------------------------------------------------------------------------
// F10 — the case expression was not the same expression on both sides, and it
// missed every modifier spelling (`it.skip(`, `test.each(`) while counting
// occurrences inside comments and string literals. The fix counts the modified
// spellings on BOTH sides; what is in a comment still counts, but it counts
// identically on both sides, so it cancels out of the delta.
// ---------------------------------------------------------------------------
describe('producePrePostDiff — the case count is symmetric (F10)', () => {
  it('counts modifier spellings and a commented line the same way on both sides', () => {
    // FAILS BEFORE THE CHANGE: `it.skip(` and `test.each(` were invisible to
    // the old expression (before 2 / after 1), so a no-op edit reported a
    // removed case that never existed.
    const root = makeRepo({
      'tests/a.test.ts': "it('one', () => {});\nit.skip('two', () => {});\n// it('commented', () => {});\n"
    });
    write(
      root,
      'tests/a.test.ts',
      "test.each([1])('one %i', () => {});\nit.skip('two', () => {});\n// it('commented', () => {});\n"
    );

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });

    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const artifact = readFileSync(result.absolutePath, 'utf8');
    expect(artifact).toContain('Test cases: before 3, after 3, delta +0');
    expect(artifact).toContain('MODIFIERS INCLUDED');
    expect(artifact).not.toContain('test case declaration line(s)');
  });
});

// ---------------------------------------------------------------------------
// F7 / F8 — the two ways a baseline silently stops being a baseline: a base ref
// that cannot be resolved at all, and a base ref that resolves to HEAD (an
// EMPTY range, which is what a shallow clone's merge-base produces).
// ---------------------------------------------------------------------------
describe('producePrePostDiff — base resolution and empty ranges (F7 / F8)', () => {
  it('resolves origin/master when the default branch is not `main` (F7)', () => {
    const root = makeRepo({ 'src/a.ts': 'export const alpha = 1;\n' });
    const baseline = git(root, ['rev-parse', 'HEAD']).trim();
    // No origin/HEAD (a `clone --depth 1` writes none) and no origin/main (the
    // repository's default branch is `master`, still git's own default).
    git(root, ['update-ref', 'refs/remotes/origin/master', baseline]);
    commitMore(root, { 'src/a.ts': 'export const alpha = 1;\nexport const beta = 2;\n' });

    const result = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID });

    // FAILS BEFORE THE CHANGE: only origin/HEAD and origin/main were tried, so
    // this fell through to `HEAD~1` and the label was not the upstream branch.
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    expect(result.summary).toContain('origin/master');
    expect(readFileSync(result.absolutePath, 'utf8')).toContain('# Base ref : origin/master');
  });

  it('reports an empty range as unavailable instead of NO STRUCTURAL DRIFT (F8)', async () => {
    // FAILS BEFORE THE CHANGE: `--base HEAD` on an unchanged tree compares the
    // tree with itself, all four counts are trivially identical, and the
    // artifact said "NO STRUCTURAL DRIFT" — the same shape a shallow clone
    // whose merge-base IS HEAD produces on its DEFAULT path.
    const root = makeRepo({ 'src/a.ts': 'export const alpha = 1;\n' });
    writeAuditGoal(root);
    write(
      root,
      `.peaks/_runtime/${SESSION_ID}/rd/tech-doc.md`,
      'MARKER-RD-TECH-DOC design intent'
    );

    const probe = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: 'HEAD' });
    expect(probe.status).toBe('unavailable');
    if (probe.status !== 'unavailable') return;
    expect(probe.reason).toContain('no comparable range');
    expect(probe.reason).toContain('--base');
    expect(probe.inGitWorkTree).toBe(true);
    // No artifact: nothing may imply that a comparison happened.
    expect(existsSync(join(root, ...ARTIFACT_RELATIVE.split('/')))).toBe(false);

    // And the dimension cannot pass on it — the same rule as every other
    // missing baseline: not compared is not the same as no drift.
    const { runner, prompts } = captureRunner(reviewJson('pass'));
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner,
      baseRef: 'HEAD'
    });
    const prompt = prompts[0] ?? '';
    expect(prompt).toContain('no comparable range');
    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('inconclusive');
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('existing-functionality-intact');
  });
});

// ---------------------------------------------------------------------------
// F9 — idempotence. Two runs over the same base differ on exactly one line,
// the wall-clock timestamp, and the artifact says so: a reviewer comparing two
// runs must not read the timestamp line as drift.
// ---------------------------------------------------------------------------
describe('producePrePostDiff — the timestamp is not drift (F9)', () => {
  it('differs between two runs on exactly the `Generated:` line, and says so', () => {
    const root = makeRepo({
      'src/a.ts': 'export const alpha = 1;\n',
      'tests/a.test.ts': "it('one', () => {});\n"
    });
    // A real ancestor as the base, so the range is not empty (F8 above) while
    // the structural surfaces are identical.
    const base = commitMore(root, { 'README.md': '# fixture\n' });

    const first = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: base });
    const second = producePrePostDiff({ projectRoot: root, sessionId: SESSION_ID, baseRef: base });
    expect(first.status).toBe('computed');
    expect(second.status).toBe('computed');
    if (first.status !== 'computed' || second.status !== 'computed') return;

    // Both runs write the SAME artifact path, so the second overwrites the
    // first — compare the returned contents, not the file after the fact.
    const a = first.content.split('\n');
    const b = second.content.split('\n');
    expect(a).toHaveLength(b.length);
    const differing = a.filter((line, index) => line !== b[index]);
    expect(differing).toHaveLength(1);
    expect(differing[0]).toMatch(/^# Generated: /);
    // The claim is in the artifact, not only in this test.
    expect(a.join('\n')).toContain('IDEMPOTENCE');
    expect(a.join('\n')).toContain('not drift');
  });
});
