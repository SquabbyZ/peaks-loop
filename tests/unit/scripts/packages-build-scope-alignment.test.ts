// tests/unit/scripts/packages-build-scope-alignment.test.ts
//
// THE ALIGNMENT BETWEEN TWO RULES, MEASURED ON BOTH SIDES.
// `scripts/packages-build-prerequisite.mjs`'s `listPackageRoots` drops a package
// whose `src/` holds no `.ts`, and `scripts/check-build-integrity.mjs` skips the
// same packages by its own test. A docblock in the guard ASSERTED that the two
// agreed while the code held a TOP-LEVEL `readdirSync(src).length`: the rules
// agreed on a literally empty `src/` and diverged on a `src/` holding entries
// and no `.ts` anywhere under it — `src/services/` left behind after its sources
// were deleted. QA cycle 1 measured the cost of that divergence: the package was
// walked, recorded with `fileCount: 0`, and read `fresh` over a `dist/` built
// from sources that no longer existed, while the gate printed
// `build-integrity: OK`.
//
// So the claim is not re-asserted here, it is checked — and the shape of the
// check is the point. Every case runs `listPackageRoots` AND a copy of the gate
// over the SAME tree, in the same case, because a claim of alignment is a claim
// about two rules and the failure it exists to prevent is a file that is
// self-consistent and wrong. Reading only the guard is what let the divergence
// outlive the docblock that denied it.
//
// WHY THE GATE IS RUN AS A COPY, exactly as in `check-build-integrity.test.ts`:
// it has no exports, runs its loop at import time and `process.exit(1)`s, and it
// derives its root from its own location — so it can be neither imported nor
// pointed at a fixture. Copying its bytes to `<root>/scripts/` makes that
// fixture the root it walks, and the copy is taken at RUN TIME from the shipped
// file, so no arm can drift from the gate text it is asserting.
//
// Both directions are pinned, because a drop that over-reaches is the same
// defect mirrored: the first case pins the shapes that hold no `.ts` (an entry
// with none under it, and a `.d.ts`-only `src/`, which is the second half of the
// same predicate), and the second pins the nested-only source that must STILL be
// walked — slice 1's fix, whose gate side is measured here rather than assumed.
//
// What reddens these arms: put the drop back to its top-level form
// (`readdirSync(join(pkg.root, 'src')).length > 0`) in
// `scripts/packages-build-prerequisite.mjs`, or drop the `.d.ts` exclusion from
// it. Each is one half of the predicate the arms check.
//
// Dimensions: `render` is omitted — the gate renders only its `OK` line, and
// these arms assert the verdict behind it, not its rendering.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ensurePackagesBuilt,
  evaluatePackages,
  listPackageRoots,
  writePackageDistStamps
} from '../../../scripts/packages-build-prerequisite.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BUILT,
  fixture,
  nestedOnlyFixture,
  REPO_ROOT,
  SOURCE_A,
  writeBuilt
} from '../_setup/packages-build-fixture.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/scripts/packages-build-scope-alignment.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the gate renders only its `OK` line; these arms assert the verdict behind it, not the rendering'
    }
  ]
);

/** A declaration sibling. The gate reads only its EXISTENCE (its rule 3). */
const DECLARATION = 'export declare const a: 1;\n';

/** What a `src/` is left holding once the sources in it have been deleted. */
const LEFTOVER = 'the sources in this directory were deleted\n';

/**
 * An ordinary package `a` beside the two shapes that hold no `.ts` under
 * `src/`: one still holding an ENTRY (`src/services/README.md` — what a deleted
 * source tree leaves behind, and the shape the top-level listing walked), and
 * one holding only a `.d.ts`, which the gate's filter excludes and a listing
 * cannot tell from a source.
 */
function scopeTree(): string {
  const root = fixture({ a: SOURCE_A });
  mkdirSync(join(root, 'packages', 'leftover', 'src', 'services'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'leftover', 'src', 'services', 'README.md'),
    LEFTOVER,
    'utf8'
  );
  mkdirSync(join(root, 'packages', 'declaration-only', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'declaration-only', 'src', 'index.d.ts'),
    DECLARATION,
    'utf8'
  );
  return root;
}

/**
 * The gate's own bytes at `<root>/scripts/check-build-integrity.mjs`, so the
 * root it derives from its own location is `root` — the fixture, not this
 * repository.
 */
function copyGate(root: string): string {
  const target = join(root, 'scripts', 'check-build-integrity.mjs');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'scripts', 'check-build-integrity.mjs'), target);
  return target;
}

/**
 * Run a gate copy. `cwd` is deliberately NOT set: the gate derives its root from
 * its own location, so an arm that only passed from one working directory would
 * be pinning the wrong thing.
 */
function runGate(gate: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [gate], { encoding: 'utf8', windowsHide: true });
}

// ── behavior: the predicate, in both directions ──────────────────────

describe('Scenario: behavior — the drop is the gate rule, in both directions', () => {
  it('when src/ holds entries but no .ts, should leave the package in no bucket at all', () => {
    // given: an ordinary package beside one whose `src/` still holds an entry and no `.ts` anywhere, and one holding only a `.d.ts`
    // when: the walk enumerates the root and the verdict classifies every package
    // then: only the ordinary package is walked, and the other two are in no bucket — never missing, never stale, never vouched for
    const root = scopeTree();
    for (const name of ['a', 'leftover', 'declaration-only']) writeBuilt(root, name);
    writePackageDistStamps(root);

    expect(listPackageRoots(root).map((pkg) => pkg.name)).toEqual(['a']);
    // The control half: `a` is `fresh`, so the exclusions above cannot be a walk
    // or a stamp file that was broken for every package at once — and the
    // `leftover` package's own `dist/` is untouched, which is exactly what the
    // top-level listing used to read `fresh` over.
    expect(evaluatePackages(root)).toEqual({ missing: [], stale: [], fresh: ['a'] });
  });

  it('when the only .ts source sits one directory down, should still walk the package', () => {
    // given: a package whose entire source tree is nested under `src/sub/`, with nothing above it
    // when: the walk enumerates the root
    // then: it is walked, because this walk recurses exactly as the gate`s `listTsSources` does — the drop must not over-reach the other way
    const root = nestedOnlyFixture();

    expect(listPackageRoots(root).map((pkg) => pkg.name)).toEqual(['a']);
  });
});

// ── integration: the gate, executed over the same trees ──────────────

describe('Scenario: integration — the gate skips and walks by the same predicate', () => {
  it(
    'when a package holds no .ts under src/, should skip it and walk it once one appears',
    () => {
      // given: a package holding a `src/services/README.md` and a `dist/` the gate would call an ORPHAN if it walked it
      // when: the gate is run, and then run again after one `.ts` is added to that same `src/`
      // then: exit 0 first — the SKIP, not a gate blind to orphans — and exit 1 after, so both rules move on one predicate
      const root = fixture({});
      mkdirSync(join(root, 'packages', 'a', 'src', 'services'), { recursive: true });
      mkdirSync(join(root, 'packages', 'a', 'dist'), { recursive: true });
      writeFileSync(join(root, 'packages', 'a', 'src', 'services', 'README.md'), LEFTOVER, 'utf8');
      writeFileSync(join(root, 'packages', 'a', 'dist', 'index.js'), BUILT, 'utf8');
      writeFileSync(join(root, 'packages', 'a', 'dist', 'index.d.ts'), DECLARATION, 'utf8');
      const gate = copyGate(root);

      const skipped = runGate(gate);

      expect(skipped.status).toBe(0);
      expect(skipped.stdout).toContain('build-integrity: OK');
      expect(listPackageRoots(root).map((pkg) => pkg.name)).toEqual([]);

      writeFileSync(join(root, 'packages', 'a', 'src', 'services', 'loader.ts'), SOURCE_A, 'utf8');

      const walked = runGate(gate);

      expect(walked.status).toBe(1);
      expect(walked.stderr).toContain('orphan dist/index.js');
      expect(listPackageRoots(root).map((pkg) => pkg.name)).toEqual(['a']);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the only source is nested, should walk the package there too',
    () => {
      // given: a package whose only source is `src/sub/index.ts`, with no emit anywhere
      // when: the gate is run over it, and this walk enumerates the same root
      // then: the gate names the missing NESTED emit — which only a gate that walked the package can do — and this walk lists it
      const root = fixture({});
      const source = join(root, 'packages', 'a', 'src', 'sub', 'index.ts');
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(source, SOURCE_A, 'utf8');

      const result = runGate(copyGate(root));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing dist/sub/index.js');
      expect(listPackageRoots(root).map((pkg) => pkg.name)).toEqual(['a']);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ── a11y: the refusal a sourceless package used to produce ───────────

describe('Scenario: a11y — a package nothing can build is not named as a remedy`s target', () => {
  it('when a sourceless package has no dist, should not be named in the refusal', () => {
    // given: an ordinary unbuilt package beside one whose `src/` still holds an entry and no `.ts` anywhere, neither with a `dist/`
    // when: the prerequisite is asked whether the run may start
    // then: the refusal still refuses, names the ordinary package, and does NOT name the sourceless one — no `pnpm build` is offered for a state `pnpm build` cannot reach
    const root = fixture({ a: SOURCE_A });
    mkdirSync(join(root, 'packages', 'leftover', 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', 'leftover', 'src', 'README.md'), LEFTOVER, 'utf8');

    let refusal: Error | undefined;
    try {
      ensurePackagesBuilt(root, { runBuild: () => {} });
    } catch (error) {
      refusal = error as Error;
    }

    expect(refusal?.message).toContain('packages/a/dist');
    expect(refusal?.message).not.toContain('packages/leftover/dist');
  });
});
