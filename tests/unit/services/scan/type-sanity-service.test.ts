/**
 * `src/services/scan/type-sanity-service.ts` — the changed-file classifier,
 * exercised through its public entry (`checkTypeSanity`).
 *
 * The classifier is private, and this slice adds no export (the module's public
 * surface is unchanged), so the entry is reached the way production reaches it:
 * a real git repository, read with `git diff --name-only` plus the untracked
 * list. The repository is a scratch one, but the paths handed to the classifier
 * are the REAL repository paths the defect was measured on — `src/services/test-cache/…`
 * and `src/services/dispatch/…`. The predicate's whole input is the path string,
 * so the thing under test is the real thing.
 *
 * Dimensions: behavior (path → category), integration (the git boundary and the
 * `.peaks/**` exclusion), render (the breakdown still reports the files, in a
 * category), a11y (the rationale names the counts it is claimed from).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkTypeSanity,
  type FileCategory,
  type TypeSanityReport
} from '../../../../src/services/scan/type-sanity-service.js';

const roots: string[] = [];

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
}

/** A scratch repository with one commit, so `HEAD` resolves and a diff exists. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-type-sanity-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/** A changed-but-uncommitted file at a given repository-relative path. */
function put(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'export const x = 1;\n', 'utf8');
}

/** The category a path landed in, or `undefined` when the report dropped it. */
function categoryOf(report: TypeSanityReport, path: string): FileCategory | undefined {
  for (const entry of report.breakdown) {
    if (entry.examples.includes(path)) return entry.category;
  }
  return undefined;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('Scenario: type-sanity — behavior, a path segment decides the category', () => {
  it('when a source file sits in a directory whose name merely begins with "test", should classify it source', () => {
    // given: the two REAL repository paths the defect was measured on — `\b`
    //        is satisfied by `-`, so a word-boundary test fires inside `test-cache`
    const root = makeRepo();
    put(root, 'src/services/test-cache/test-cache-service.ts');
    put(root, 'src/services/dispatch/test-tool-detection.ts');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  both are ordinary source files
    expect(categoryOf(report, 'src/services/test-cache/test-cache-service.ts')).toBe('source');
    expect(categoryOf(report, 'src/services/dispatch/test-tool-detection.ts')).toBe('source');
  });

  it('when a file sits under a tests/ directory, should still classify it test', () => {
    // given: a path whose only test signal is the `tests` SEGMENT — no `.test.`
    //        in the filename — so this arm isolates the directory test
    const root = makeRepo();
    put(root, 'tests/unit/services/plain-helper.ts');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  test — a classifier that answers "not a test" for everything does
    //        not pass this case
    expect(categoryOf(report, 'tests/unit/services/plain-helper.ts')).toBe('test');
  });

  it('when a filename carries the .test. convention, should classify it test', () => {
    // given: the filename arm, outside any test directory
    const root = makeRepo();
    put(root, 'src/services/thing.test.ts');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  test, as before
    expect(categoryOf(report, 'src/services/thing.test.ts')).toBe('test');
  });

  it('when the directory segment is `specs`, should classify it source and not test', () => {
    // given: the repository's own `docs/superpowers/specs/` shape — a directory
    //        that means "design documents", not "test specifications"
    //
    //        THE FIXTURE IS DELIBERATELY `.ts`, NOT MARKDOWN. The first version
    //        of this case used a `.md` fixture under the same directory, and it
    //        was INERT: `classifyFile` returns `docs` for a markdown extension
    //        BEFORE the test branch is reached, so no implementation of the test
    //        predicate could change the result — not even a loosened one. That
    //        is the same "a case that cannot fail" defect this whole slice is
    //        about, one level up, and it is why the fixture is a `.ts` path.
    const root = makeRepo();
    put(root, 'docs/superpowers/specs/helper.ts');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  source — the `spec` word is a PREFIX of the segment, not the segment,
    //        so an anchor loosened to drop its trailing separator must fail here
    expect(categoryOf(report, 'docs/superpowers/specs/helper.ts')).toBe('source');
  });
});

describe('Scenario: type-sanity — render, the breakdown still reports every file', () => {
  it('when a file is reclassified, should keep it in the breakdown under its new category', () => {
    // given: one reclassified source file and one real test file
    const root = makeRepo();
    put(root, 'src/services/test-cache/test-cache-service.ts');
    put(root, 'tests/unit/services/foo.test.ts');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  moving a file out of `test` must not drop it from the report
    expect(report.changedFiles).toContain('src/services/test-cache/test-cache-service.ts');
    expect(categoryOf(report, 'src/services/test-cache/test-cache-service.ts')).toBe('source');
    const testEntry = report.breakdown.find((entry) => entry.category === 'test');
    expect(testEntry?.examples).toContain('tests/unit/services/foo.test.ts');
  });
});

describe('Scenario: type-sanity — integration, the diff is what git reports', () => {
  it('when a file is committed and unchanged, should not appear as a changed file', () => {
    // given: a committed file that is not touched again
    const root = makeRepo();

    // when:  the changed files are classified against HEAD
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  the committed README is not part of the diff
    expect(report.gitAvailable).toBe(true);
    expect(report.changedFiles).not.toContain('README.md');
  });

  it('when a change lives under .peaks/**, should exclude it from the diff', () => {
    // given: an artifact-workspace file, which is never the "code change" a type describes
    const root = makeRepo();
    put(root, '.peaks/_runtime/session/rd/requests/001-thing.md');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'refactor' });

    // then:  excluded
    expect(report.changedFiles.some((path) => path.startsWith('.peaks/'))).toBe(false);
  });
});

describe('Scenario: type-sanity — a11y, the rationale says what it was computed from', () => {
  it('when the declared type disagrees, should name the counts and the types it suggests', () => {
    // given: a source-only change declared as docs
    const root = makeRepo();
    put(root, 'src/services/test-cache/test-cache-service.ts');

    // when:  the changed files are classified
    const report = checkTypeSanity({ projectRoot: root, declaredType: 'docs' });

    // then:  the disagreement is visible, and the summary counts the reclassified
    //        file as source — the number a human reads
    expect(report.consistent).toBe(false);
    expect(report.rationale).toContain('source=1');
    expect(report.rationale).toContain('suggested types:');
  });
});
