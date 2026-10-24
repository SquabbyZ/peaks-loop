// tests/unit/release/mut-runtime-dependency.test.ts
//
// rid-t4-mut-runtime-dependency — guards WHERE the stryker toolchain is
// declared, not which version it is.
//
// The failure this prevents (measured on the globally installed `peaks` 4.1.17):
//
//   "Stryker invocation failed: Cannot find package '@stryker-mutator/core'
//    imported from ...\node_modules\peaks-loop\node_modules\peaks-loop-mut\
//    dist\services\mut\production-stryker.js"      (exit 1)
//
// Root cause is a packaging fact: the only runtime import of
// `@stryker-mutator/core` lives in `packages/peaks-loop-mut`
// (src/services/mut/production-stryker.ts), but the stryker packages were
// declared only in the ROOT manifest's devDependencies. devDependencies never
// reach a consumer, so the published package could never resolve the import.
//
// The guard is version-agnostic on purpose: it compares the MAJOR of the range
// declared by the package against the MAJOR of the range declared by the root
// manifest. A hard-coded version constant would turn every legitimate bump
// into a false red.
//
// Dimensions (`.peaks/standards/typescript/testing.md`):
//   - render     — the manifest SHAPE: which section holds which package
//   - behavior   — the INVARIANT: same major, no devDependencies fallback,
//                  the root -> package publish chain exists
//   - integration— the real files on disk + the runtime import site
//   - a11y       — the diagnostic a human reads when CI goes red

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/release/mut-runtime-dependency.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Repo-relative path, used in diagnostics so the message is actionable. */
const MUT_MANIFEST_REL = 'packages/peaks-loop-mut/package.json';
const ROOT_MANIFEST_REL = 'package.json';
const MUT_MANIFEST = join(repoRoot, ...MUT_MANIFEST_REL.split('/'));
const ROOT_MANIFEST = join(repoRoot, 'package.json');
const MUT_IMPORT_SITE = join(
  repoRoot,
  'packages',
  'peaks-loop-mut',
  'src',
  'services',
  'mut',
  'production-stryker.ts'
);

/** The two packages that must travel with the published tarball. */
const STRYKER_PACKAGES = ['@stryker-mutator/core', '@stryker-mutator/vitest-runner'] as const;

/** The package whose manifest owns the runtime import. */
const MUT_PACKAGE = 'peaks-loop-mut';

type Manifest = Record<string, unknown>;

/**
 * Read one manifest from disk.
 *
 * `JSON.parse` is laundered into `unknown` on purpose: the raw return type is
 * `any`, and an `any` that reaches a member access is exactly what the
 * type-checked lint bundle rejects. The narrowing below is the whole reason
 * this helper exists.
 */
function readManifest(file: string): Manifest {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A manifest section (`dependencies` / `devDependencies`) as a name -> range map. */
function sectionOf(manifest: Manifest, section: string): Record<string, string> {
  const raw = manifest[section];
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(raw)) {
    if (typeof range === 'string') out[name] = range;
  }
  return out;
}

/**
 * The major of a semver range, or null when the range is not a plain version
 * (`workspace:*`, a URL, a git spec …). Deliberately tolerant about the
 * leading operator so `^9.6.1`, `~9.6.1`, `>=9.0.0 <10` and `9.6.1` all
 * yield 9. `undefined` yields null too: a missing dependency must produce a
 * readable diagnostic, never a TypeError.
 */
function majorOf(range: string | undefined): number | null {
  if (range === undefined) return null;
  const match = /(\d+)/.exec(range.replace(/^[^\d]*/, ''));
  return match ? Number(match[1]) : null;
}

/**
 * Every invariant violation of the stryker dependency placement.
 *
 * Returns human-readable sentences instead of booleans so that a red run in
 * CI names the file, the package and the reason — the a11y surface of this
 * guard.
 */
function violationsFor(mut: Manifest, root: Manifest): string[] {
  const problems: string[] = [];
  const mutDeps = sectionOf(mut, 'dependencies');
  const mutDevDeps = sectionOf(mut, 'devDependencies');
  const rootDevDeps = sectionOf(root, 'devDependencies');
  const rootDeps = sectionOf(root, 'dependencies');

  for (const pkg of STRYKER_PACKAGES) {
    const mutRange = mutDeps[pkg];
    if (mutRange === undefined) {
      problems.push(
        `${MUT_MANIFEST_REL}: dependencies is missing ${pkg} — ` +
          'a consumer of the published tarball cannot resolve it (devDependencies never ship)'
      );
      continue;
    }
    if (mutDevDeps[pkg] !== undefined) {
      problems.push(
        `${MUT_MANIFEST_REL}: ${pkg} must not also live in devDependencies — ` +
          'the runtime dependency belongs in dependencies'
      );
    }
    const rootRange = rootDevDeps[pkg];
    if (rootRange === undefined) {
      problems.push(
        `${ROOT_MANIFEST_REL}: devDependencies is missing ${pkg} — ` +
          "the repo's own stryker.conf.js resolves the plugin from the repository root"
      );
      continue;
    }
    const mutMajor = majorOf(mutRange);
    const rootMajor = majorOf(rootRange);
    if (mutMajor === null || rootMajor === null || mutMajor !== rootMajor) {
      problems.push(
        `${pkg}: major mismatch — ${MUT_MANIFEST_REL} dependencies=${mutRange} (major ${mutMajor}) ` +
          `vs ${ROOT_MANIFEST_REL} devDependencies=${rootRange} (major ${rootMajor})`
      );
    }
  }

  if (rootDeps[MUT_PACKAGE] === undefined) {
    problems.push(
      `${ROOT_MANIFEST_REL}: dependencies is missing ${MUT_PACKAGE} — ` +
        'the publish chain from the root package down to the runtime owner is broken'
    );
  }

  return problems;
}

/**
 * A self-contained manifest pair for the mutation arms.
 *
 * The ranges are deliberately fictional: the real versions are never pinned
 * anywhere in this file, so a legitimate version bump cannot turn the suite
 * red. These arms test the DETECTOR; the render / integration arms test the
 * REAL manifests.
 */
function healthyManifestPair(): { mut: Manifest; root: Manifest } {
  const core = '^1.2.3';
  const runner = '^4.5.6';
  return {
    mut: {
      dependencies: { '@stryker-mutator/core': core, '@stryker-mutator/vitest-runner': runner },
      devDependencies: {}
    },
    root: {
      dependencies: { [MUT_PACKAGE]: 'workspace:*' },
      devDependencies: {
        '@stryker-mutator/core': core,
        '@stryker-mutator/vitest-runner': runner
      }
    }
  };
}

const realMut = readManifest(MUT_MANIFEST);
const realRoot = readManifest(ROOT_MANIFEST);
const realProblems = violationsFor(realMut, realRoot);

// ---- render dimension -------------------------------------------------------

describe('Scenario: (render) — the stryker packages sit in the manifest sections that ship', () => {
  it('when read, should peaks-loop-mut dependencies list both stryker packages with a version range', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const deps = sectionOf(realMut, 'dependencies');
    for (const pkg of STRYKER_PACKAGES) {
      expect(deps[pkg]).toBeTypeOf('string');
      expect(deps[pkg]).toMatch(/\d+\.\d+/);
    }
  });

  it('when read, should peaks-loop-mut devDependencies list neither stryker package', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const devDeps = sectionOf(realMut, 'devDependencies');
    for (const pkg of STRYKER_PACKAGES) {
      expect(devDeps[pkg]).toBeUndefined();
    }
  });

  it('when read, should the root manifest keeps both stryker packages in devDependencies', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const devDeps = sectionOf(realRoot, 'devDependencies');
    for (const pkg of STRYKER_PACKAGES) {
      expect(devDeps[pkg]).toBeTypeOf('string');
    }
  });
});

// ---- behavior dimension -----------------------------------------------------

describe('Scenario: (behavior) — the placement invariant holds and fails when it must', () => {
  it('when evaluated on this checkout, should report no violation', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(realProblems).toEqual([]);
  });

  it('when evaluated on this checkout, should the package and the root agree on the major', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const mutDeps = sectionOf(realMut, 'dependencies');
    const rootDevDeps = sectionOf(realRoot, 'devDependencies');
    for (const pkg of STRYKER_PACKAGES) {
      expect(mutDeps[pkg]).toBeTypeOf('string');
      expect(rootDevDeps[pkg]).toBeTypeOf('string');
      expect(majorOf(mutDeps[pkg])).toBe(majorOf(rootDevDeps[pkg]));
    }
  });

  it('when given a healthy manifest pair, should report no violation', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const pair = healthyManifestPair();
    expect(violationsFor(pair.mut, pair.root)).toEqual([]);
  });

  it('when the dependency is moved back to devDependencies, should report a violation', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const pair = healthyManifestPair();
    const moved: Manifest = {
      ...pair.mut,
      dependencies: { ...sectionOf(pair.mut, 'dependencies'), '@stryker-mutator/core': undefined },
      devDependencies: {
        ...sectionOf(pair.mut, 'devDependencies'),
        '@stryker-mutator/core': '^1.2.3'
      }
    };
    const problems = violationsFor(moved, pair.root);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('when the majors drift apart, should report a version mismatch', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const pair = healthyManifestPair();
    const drifted: Manifest = {
      ...pair.root,
      devDependencies: {
        ...sectionOf(pair.root, 'devDependencies'),
        '@stryker-mutator/core': '^9.9.9'
      }
    };
    const problems = violationsFor(pair.mut, drifted);
    expect(problems.some((p) => p.includes('major mismatch'))).toBe(true);
  });

  it('when the root drops the peaks-loop-mut dependency, should report the broken publish chain', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const pair = healthyManifestPair();
    const broken: Manifest = {
      ...pair.root,
      dependencies: { ...sectionOf(pair.root, 'dependencies'), [MUT_PACKAGE]: undefined }
    };
    const problems = violationsFor(pair.mut, broken);
    expect(problems.some((p) => p.includes(MUT_PACKAGE))).toBe(true);
  });
});

// ---- integration dimension --------------------------------------------------

describe('Scenario: (integration) — the real manifests and the runtime import site on disk', () => {
  it('when read from disk, should the runtime import site is the package that declares the dependency', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const source = readFileSync(MUT_IMPORT_SITE, 'utf8');
    expect(source).toContain('@stryker-mutator/core');
    expect(sectionOf(realMut, 'dependencies')['@stryker-mutator/core']).toBeTypeOf('string');
  });

  it('when read from disk, should the root manifest depends on peaks-loop-mut (publish chain)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(sectionOf(realRoot, 'dependencies')[MUT_PACKAGE]).toBeTypeOf('string');
  });
});

// ---- a11y dimension ---------------------------------------------------------

describe('Scenario: (a11y) — a red run tells the reader which file, which package, which field', () => {
  it('when a dependency is missing, should the message names the manifest, the package and the field', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const pair = healthyManifestPair();
    const empty: Manifest = { dependencies: {}, devDependencies: {} };
    const problems = violationsFor(empty, pair.root);
    expect(problems.length).toBeGreaterThan(0);
    for (const pkg of STRYKER_PACKAGES) {
      expect(problems.some((p) => p.includes(pkg))).toBe(true);
    }
    expect(problems.some((p) => p.includes(MUT_MANIFEST_REL))).toBe(true);
    expect(problems.some((p) => p.includes('dependencies'))).toBe(true);
  });

  it('when the dependency sits in devDependencies, should the message says why that does not ship', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const pair = healthyManifestPair();
    const moved: Manifest = {
      ...pair.mut,
      dependencies: { ...sectionOf(pair.mut, 'dependencies'), '@stryker-mutator/core': undefined },
      devDependencies: {
        ...sectionOf(pair.mut, 'devDependencies'),
        '@stryker-mutator/core': '^1.2.3'
      }
    };
    const problems = violationsFor(moved, pair.root);
    const message = problems.find((p) => p.includes('devDependencies')) ?? '';
    expect(message).toContain('@stryker-mutator/core');
    expect(message).toContain(MUT_MANIFEST_REL);
  });
});
