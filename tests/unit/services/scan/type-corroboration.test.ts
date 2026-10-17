// tests/unit/services/scan/type-corroboration.test.ts
//
// `corroborateDeclaredType` — the narrow rule that a docs/chore/config request
// may not carry runtime source. It reuses `checkTypeSanity`'s enumeration but
// deliberately NOT its verdict table: the shipped checker calls `chore`
// inconsistent with scripts/tests too (measured in sc/probe-type-sanity.ts),
// which would refuse this repository's own infrastructure chores.
//
// Dimensions: behavior (the verdict per shape), integration (real git diffs,
// tracked and untracked, plus the non-repo boundary), render (the message names
// the offending paths), a11y (the remedy is actionable).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  checkTypeSanity,
  tryGitDiffFiles
} from '../../../../src/services/scan/type-sanity-service.js';
import { corroborateDeclaredType } from '../../../../src/services/scan/type-corroboration.js';
import type { RequestType } from '../../../../src/services/artifacts/artifact-prerequisites.js';

declareDimensions('tests/unit/services/scan/type-corroboration.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
}

/** A scratch repository with one commit, so `HEAD` resolves. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-type-corroboration-'));
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

/** A scratch directory that is NOT a git repository. */
function makeNonRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-type-corroboration-nogit-'));
  roots.push(root);
  return root;
}

function put(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'export const x = 1;\n', 'utf8');
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('Scenario: behavior — the declared type is corroborated against src/** only', () => {
  const SHAPES: ReadonlyArray<readonly [string, RequestType, string[], boolean]> = [
    ['chore + src', 'chore', ['src/x.ts'], false],
    ['chore + non-ASCII src', 'chore', ['src/é.ts'], false],
    ['chore + package src', 'chore', ['packages/peaks-loop-shared/src/index.ts'], false],
    ['chore + package non-src', 'chore', ['packages/peaks-loop-shared/README.md'], true],
    ['chore + scripts', 'chore', ['scripts/x.mjs'], true],
    ['chore + tests', 'chore', ['tests/unit/x.test.ts'], true],
    ['chore + husky', 'chore', ['.husky/x.mjs'], true],
    ['chore + lockfile', 'chore', ['pnpm-lock.yaml'], true],
    ['docs + docs', 'docs', ['docs/x.md'], true],
    ['docs + src', 'docs', ['src/x.ts'], false],
    ['config + package.json', 'config', ['package.json'], true],
    ['config + src', 'config', ['src/x.ts'], false],
    ['feature + src', 'feature', ['src/x.ts'], true],
    ['bugfix + src', 'bugfix', ['src/x.ts'], true],
    ['refactor + src', 'refactor', ['src/x.ts'], true]
  ];

  it.each(SHAPES)(
    'when %s, the verdict should match the rule',
    (_label, declaredType, paths, allowed) => {
      // given: a committed baseline and the shape's changed files
      const root = makeRepo();
      for (const path of paths) put(root, path);

      // when:  the declared type is corroborated against the diff
      const verdict = corroborateDeclaredType({ projectRoot: root, declaredType });

      // then:  src/** refuses; tooling paths and QA-bearing types pass
      expect(verdict.ok).toBe(allowed);
    }
  );
});

describe('Scenario: integration — the enumeration is git’s, both arms of it', () => {
  it('when a tracked src file is modified, should refuse a chore (diff arm, not only untracked)', () => {
    // given: a src file that exists in HEAD and is then edited in the working tree
    const root = makeRepo();
    put(root, 'src/tracked.ts');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'add tracked');
    writeFileSync(join(root, 'src/tracked.ts'), 'export const x = 2;\n', 'utf8');

    // when:  the diff is enumerated
    const verdict = corroborateDeclaredType({ projectRoot: root, declaredType: 'chore' });

    // then:  the tracked arm sees it
    expect(verdict.ok).toBe(false);
  });

  it('when a tracked path is modified under a nested project root, should judge it (--relative, tracked arm)', () => {
    // given: a repository whose PROJECT ROOT is a subdirectory, and a tracked
    //        src file there; without --relative the diff names it
    //        `apps/web/src/x.ts`, which no `src/` test matches
    const root = makeRepo();
    put(root, 'apps/web/src/tracked.ts');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'nested');
    writeFileSync(join(root, 'apps', 'web', 'src', 'tracked.ts'), 'export const x = 2;\n', 'utf8');

    // when:  the nested root is corroborated
    const verdict = corroborateDeclaredType({
      projectRoot: join(root, 'apps', 'web'),
      declaredType: 'chore'
    });

    // then:  refused — the two git arms are relative to the SAME root
    expect(verdict.ok).toBe(false);
  });

  it('when an untracked path sits under a nested project root, should judge it too', () => {
    // given: the untracked arm of the same boundary
    const root = makeRepo();
    put(root, 'apps/web/src/new.ts');

    // when:  the nested root is corroborated
    const verdict = corroborateDeclaredType({
      projectRoot: join(root, 'apps', 'web'),
      declaredType: 'chore'
    });

    // then:  refused
    expect(verdict.ok).toBe(false);
  });

  it('when only .peaks/** changed, should omit it from the shared enumeration', () => {
    // given: the artifact workspace, which the enumeration — not the src rule —
    //        is responsible for excluding
    const root = makeRepo();
    put(root, '.peaks/_runtime/session/rd/requests/001-thing.md');

    // when:  the shared enumeration is read
    const read = tryGitDiffFiles(root, 'HEAD');

    // then:  the exclusion is what drops it (this arm fails if it is removed)
    expect(read.ok).toBe(true);
    expect(read.files).toEqual([]);
  });

  it('when the path merely begins with "src", should not treat it as src/', () => {
    // given: `srcx/` is not `src/`
    const root = makeRepo();
    put(root, 'srcx/x.ts');

    // when:  a chore is corroborated
    const verdict = corroborateDeclaredType({ projectRoot: root, declaredType: 'chore' });

    // then:  allowed — the rule is the whole segment
    expect(verdict.ok).toBe(true);
  });
});

describe('Scenario: integration — an unreadable diff fails closed', () => {
  it('when the project root is not a git repository, should refuse rather than read "nothing changed"', () => {
    // given: a chore rid's project root that git cannot enumerate
    const root = makeNonRepo();

    // when:  the rule runs beside the shipped checker
    const verdict = corroborateDeclaredType({ projectRoot: root, declaredType: 'chore' });
    const shipped = checkTypeSanity({ projectRoot: root, declaredType: 'chore' });

    // then:  the gate refuses with its own kind, while the older checker fails OPEN
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.kind).toBe('diff-unavailable');
    expect(shipped.consistent).toBe(true);
  });
});

describe('Scenario: render — the refusal names the paths it found', () => {
  it('when a chore carries two src files, should name both in the message', () => {
    // given: two offending paths
    const root = makeRepo();
    put(root, 'src/a.ts');
    put(root, 'src/deep/b.ts');

    // when:  the rule refuses
    const verdict = corroborateDeclaredType({ projectRoot: root, declaredType: 'chore' });

    // then:  both paths travel in the message a human reads
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.message).toContain('src/a.ts');
    expect(verdict.message).toContain('src/deep/b.ts');
  });

  it('when git cannot enumerate, should distinguish "could not read" from "no changes"', () => {
    // given: a non-repository root
    const root = makeNonRepo();

    // when:  the rule refuses
    const verdict = corroborateDeclaredType({ projectRoot: root, declaredType: 'docs' });

    // then:  the message says the diff was unreadable, not that the tree was clean
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.message).toContain('could not');
    expect(verdict.message).toContain('fails closed');
    expect(verdict.message).not.toContain('no changes');
  });
});

describe('Scenario: a11y — the remedy is one a producer can act on', () => {
  it('when a docs rid touches src, should offer the QA-bearing types and the move', () => {
    // given: a docs request carrying runtime source
    const root = makeRepo();
    put(root, 'src/x.ts');

    // when:  it is refused
    const verdict = corroborateDeclaredType({ projectRoot: root, declaredType: 'docs' });

    // then:  both remedies are named
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.message).toContain('feature, bugfix or refactor');
    expect(verdict.message).toContain('move the change out of product source');
  });
});
