// tests/unit/lint/lint-scope-rule.test.ts
//
// Rid `2026-10-03-w10-rescope-a` — the single-source arms for
// `.husky/lint-scope.mjs`, the ONE editable spelling of the enforced lint scope
// (`src/**` + `packages/*/src/**`, owner decision 2026-10-03, backlog §2.42).
//
// WHAT EACH ARM ANSWERS FROM THE BRIEF:
//   - item 7, pattern not enumeration: a brand-new `packages/new-pkg/src/a.ts`
//     is in scope with NO constant edited anywhere, and `deriveScopeDirs` grows
//     its artifact dir automatically — the enumeration in the artifact is
//     derived, never typed;
//   - item 8, observed copies: `MEASURED_DIRS` (this `.mjs` module) and
//     `FILE_SIZE_SCOPE_DIRS` (the `.ts` policy the census walks) are the two
//     cross-language spellings of the MEASUREMENT universe. `.mjs` cannot import
//     `.ts` and the root tsconfig cannot type-import `.mjs`, so the copy is
//     deliberate and THIS arm is what observes it — the posture
//     `EXTENSIONS` / `FILE_SIZE_SCOPE_EXTENSIONS` already take;
//   - the shadow block's dir spelling (`shadowScopeDirs`) is pinned to the
//     populations the rescope actually created (tests, scripts, package
//     non-src), not to a typed list.
//
// Dimensions:
//   - behavior: the predicate, the derivation and the partition are pure
//   - integration: the real `.ts` policy module and the real tracked-file
//                  population are compared against the rule

import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { FILE_SIZE_SCOPE_DIRS } from '../../../src/services/scan/file-size-policy.js';

declareDimensions(
  'tests/unit/lint/lint-scope-rule.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module prints nothing; every sentence it feeds is asserted in the generator/gate process arms' },
    { dim: 'a11y', reason: 'no operator-facing output originates here' }
  ]
);

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

type LintScopeRule = {
  LINT_SCOPE_RULE: string;
  MEASURED_DIRS: readonly string[];
  isLintScoped(file: string): boolean;
  partitionLintScope(files: readonly string[]): { gated: string[]; shadow: string[] };
  deriveScopeDirs(gatedFiles: readonly string[]): string[];
  shadowScopeDirs(shadowFiles: readonly string[]): string[];
};

async function loadRule(): Promise<LintScopeRule> {
  return (await import(
    pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href
  )) as LintScopeRule;
}

describe('Scenario: behavior — the rule is a pattern, not an enumeration of package names', () => {
  it('names the two families it enforces and admits a brand-new package src without any edit', async () => {
    const rule = await loadRule();
    expect(rule.LINT_SCOPE_RULE).toBe('src/** + packages/*/src/**');
    expect(rule.isLintScoped('src/a.ts')).toBe(true);
    expect(rule.isLintScoped('packages/new-pkg/src/a.ts')).toBe(true);
    expect(rule.isLintScoped('packages/peaks-loop-mut/src/deep/x.ts')).toBe(true);
  });

  it('rejects every population the owner took out of the enforced view', async () => {
    const rule = await loadRule();
    for (const out of [
      'tests/unit/a.ts',
      'scripts/lint/run.mjs',
      'packages/peaks-loop-shared/tests/x.ts',
      'packages/peaks-loop-shared/vitest.config.ts',
      'packages/new-pkg/index.ts',
      '.husky/peaks-gate.mjs',
      'examples/demo.ts',
      'README.md'
    ]) {
      expect(rule.isLintScoped(out), out).toBe(false);
    }
  });

  it('Windows separators answer the same rule as POSIX ones', async () => {
    const rule = await loadRule();
    expect(rule.isLintScoped('packages\\new-pkg\\src\\a.ts')).toBe(true);
    expect(rule.isLintScoped('tests\\dirty.ts')).toBe(false);
  });

  it('derives the artifact scope.dirs from the gated population alone', async () => {
    const rule = await loadRule();
    expect(rule.deriveScopeDirs(['src/a.ts', 'packages/z/src/b.ts', 'packages/a/src/c.ts'])).toEqual([
      'packages/a/src',
      'packages/z/src',
      'src'
    ]);
    // A new package joins the enumeration because a file exists, not because a
    // constant was edited — item 7's derivation arm.
    const before = rule.deriveScopeDirs(['src/a.ts']);
    const after = rule.deriveScopeDirs(['src/a.ts', 'packages/new-pkg/src/a.ts']);
    expect(after).toEqual([...before, 'packages/new-pkg/src'].sort());
  });

  it('partitions a measured list with no overlap and no loss', async () => {
    const rule = await loadRule();
    const list = [
      'src/a.ts',
      'packages/p/src/b.ts',
      'packages/p/tests/c.ts',
      'tests/d.ts',
      'scripts/e.mjs',
      'packages/p/vitest.config.ts'
    ];
    const { gated, shadow } = rule.partitionLintScope(list);
    expect(gated).toEqual(['src/a.ts', 'packages/p/src/b.ts']);
    expect([...gated, ...shadow].sort()).toEqual([...list].sort());
  });

  it('names the shadow population by where it lives, packages at their parent dir', async () => {
    const rule = await loadRule();
    expect(
      rule.shadowScopeDirs([
        'tests/unit/a.ts',
        'scripts/lint/x.mjs',
        'packages/peaks-loop-mut/tests/a.ts',
        'packages/peaks-loop-mut/vitest.config.ts'
      ])
    ).toEqual(['packages/peaks-loop-mut', 'scripts', 'tests']);
  });
});

describe('Scenario: integration — the copies of the MEASUREMENT universe are observed', () => {
  it('MEASURED_DIRS equals the .ts policy FILE_SIZE_SCOPE_DIRS it mirrors', async () => {
    // `.husky/lint-scope.mjs` mirrors `src/services/scan/file-size-policy.ts`
    // across the `.mjs`/`.ts` boundary (the census cannot import the rule and
    // the rule cannot import the policy). This arm is the observer item 8 of
    // the slice brief demands — an unobserved copy is how §2.28 happened.
    const rule = await loadRule();
    expect([...rule.MEASURED_DIRS].sort()).toEqual([...FILE_SIZE_SCOPE_DIRS].sort());
  });

  it('every in-scope tracked file is inside the measurement universe, so no ceiling row can silently lose its population', async () => {
    const rule = await loadRule();
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true
    })
      .trim()
      .split('\n');
    for (const file of tracked.filter((f) => rule.isLintScoped(f))) {
      expect(
        rule.MEASURED_DIRS.some((d) => file.startsWith(`${d}/`)),
        file
      ).toBe(true);
    }
    // And the set is non-trivial — an empty loop above would pass vacuously.
    expect(tracked.filter((f) => rule.isLintScoped(f)).length).toBeGreaterThan(900);
  });
});
