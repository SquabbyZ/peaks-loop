// packages/peaks-loop-shared/tests/paths-resolve.test.ts
//
// The published CLI must start whatever npm did with the layout.
//
// The shared package ships `dist/**` only — no `skills/` — so the "peaks
// repository root" it looks for is always the ROOT package's directory. The
// old lookup walked up looking for a directory holding `package.json` AND
// `skills/`, which only works when the sub-packages sit NESTED under the
// root package (npm's global layout). A local install hoists them BESIDE the
// root, the walk passed the root without seeing it, and the CLI died on its
// first import.
//
// These cases build the two layouts on a real disk and ask the resolver
// where the root is.
//
// Dimensions covered:
//   - render:      the resolved directory, per layout
//   - behavior:    the canonical-store fallback and the refusal
//   - integration:  real directories on a real disk
//   - a11y:        the error a caller sees when there is no root at all
//
// `declareDimensions` is inlined for the same reason as the sibling files in
// this package — the root helper lives behind the '~' vitest alias, which
// this package's vitest config does not inherit.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

type Dim = 'render' | 'behavior' | 'integration' | 'a11y';
function declareDimensions(
  _file: string,
  covered: readonly Dim[],
  omitted: ReadonlyArray<{ dim: Dim; reason: string }> = []
): void {
  const ALL: readonly Dim[] = ['render', 'behavior', 'integration', 'a11y'];
  const coveredSet = new Set(covered);
  const missing = ALL.filter((d) => !coveredSet.has(d) && !omitted.find((o) => o.dim === d));
  if (missing.length > 0) {
    throw new Error(
      `[${_file}] missing dimensions ${missing.join(', ')}; add a describe(...) or pass an omitted[] entry.`
    );
  }
}

declareDimensions('packages/peaks-loop-shared/tests/paths-resolve.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import { canonicalStoreRoot, findRepoRoot } from '../src/paths-resolve.js';

const tmpRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-shared-resolve-'));
  tmpRoots.push(root);
  return root;
}

/** A directory that looks like the root package: `package.json` + `skills/`. */
function makeRootPackage(dir: string): string {
  mkdirSync(join(dir, 'skills'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'peaks-loop' }), 'utf8');
  return dir;
}

/** A directory that looks like the shared package: `package.json` + `dist/`. */
function makeSharedPackage(dir: string): string {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'peaks-loop-shared' }), 'utf8');
  return join(dir, 'dist');
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("integration — the root package is found in npm's hoisted layout", () => {
  it('when the sub-packages sit BESIDE the root package, should resolve to the root package', () => {
    // npm's LOCAL install: node_modules/peaks-loop beside
    // node_modules/peaks-loop-shared. The old walk went past the root.
    const consumer = tempRoot();
    const modules = join(consumer, 'node_modules');
    const rootPackage = makeRootPackage(join(modules, 'peaks-loop'));
    const sharedDist = makeSharedPackage(join(modules, 'peaks-loop-shared'));

    expect(findRepoRoot(sharedDist)).toBe(rootPackage);
  });

  it('when the sub-packages sit NESTED under the root package, should resolve to the root package', () => {
    // npm's GLOBAL install: the same packages under the root's own
    // node_modules. The old walk found this one.
    const consumer = tempRoot();
    const modules = join(consumer, 'node_modules');
    const rootPackage = makeRootPackage(join(modules, 'peaks-loop'));
    const sharedDist = makeSharedPackage(
      join(modules, 'peaks-loop', 'node_modules', 'peaks-loop-shared')
    );

    expect(findRepoRoot(sharedDist)).toBe(rootPackage);
  });

  it('when the package is used from a source checkout, should resolve to the checkout', () => {
    const checkout = tempRoot();
    const rootPackage = makeRootPackage(checkout);
    const sharedDist = makeSharedPackage(join(checkout, 'packages', 'peaks-loop-shared'));

    expect(findRepoRoot(sharedDist)).toBe(rootPackage);
  });
});

describe('behavior — the canonical store is the last resort', () => {
  it('when no root package is on disk, should fall back to the canonical store', () => {
    // The store is the skills' legal home, so it is the one place they are
    // guaranteed to be when the root package is not installed at all. The
    // platform root is the start path because its walk is bounded — one
    // level — so the case does not depend on what else the machine has.
    const platformRoot = dirname(resolve('/'));
    const store = tempRoot();
    mkdirSync(join(store, 'skills'), { recursive: true });
    const previous = process.env.PEAKS_HOME;
    process.env.PEAKS_HOME = store;
    try {
      expect(findRepoRoot(platformRoot)).toBe(store);
    } finally {
      if (previous === undefined) delete process.env.PEAKS_HOME;
      else process.env.PEAKS_HOME = previous;
    }
  });

  it('when PEAKS_HOME is set, should read the canonical store from it', () => {
    expect(canonicalStoreRoot({ PEAKS_HOME: '/tmp/peaks-store' })).toBe(
      resolve('/tmp/peaks-store')
    );
  });

  it('when PEAKS_HOME is empty, should fall back to the home directory', () => {
    const fromHome = canonicalStoreRoot({ PEAKS_HOME: '   ' });
    expect(fromHome).not.toBeNull();
    expect(fromHome).toContain('.peaks');
  });
});

describe('a11y — the refusal names the path it started from', () => {
  it('when there is no root package and no store, should refuse with the starting path in the message', () => {
    // The platform root is the one directory whose walk is bounded: it is
    // its own parent, so exactly one level is examined. That makes the
    // refusal observable on any machine, whatever else is installed above
    // the temp directory.
    const platformRoot = dirname(resolve('/'));
    const previous = process.env.PEAKS_HOME;
    const store = tempRoot();
    process.env.PEAKS_HOME = join(store, 'no-store-here');
    try {
      expect(() => findRepoRoot(platformRoot)).toThrow(/Unable to locate Peaks repository root/);
      expect(() => findRepoRoot(platformRoot)).toThrow(platformRoot);
    } finally {
      if (previous === undefined) delete process.env.PEAKS_HOME;
      else process.env.PEAKS_HOME = previous;
    }
  });
});
