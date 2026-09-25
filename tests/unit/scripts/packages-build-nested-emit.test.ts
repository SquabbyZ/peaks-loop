// tests/unit/scripts/packages-build-nested-emit.test.ts
//
// The emit rule, one directory down. `packages-build-prerequisite.test.ts`
// pins the rule for a TOP-LEVEL source (`src/version.ts`); this file pins it
// for a NESTED one, which is the half both guards were blind to until
// rid-5b6d975f.
//
// The defect, measured on the real repository: both this guard's
// `emitIsComplete` and `check-build-integrity.mjs` walked ONE directory level
// of each package's `src/` and `dist/`. 19 of the 37 sources under
// `packages/*/src/` sit deeper than that (51 %; `peaks-loop-mut` the extreme
// at 10 of 11), so deleting
// `packages/peaks-loop-mut/dist/services/mut/report-loader.js` left this module
// reading `fresh` x4 and the gate printing `build-integrity: OK` — two green
// gates over a tree missing an artifact the package's own `index.js` imports.
// Making one side recursive and NOT the other is not a half-fix: a nested
// `dist` path read against a top-level source rule reports every nested source
// as an artifact that is missing, over a tree the gate calls OK. Both arms
// below are shaped by that pair.
//
// The second half is `hasBuild`, the THIRD top-level `readdirSync` in that
// module and a different property of the same function §2.14 cleared: not its
// `.js` filter but its walk's REACH. A package whose every source is nested has
// its every emit nested, so a top-level read answers "is there a TOP-LEVEL
// emit" — which is not the question — and `ensurePackagesBuilt` refused such a
// tree with *"no dist/ at all"* although the build had succeeded and the emit
// was on disk. That is a false refusal no rebuild can clear, on a tree
// `scripts/check-build-integrity.mjs` calls `build-integrity: OK`, and the
// module's own header names refusing such a tree as the cost its rule must not
// pay. `nestedOnlyFixture()` exists for it.
//
// The mutation that reddens this file: put any of the three walks back to its
// top-level form (`readdirSync(dir)` where the recursive `listFiles` now is) in
// `scripts/packages-build-prerequisite.mjs`. The deletion arms then read
// `fresh`, the control arms stop proving the comparison can match, and the
// nested-ONLY arms read `missing` — the refusal that cannot be cleared.
//
// Dimensions: `render` is omitted (no stdout is asserted here; the module's
// own log line is pinned in `packages-build-prerequisite.test.ts`), and
// `integration` is omitted deliberately — the real-tree arm it would hold
// lives in that file, which pins the walk's reach without pinning whether the
// working tree happens to be built right now.

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ensurePackagesBuilt,
  evaluatePackages,
  writePackageDistStamps
} from '../../../scripts/packages-build-prerequisite.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  NESTED_EMIT,
  NESTED_ONLY_EMIT,
  nestedFixture,
  nestedOnlyFixture
} from '../_setup/packages-build-fixture.js';

declareDimensions(
  'tests/unit/scripts/packages-build-nested-emit.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'no stdout is asserted here; see the header' },
    { dim: 'integration', reason: 'the real-tree arm lives in the sibling test file' }
  ]
);

describe('Scenario: behavior — the emit rule reaches nested sources', () => {
  it('when a nested emit is deleted, should report the package stale rather than fresh', () => {
    // given: a package built from a top-level AND a nested source, stamped after both sources were written, so only the artifacts can be wrong
    // when: the nested emit is deleted with its source untouched — the mutation measured on the real repository
    // then: stale, not fresh, and the refusal names the package and `pnpm build`
    const root = nestedFixture();
    writePackageDistStamps(root);

    // Control half, so the deletion below cannot be read as a fixture that
    // never matched in the first place: the same tree WITH its nested artifact
    // is fresh. A source list and a `dist` set that disagree about depth fail
    // HERE, which is the failure this half exists to catch.
    expect(evaluatePackages(root)).toEqual({ missing: [], stale: [], fresh: ['a'] });

    rmSync(join(root, 'packages', 'a', NESTED_EMIT), { force: true });

    expect(evaluatePackages(root).fresh).toEqual([]);
    expect(evaluatePackages(root).stale).toEqual(['a']);
  });

  it('when the nested emit is missing, should refuse the run naming the package and the build', () => {
    // given: the same tree, with the nested emit deleted and its source intact
    // when:  the test entry point's prerequisite is asked whether to start
    // then:  it refuses, names the package, and names the command that fixes it
    const root = nestedFixture();
    writePackageDistStamps(root);
    rmSync(join(root, 'packages', 'a', NESTED_EMIT), { force: true });

    // The build stub is never reached: the policy is refuse, not rebuild.
    expect(() => ensurePackagesBuilt(root, { runBuild: () => {} })).toThrowError(
      /refused to start[\s\S]*packages\/a\/dist[\s\S]*pnpm build/
    );
  });
});

describe('Scenario: behavior — the built question reaches every depth too', () => {
  it('when a package has no top-level source or emit at all, should call it built rather than missing', () => {
    // given: a nested-ONLY package — `src/sub/index.ts` and `dist/sub/index.js`, with nothing above either — stamped after its source was written
    // when: the tree is classified, and then that nested emit is deleted with its source untouched
    // then: fresh first, so `missing` is not merely being traded for it, and `stale` once the emit is gone: the emit rule's verdict, not hasBuild's
    const root = nestedOnlyFixture();
    writePackageDistStamps(root);

    // Control half. `hasBuild` seeing the nested emit is what lets the emit
    // rule and the digest decide; a top-level read never reaches this line.
    expect(evaluatePackages(root)).toEqual({ missing: [], stale: [], fresh: ['a'] });

    rmSync(join(root, 'packages', 'a', NESTED_ONLY_EMIT), { force: true });

    expect(evaluatePackages(root).missing).toEqual([]);
    expect(evaluatePackages(root).stale).toEqual(['a']);
  });

  it('when a nested-only package is already built, should not refuse the run as having no dist at all', () => {
    // given: the same tree, built and stamped, with every emit where that package's outDir and rootDir put it
    // when: the test entry point's prerequisite is asked whether it may start
    // then: it returns without building and without the "no dist/ at all" refusal, whose remedy a rebuild could never have delivered
    const root = nestedOnlyFixture();
    writePackageDistStamps(root);

    // The build stub is never reached: a package that is already built is not missing.
    const verdict = ensurePackagesBuilt(root, { runBuild: () => {} });

    expect(verdict).toEqual({ built: false, missing: [], stale: [], fresh: ['a'] });
  });
});
