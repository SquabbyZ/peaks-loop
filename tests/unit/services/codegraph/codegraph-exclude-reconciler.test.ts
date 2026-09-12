// tests/unit/services/codegraph/codegraph-exclude-reconciler.test.ts
//
// Unit test for `src/services/codegraph/codegraph-exclude-reconciler.ts`
// (slice S1 of rid-2026-09-12-codegraph-exclude-integrity).
//
// The module answers: which git-tracked source files does the codegraph
// `exclude` list silently block, and which rules must be removed? It is
// split deliberately into a PURE core (`reconcileCodegraphExclude` +
// `matchesCodegraphGlob`) and a READ-ONLY adapter (`readTrackedFiles`,
// `readCodegraphExcludeConfig`, `reconcileCodegraphExcludeFromProject`).
// The adapter is the ONLY boundary under test (real fs + real git
// subprocess in the integration block); the pure core never spawns.
//
// The five rules pinned below are the real upstream-default rules that
// blocked 26 tracked files in this repo:
//   `**` + `/artifacts/**`, `**` + `/release/**`, `**` + `/vendor/**`,
//   `**` + `/bin/**`, `**` + `/publish/**`.
//
// Dimensions covered:
//   - render:      result-object shape, violation ordering, the
//                  violations-vs-excludedTrackedCount distinction
//   - behavior:    the 5 real rules, no-match, multi-rule files, nested
//                  dirs, include filtering, zero-match rules, idempotency,
//                  glob semantics (incl. the `artifactsman` lookalike)
//   - integration: real temp git work tree + real `.codegraph/config.json`
//                  through the read-only adapters; git-absent throws
//   - a11y:        thrown config errors name the file + field so an
//                  operator can fix the input without reading the source
//
// Not mocked: nothing. The glob matcher is ours, so it is asserted
// directly rather than diffed against picomatch at test time.
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-exclude-reconciler.test.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  matchesCodegraphGlob,
  readCodegraphExcludeConfig,
  readTrackedFiles,
  reconcileCodegraphExclude,
  reconcileCodegraphExcludeFromProject,
} from '../../../../src/services/codegraph/codegraph-exclude-reconciler.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-exclude-reconciler.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

// The include list upstream ships, trimmed to the extensions this repo
// actually uses. The reconciler must not care about the rest.
const INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];

const ARTIFACTS_RULE = `${'**'}/artifacts/${'**'}`;
const RELEASE_RULE = `${'**'}/release/${'**'}`;
const VENDOR_RULE = `${'**'}/vendor/${'**'}`;
const BIN_RULE = `${'**'}/bin/${'**'}`;
const PUBLISH_RULE = `${'**'}/publish/${'**'}`;

// Harmless defaults that must never be proposed for removal.
const HARMLESS_EXCLUDES = [`${'**'}/node_modules/${'**'}`, `${'**'}/dist/${'**'}`, `${'**'}/coverage/${'**'}`];

const REAL_RULES: ReadonlyArray<{ rule: string; blockedFile: string }> = [
  { rule: ARTIFACTS_RULE, blockedFile: 'src/services/artifacts/artifact-service.ts' },
  { rule: RELEASE_RULE, blockedFile: 'src/services/release/release-state.ts' },
  { rule: VENDOR_RULE, blockedFile: 'packages/peaks-loop-internal-runtime/src/vendor/claude-adapter.ts' },
  { rule: BIN_RULE, blockedFile: 'bin/peaks.js' },
  { rule: PUBLISH_RULE, blockedFile: 'tests/unit/publish/lockstep-three-packages.test.ts' },
];

const tempProjects: string[] = [];

afterEach(() => {
  while (tempProjects.length > 0) {
    const project = tempProjects.pop();
    if (project) {
      rmSync(project, { recursive: true, force: true });
    }
  }
});

// ── fixtures ────────────────────────────────────────────────────────

function runGit(project: string, args: string[]): void {
  execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

// Create a throwaway git work tree containing `files`, all committed.
function createGitProject(files: readonly string[]): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-cg-reconciler-'));
  tempProjects.push(project);

  for (const file of files) {
    const absolutePath = join(project, file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'export const fixture = 1;\n', 'utf8');
  }

  runGit(project, ['init']);
  runGit(project, ['add', '-A']);
  runGit(project, [
    '-c',
    'user.email=rd@example.test',
    '-c',
    'user.name=rd-fixture',
    'commit',
    '-m',
    'fixture',
    '--no-verify',
  ]);

  return project;
}

// Write `.codegraph/config.json` AFTER the commit so it stays untracked
// (it never appears in `git ls-files`, exactly as in a real checkout).
function writeCodegraphConfig(project: string, include: readonly string[], exclude: readonly string[]): void {
  mkdirSync(join(project, '.codegraph'), { recursive: true });
  writeFileSync(
    join(project, '.codegraph', 'config.json'),
    `${JSON.stringify({ version: 1, include, exclude }, null, 2)}\n`,
    'utf8',
  );
}

function reconcile(trackedFiles: readonly string[], exclude: readonly string[]) {
  return reconcileCodegraphExclude({ trackedFiles, include: INCLUDE, exclude });
}

// ── render ──────────────────────────────────────────────────────────

describe('Scenario: render — reconcile result shape', () => {
  it('returns exactly the four documented fields', () => {
    const result = reconcile(['src/services/artifacts/artifact-service.ts'], [ARTIFACTS_RULE, ...HARMLESS_EXCLUDES]);

    expect(Object.keys(result).sort()).toEqual([
      'excludedTrackedCount',
      'rulesToRemove',
      'trackedSourceCount',
      'violations',
    ]);
    expect(result.trackedSourceCount).toBe(1);
    expect(result.excludedTrackedCount).toBe(1);
    expect(result.rulesToRemove).toEqual([ARTIFACTS_RULE]);
    expect(result.violations).toEqual([
      { path: 'src/services/artifacts/artifact-service.ts', matchedRule: ARTIFACTS_RULE },
    ]);
  });

  it('reports one violation entry per (file, rule) pair but counts distinct files', () => {
    const result = reconcile(
      ['src/services/artifacts/nested/artifact-service.ts'],
      [ARTIFACTS_RULE, `${'**'}/nested/${'**'}`, ...HARMLESS_EXCLUDES],
    );

    expect(result.violations).toHaveLength(2);
    expect(result.excludedTrackedCount).toBe(1);
    expect(result.violations.map((violation) => violation.matchedRule)).toEqual([
      ARTIFACTS_RULE,
      `${'**'}/nested/${'**'}`,
    ]);
  });

  it('keeps rulesToRemove in original config order regardless of match order', () => {
    const result = reconcile(
      ['bin/peaks.js', 'src/services/release/release-state.ts'],
      [RELEASE_RULE, ...HARMLESS_EXCLUDES, BIN_RULE],
    );

    expect(result.rulesToRemove).toEqual([RELEASE_RULE, BIN_RULE]);
  });
});

// ── behavior ────────────────────────────────────────────────────────

describe('Scenario: behavior — glob semantics match upstream picomatch', () => {
  it('matches a directory-name rule against nested source at any depth', () => {
    expect(matchesCodegraphGlob('src/services/artifacts/foo.ts', ARTIFACTS_RULE)).toBe(true);
    expect(matchesCodegraphGlob('artifacts/foo.ts', ARTIFACTS_RULE)).toBe(true);
    expect(matchesCodegraphGlob('a/b/c/artifacts/d/e/foo.ts', ARTIFACTS_RULE)).toBe(true);
  });

  it('does not match a directory whose name merely starts with the rule name', () => {
    expect(matchesCodegraphGlob('src/artifactsman/foo.ts', ARTIFACTS_RULE)).toBe(false);
    expect(matchesCodegraphGlob('src/services/release-notes/foo.ts', RELEASE_RULE)).toBe(false);
    expect(matchesCodegraphGlob('binned/peaks.js', BIN_RULE)).toBe(false);
  });

  it('matches a mid-path ** against zero or more whole segments', () => {
    expect(matchesCodegraphGlob('a/b', 'a/**/b')).toBe(true);
    expect(matchesCodegraphGlob('a/x/b', 'a/**/b')).toBe(true);
  });

  it('supports * and ? inside a segment without crossing separators', () => {
    expect(matchesCodegraphGlob('src/cmake-build-debug/a.ts', `${'**'}/cmake-build-*/${'**'}`)).toBe(true);
    expect(matchesCodegraphGlob('src/cmake-buildx/a.ts', `${'**'}/cmake-build-*/${'**'}`)).toBe(false);
    expect(matchesCodegraphGlob('foo.ts', `${'**'}/*.ts`)).toBe(true);
    expect(matchesCodegraphGlob('src/a/foo.ts', `${'**'}/*.ts`)).toBe(true);
    expect(matchesCodegraphGlob('a1.ts', `${'**'}/a?.ts`)).toBe(true);
    expect(matchesCodegraphGlob('a12.ts', `${'**'}/a?.ts`)).toBe(false);
  });

  it('treats a bare ** as matching every path', () => {
    expect(matchesCodegraphGlob('a', `${'**'}`)).toBe(true);
    expect(matchesCodegraphGlob('src/a/b.ts', `${'**'}`)).toBe(true);
  });

  it('treats a literal dot as a literal, not a wildcard', () => {
    expect(matchesCodegraphGlob('x/aminjs', `${'**'}/*.min.js`)).toBe(false);
    expect(matchesCodegraphGlob('x/a.min.js', `${'**'}/*.min.js`)).toBe(true);
  });

  it('supports EXTENDED glob syntax — braces, character classes, negation', () => {
    // Regression (repair round M2). This module used to hand-roll the
    // matcher and understood only `**`, `*` and `?`; every extended glob
    // quietly evaluated to `false`. A config carrying
    // `**` + `/{release,artifacts}/**` therefore reconciled as CLEAN while
    // the tracked files it blocked stayed out of the index — `init` and
    // `repair-exclude` reported success over a gap they could not see,
    // which is the exact failure this whole mechanism exists to prevent.
    // The matcher is picomatch now, so upstream's vocabulary is ours.
    const braceRule = `${'**'}/{release,artifacts}/${'**'}`;
    expect(matchesCodegraphGlob('src/services/release/a.ts', braceRule)).toBe(true);
    expect(matchesCodegraphGlob('src/services/artifacts/a.ts', braceRule)).toBe(true);
    expect(matchesCodegraphGlob('src/services/other/a.ts', braceRule)).toBe(false);

    expect(matchesCodegraphGlob('src/a.ts', `${'**'}/[ab].ts`)).toBe(true);
    expect(matchesCodegraphGlob('src/c.ts', `${'**'}/[ab].ts`)).toBe(false);

    expect(matchesCodegraphGlob('src/a.ts', `${'**'}/!(skip).ts`)).toBe(true);
    expect(matchesCodegraphGlob('src/skip.ts', `${'**'}/!(skip).ts`)).toBe(false);
  });

  it('handles a pathological run of `**/` without superlinear blow-up', () => {
    // Regression (repair round M3). The hand-rolled translator turned
    // each `**/` into `(?:[^/]+/)*`, so a run of them compiled to nested
    // quantifiers that backtrack catastrophically against a NON-matching
    // path: measured 1.6 ms at n=10, 105 ms at n=20, 606 ms at n=26 and
    // ~2.4 s at n=30, doubling every two extra segments. picomatch parses
    // the glob once and answers in ~0.01 ms at every n.
    //
    // The budget is deliberately enormous — 1000 ms against a real cost
    // of ~0.01 ms — so this can only fail on a genuine return to
    // exponential backtracking, never on a slow CI box.
    const pattern = `${'**/'.repeat(30)}x`;

    const started = performance.now();
    expect(matchesCodegraphGlob('src/a/b/c/d/e/f/g.ts', pattern)).toBe(false);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1000);
  });
});

describe('Scenario: behavior — the five real upstream default rules', () => {
  it.each(REAL_RULES)('flags tracked source blocked by $rule', ({ rule, blockedFile }) => {
    const result = reconcile([blockedFile], [rule, ...HARMLESS_EXCLUDES]);

    expect(result.violations).toEqual([{ path: blockedFile, matchedRule: rule }]);
    expect(result.rulesToRemove).toEqual([rule]);
    expect(result.excludedTrackedCount).toBe(1);
  });

  it('flags all five at once without touching the harmless defaults', () => {
    const result = reconcile(
      REAL_RULES.map((entry) => entry.blockedFile),
      [...REAL_RULES.map((entry) => entry.rule), ...HARMLESS_EXCLUDES],
    );

    expect(result.trackedSourceCount).toBe(5);
    expect(result.excludedTrackedCount).toBe(5);
    expect(result.rulesToRemove).toEqual(REAL_RULES.map((entry) => entry.rule));
  });

  it('flags an EXTENDED glob rule instead of reporting a clean project', () => {
    // The end-to-end form of the M2 regression: with the hand-rolled
    // matcher this returned `rulesToRemove: []` — a false all-clear that
    // `init` / `repair-exclude` would have acted on by doing nothing.
    const braceRule = `${'**'}/{release,artifacts}/${'**'}`;
    const result = reconcile(
      ['src/services/artifacts/a.ts', 'src/services/release/a.ts', 'src/services/other/a.ts'],
      [braceRule, ...HARMLESS_EXCLUDES],
    );

    expect(result.excludedTrackedCount).toBe(2);
    expect(result.violations).toEqual([
      { path: 'src/services/artifacts/a.ts', matchedRule: braceRule },
      { path: 'src/services/release/a.ts', matchedRule: braceRule },
    ]);
    expect(result.rulesToRemove).toEqual([braceRule]);
  });
});

describe('Scenario: behavior — false-positive guards', () => {
  it('reports nothing when no exclude rule blocks a tracked source file', () => {
    const result = reconcile(['src/index.ts', 'src/deep/nested/module.ts'], HARMLESS_EXCLUDES);

    expect(result.violations).toEqual([]);
    expect(result.rulesToRemove).toEqual([]);
    expect(result.trackedSourceCount).toBe(2);
    expect(result.excludedTrackedCount).toBe(0);
  });

  it('never proposes removing a rule that blocks zero tracked source files', () => {
    // `bin` matches nothing here, so it must survive even though the same
    // config blocks a real artifacts file.
    const result = reconcile(['src/services/artifacts/foo.ts'], [ARTIFACTS_RULE, BIN_RULE, ...HARMLESS_EXCLUDES]);

    expect(result.rulesToRemove).toEqual([ARTIFACTS_RULE]);
    expect(result.rulesToRemove).not.toContain(BIN_RULE);
  });

  it('ignores excluded tracked files the include list does not cover', () => {
    // `docs/publish/guide.md` is blocked by the publish rule AND tracked,
    // but markdown is not in `include`, so codegraph would never index it
    // anyway — that is not a violation and the rule is not removed.
    const result = reconcile(['docs/publish/guide.md'], [PUBLISH_RULE, ...HARMLESS_EXCLUDES]);

    expect(result.violations).toEqual([]);
    expect(result.rulesToRemove).toEqual([]);
    expect(result.trackedSourceCount).toBe(0);
  });

  it('normalizes Windows separators before matching', () => {
    const backslashPath = 'src\\services\\artifacts\\artifact-service.ts';
    const result = reconcile([backslashPath], [ARTIFACTS_RULE]);

    expect(result.violations).toEqual([
      { path: 'src/services/artifacts/artifact-service.ts', matchedRule: ARTIFACTS_RULE },
    ]);
  });
});

describe('Scenario: behavior — an unmatchable rule never masks a real gap', () => {
  // Regression, introduced by the commit that delegated matching to
  // picomatch: `picomatch('')` THROWS ("Expected pattern to be a
  // non-empty string"), so a config carrying `"exclude": [""]` aborted
  // the whole reconciliation. `peaks codegraph status` degraded that
  // throw to `[WARN] codegraph exclude integrity not evaluated` while
  // leaving the exit code at 0 — tracked source files stayed excluded
  // and the check reported success, the exact silent false pass this
  // module exists to prevent. Every case below throws (or reports the
  // wrong verdict) on the pre-fix code.
  it('does not throw on an empty exclude rule and still reports the real one', () => {
    const result = reconcile(
      ['src/services/artifacts/foo.ts', 'src/index.ts'],
      ['', ARTIFACTS_RULE, ...HARMLESS_EXCLUDES],
    );

    expect(result.trackedSourceCount).toBe(2);
    expect(result.excludedTrackedCount).toBe(1);
    expect(result.violations).toEqual([
      { path: 'src/services/artifacts/foo.ts', matchedRule: ARTIFACTS_RULE },
    ]);
    expect(result.rulesToRemove).toEqual([ARTIFACTS_RULE]);
  });

  it('never proposes removing the unmatchable rule itself', () => {
    const result = reconcile(['src/index.ts'], ['', '   ', ...HARMLESS_EXCLUDES]);

    expect(result.violations).toEqual([]);
    expect(result.rulesToRemove).toEqual([]);
    expect(result.trackedSourceCount).toBe(1);
  });

  it('treats a whitespace-only rule as a no-op instead of a finding', () => {
    // `picomatch('   ')` never threw — it simply matches no real path —
    // so this verdict already held pre-fix and holds post-fix. It is
    // pinned here as an over-correction guard: a fix that started
    // treating whitespace as a finding, or as a rule to remove, would
    // turn a harmless config into a reported one.
    const result = reconcile(['src/services/artifacts/foo.ts', 'src/index.ts'], ['   ', ARTIFACTS_RULE]);

    expect(result.excludedTrackedCount).toBe(1);
    expect(result.rulesToRemove).toEqual([ARTIFACTS_RULE]);
  });

  it('does not throw when the include list carries an empty rule', () => {
    // An empty include entry admits nothing — the same verdict as an
    // explicitly empty include list, and never a crash.
    const result = reconcileCodegraphExclude({
      trackedFiles: ['src/index.ts'],
      include: [''],
      exclude: [ARTIFACTS_RULE],
    });

    expect(result.trackedSourceCount).toBe(0);
    expect(result.excludedTrackedCount).toBe(0);
    expect(result.rulesToRemove).toEqual([]);
  });

  it('answers false from the exported matcher instead of throwing', () => {
    expect(matchesCodegraphGlob('src/a.ts', '')).toBe(false);
    expect(matchesCodegraphGlob('src/a.ts', '   ')).toBe(false);
  });
});

describe('Scenario: behavior — idempotency', () => {
  it('returns an empty rulesToRemove on a second pass over the repaired config', () => {
    const trackedFiles = [...REAL_RULES.map((entry) => entry.blockedFile), 'src/index.ts'];
    const exclude = [...REAL_RULES.map((entry) => entry.rule), ...HARMLESS_EXCLUDES];

    const first = reconcile(trackedFiles, exclude);
    expect(first.rulesToRemove).toHaveLength(5);

    const repaired = exclude.filter((rule) => !first.rulesToRemove.includes(rule));
    const second = reconcile(trackedFiles, repaired);

    expect(second.rulesToRemove).toEqual([]);
    expect(second.violations).toEqual([]);
    expect(second.excludedTrackedCount).toBe(0);
    expect(second.trackedSourceCount).toBe(first.trackedSourceCount);
    // The harmless defaults survive the repair untouched.
    expect(repaired).toEqual(HARMLESS_EXCLUDES);
  });
});

// ── integration ─────────────────────────────────────────────────────

describe('Scenario: integration — read-only adapters against a real git work tree', () => {
  it('reads tracked files from git and ignores untracked ones', () => {
    const project = createGitProject(['src/services/artifacts/artifact-service.ts', 'bin/peaks.js']);
    writeFileSync(join(project, 'untracked.ts'), 'export const x = 1;\n', 'utf8');

    expect([...readTrackedFiles(project)].sort()).toEqual([
      'bin/peaks.js',
      'src/services/artifacts/artifact-service.ts',
    ]);
  });

  it('reconciles a real project from disk and is idempotent end to end', () => {
    const project = createGitProject([
      'src/services/artifacts/artifact-service.ts',
      'src/services/release/release-state.ts',
      'bin/peaks.js',
      'src/index.ts',
    ]);
    const exclude = [ARTIFACTS_RULE, RELEASE_RULE, BIN_RULE, ...HARMLESS_EXCLUDES];
    writeCodegraphConfig(project, INCLUDE, exclude);

    const readBack = readCodegraphExcludeConfig(project);
    expect(readBack.include).toEqual(INCLUDE);
    expect(readBack.exclude).toEqual(exclude);

    const first = reconcileCodegraphExcludeFromProject(project);
    expect(first.trackedSourceCount).toBe(4);
    expect(first.excludedTrackedCount).toBe(3);
    expect(first.rulesToRemove).toEqual([ARTIFACTS_RULE, RELEASE_RULE, BIN_RULE]);

    writeCodegraphConfig(
      project,
      INCLUDE,
      exclude.filter((rule) => !first.rulesToRemove.includes(rule)),
    );
    const second = reconcileCodegraphExcludeFromProject(project);
    expect(second.rulesToRemove).toEqual([]);
    expect(second.excludedTrackedCount).toBe(0);
  });

  it('reports the real upstream default template as the source of the defect', () => {
    // A fresh clone gets the full 99-entry default template back because
    // `.codegraph/` is gitignored — this is the scenario the reconciler
    // exists to catch. The five offending rules are represented here by
    // their real strings.
    const project = createGitProject(['src/services/artifacts/artifact-service.ts']);
    writeCodegraphConfig(project, INCLUDE, [
      ...HARMLESS_EXCLUDES,
      ARTIFACTS_RULE,
      RELEASE_RULE,
      VENDOR_RULE,
      BIN_RULE,
      PUBLISH_RULE,
    ]);

    const result = reconcileCodegraphExcludeFromProject(project);

    expect(result.violations.map((violation) => violation.matchedRule)).toEqual([ARTIFACTS_RULE]);
    expect(result.rulesToRemove).toEqual([ARTIFACTS_RULE]);
  });

  it('throws (never silently returns []) when the project is not a git work tree', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-cg-nogit-'));
    tempProjects.push(project);

    expect(() => readTrackedFiles(project)).toThrow();
  });

  it('throws when `.codegraph/config.json` is absent', () => {
    const project = createGitProject(['src/index.ts']);

    expect(() => readCodegraphExcludeConfig(project)).toThrow();
  });
});

// ── a11y ────────────────────────────────────────────────────────────

describe('Scenario: a11y — failures name the file and the field', () => {
  it('names the config path and the offending field when `exclude` is not a string array', () => {
    const project = createGitProject(['src/index.ts']);
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(
      join(project, '.codegraph', 'config.json'),
      JSON.stringify({ include: INCLUDE, exclude: ['ok.ts', 42] }),
      'utf8',
    );

    expect(() => readCodegraphExcludeConfig(project)).toThrow(/config\.json/);
    expect(() => readCodegraphExcludeConfig(project)).toThrow(/"exclude" must be an array of strings/);
  });

  it('rejects a config that is not a JSON object at all', () => {
    const project = createGitProject(['src/index.ts']);
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(join(project, '.codegraph', 'config.json'), '"not-an-object"', 'utf8');

    expect(() => readCodegraphExcludeConfig(project)).toThrow(/expected a JSON object/);
  });

  it('names the field when `include` is missing entirely', () => {
    const project = createGitProject(['src/index.ts']);
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(join(project, '.codegraph', 'config.json'), JSON.stringify({ exclude: [] }), 'utf8');

    expect(() => readCodegraphExcludeConfig(project)).toThrow(/"include" must be an array of strings/);
  });

  it('surfaces the literal config rule string so an operator can grep it', () => {
    const result = reconcile(['bin/peaks.js'], [BIN_RULE]);

    expect(result.violations[0]?.matchedRule).toBe(BIN_RULE);
    expect(result.rulesToRemove[0]).toBe(BIN_RULE);
  });
});
