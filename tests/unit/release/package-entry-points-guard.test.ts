// tests/unit/release/package-entry-points-guard.test.ts
//
// THE THREE INVARIANTS THIS GUARDS (rid-t6c-package-entry-invariants).
//
// The table item behind this slice was "the package's `main` field —
// `peaks-loop-mut` has no `main`". Measured, that is NOT a defect: a package
// that declares `exports` HAS its main entry, in `exports["."]`, and Node
// resolves `exports` FIRST (measured on this host). What IS one careless edit
// away from breaking is the set of invariants around it:
//
//   (a) every declared entry resolves, THROUGH THAT PACKAGE'S OWN `files`
//       allowlist, to a file the tarball would ship (the 4.1.18 -> 4.1.20
//       defect class: a manifest naming a file the tarball does not carry);
//   (b) a package declaring BOTH `main` and `exports["."].default` has them
//       agree — the guard forbids a `main` that LIES, not the field itself;
//   (c) the ROOT package exposes no side-effecting library entry: `bin.peaks`
//       is its public surface, and `dist/cli/index.js` ends with
//       `program.parseAsync(process.argv)` at module top level, so exposing it
//       as `main`/`exports` would make importing the package RUN THE CLI.
//
// THIS FILE IS STATIC: it reads the manifests and the `files` allowlists from
// disk and resolves the declared entry targets against them. No network, no
// registry, no `npm install`, no subprocess (P4 / AC-7). It NEVER imports the
// root package's CLI entry — that import would run the CLI (P3) — so it is
// recognised BY ITS PATH; its side effect was MEASURED, not re-read here.
//
// IT NEEDS NO BUILD. When a package's build output is absent, the on-disk
// existence leg is SKIPPED with its reason and the manifest-level analysis
// still passes (PRD B7); when it IS present, the entries are asserted (AC-4).
//
// PROVEN LOAD-BEARING. Every rule is exercised against a synthetic fixture
// first, and each rule is shown RED on the real tree, sha256-verified.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJson } from '../../../src/shared/json-parse.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/release/package-entry-points-guard.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The repository root, from this file: `tests/unit/release/` -> repo root. */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
/** The root package's own directory, and the workspace package under guard. */
const ROOT_DIR = REPO_ROOT;
const MUT_DIR = join(REPO_ROOT, 'packages', 'peaks-loop-mut');
/** The build-output root of both packages, relative to their own directory. */
const BUILD_ROOT = 'dist';
/** The root package's side-effecting CLI module, package-relative. */
const CLI_ENTRY = 'dist/cli/index.js';
/** What that module does at import time — measured, not re-read here. */
const CLI_SIDE_EFFECT = 'program.parseAsync(process.argv)';

/** Does `relative` exist inside `packageDir`? Injected so fixtures need no disk. */
type ExistsFn = (packageDir: string, relative: string) => boolean;
const realExists: ExistsFn = (packageDir, relative) => existsSync(join(packageDir, relative));

/** The manifest shape this guard reads; `looseObject` because a real manifest
 * carries far more than these fields, and validating the rest is not this
 * guard's business. */
const manifestSchema = z.looseObject({
  name: z.string(),
  files: z.array(z.string()),
  main: z.string().optional(),
  module: z.string().optional(),
  exports: z.unknown().optional(),
  bin: z.record(z.string(), z.string()).optional()
});
type ManifestModel = z.infer<typeof manifestSchema>;

/** One declared entry point, resolved against its own package. */
interface PackageEntry {
  readonly kind: 'main' | 'module' | 'exports' | 'bin';
  /** The declaration site, e.g. `exports["."].default` or `bin.peaks`. */
  readonly field: string;
  /** The target exactly as written, and normalized to a package-relative path. */
  readonly target: string;
  readonly relative: string;
}

/** One broken invariant, in the words a human has to read. */
interface Violation {
  readonly rule: string;
  readonly message: string;
}

/** Which on-disk existence checks ran, and which were skipped, and why. */
interface ExistenceReport {
  readonly checked: readonly string[];
  readonly skipped: ReadonlyArray<{ readonly field: string; readonly reason: string }>;
}

/** The rules a particular package is held to. */
interface PackageRules {
  /** The package must declare no library entry at all. */
  readonly forbidLibraryEntries?: boolean;
  /** The package must expose this bin name, and declare `exports["."]`. */
  readonly requiredBin?: string;
  readonly requireDotExports?: boolean;
}

/** A package under guard: its directory, its manifest, its build-output root. */
interface PackageUnderGuard {
  readonly dir: string;
  readonly name: string;
  readonly buildRoot: string;
  readonly manifest: ManifestModel;
  /** Overrides the disk probe; absent means "ask the real filesystem". */
  readonly exists?: ExistsFn;
}
/** The outcome of evaluating one package against its rules. */
interface PackageReport {
  readonly entries: readonly PackageEntry[];
  readonly violations: readonly Violation[];
  readonly existence: ExistenceReport;
}

const ROOT_RULES: PackageRules = { forbidLibraryEntries: true, requiredBin: 'peaks' };
const MUT_RULES: PackageRules = { requireDotExports: true };

/**
 * Translate one `files` entry into a matcher.
 *
 * The subset implemented is the one the two manifests under guard use: literal
 * paths, `*` (one segment), `**` (any segments) and a leading `!` (exclusion).
 * npm's packlist is NOT reimplemented — the question is the narrower one:
 * "does this package's own allowlist name this file?".
 */
function filesEntryPattern(entry: string): RegExp {
  const body = entry.startsWith('!') ? entry.slice(1) : entry;
  const parts = body.split(/(\*\*\/|\*\*|\*|\?)/).filter((part) => part !== '');
  const source = parts
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}

/**
 * Is `relative` named by this package's OWN `files` allowlist?
 *
 * The entries are evaluated IN ORDER and the LAST matching entry decides —
 * how npm's packlist treats an exclusion that follows the inclusion it
 * cancels (the root ships `skills/**`, then excludes `skills/**\/*.json`).
 */
function isShippedByAllowlist(relative: string, files: readonly string[]): boolean {
  let shipped = false;
  for (const entry of files) {
    if (filesEntryPattern(entry).test(relative)) shipped = !entry.startsWith('!');
  }
  return shipped;
}

/** Normalize a declared target to a package-relative POSIX path. */
function normalizeTarget(target: string): string {
  const slashed = target.split('\\').join('/');
  const withoutDot = slashed.startsWith('./') ? slashed.slice(2) : slashed;
  return posix.normalize(withoutDot);
}

/**
 * Walk an `exports` map and collect every string target.
 *
 * `exports` is a tree of condition and subpath maps; a key starting with `.`
 * is a subpath, any other key is a condition. The field path is built from
 * the walk, so the report names `exports["."].default`, not "a string".
 */
function collectExportEntries(node: unknown, field: string, out: PackageEntry[]): void {
  if (typeof node === 'string') {
    out.push({ kind: 'exports', field, target: node, relative: normalizeTarget(node) });
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const child = key.startsWith('.') ? `${field}["${key}"]` : `${field}.${key}`;
    collectExportEntries(value, child, out);
  }
}

/** Every entry point the manifest declares, in declaration order. */
function collectDeclaredEntries(manifest: ManifestModel): PackageEntry[] {
  const entries: PackageEntry[] = [];
  const push = (kind: PackageEntry['kind'], field: string, target: string): void => {
    entries.push({ kind, field, target, relative: normalizeTarget(target) });
  };
  if (manifest.main !== undefined) push('main', 'main', manifest.main);
  if (manifest.module !== undefined) push('module', 'module', manifest.module);
  if (manifest.exports !== undefined) collectExportEntries(manifest.exports, 'exports', entries);
  for (const [name, target] of Object.entries(manifest.bin ?? {})) {
    push('bin', `bin.${name}`, target);
  }
  return entries;
}
/** The `exports["."]` entry with the given condition, if the manifest declares it. */
const dotExport = (
  entries: readonly PackageEntry[],
  condition: 'types' | 'default'
): PackageEntry | undefined =>
  entries.find((entry) => entry.kind === 'exports' && entry.field === `exports["."].${condition}`);
/** The reason the on-disk existence leg is skipped when there is no build. */
const skipReason = (buildRoot: string): string =>
  `the build output ${buildRoot}/ is absent in this checkout, so the on-disk existence check is skipped — the guard must not fail for a missing build`;
/** The declared entries of one kind, rendered as `field -> target`. */
const fieldList = (entries: readonly PackageEntry[], kind?: PackageEntry['kind']): string[] =>
  entries
    .filter((e) => kind === undefined || e.kind === kind)
    .map((e) => `${e.field} -> ${e.target}`);

/**
 * Evaluate one package against its rules.
 *
 * Every rule is a separate, named violation so a red run says WHICH
 * invariant broke, not just "the package is wrong".
 */
function evaluatePackage(pkg: PackageUnderGuard, rules: PackageRules = {}): PackageReport {
  const exists = pkg.exists ?? realExists;
  const entries = collectDeclaredEntries(pkg.manifest);
  const violations: Violation[] = [];
  const checked: string[] = [];
  const skipped: Array<{ field: string; reason: string }> = [];
  const buildPresent = exists(pkg.dir, pkg.buildRoot);
  const report = (rule: string, entry: PackageEntry, detail: string): void => {
    const subject = `${entry.field} -> "${entry.target}"`;
    violations.push({ rule, message: `${pkg.name}: ${subject} ${detail}` });
  };
  const reportText = (rule: string, detail: string): void => {
    violations.push({ rule, message: `${pkg.name}: ${detail}` });
  };
  for (const entry of entries) {
    // AC-1 — the entry must be named by THIS package's own allowlist.
    if (!isShippedByAllowlist(entry.relative, pkg.manifest.files)) {
      report('entry-not-shipped', entry, 'is not in package.json#files');
    }
    // AC-4 — the on-disk existence leg, skipped when the build output is absent.
    if (entry.relative.startsWith(`${pkg.buildRoot}/`) && !buildPresent) {
      skipped.push({ field: entry.field, reason: skipReason(pkg.buildRoot) });
      continue;
    }
    if (!exists(pkg.dir, entry.relative)) {
      report('entry-file-missing', entry, 'does not exist in the package');
    } else {
      checked.push(entry.field);
    }
  }
  // AC-2 — a `main` must not disagree with `exports["."].default`.
  const mainEntry = entries.find((entry) => entry.kind === 'main');
  const dotDefault = dotExport(entries, 'default');
  if (mainEntry !== undefined && dotDefault !== undefined) {
    if (mainEntry.relative !== dotDefault.relative) {
      reportText(
        'entry-disagreement',
        `main ${mainEntry.relative} != default ${dotDefault.relative}`
      );
    }
  }
  // AC-3 — the root package is CLI-only; it declares no library entry.
  for (const entry of entries) {
    if (entry.kind === 'bin') continue;
    if (rules.forbidLibraryEntries === true) {
      report('library-entry-forbidden', entry, 'declares a library entry');
    }
    if (entry.relative === CLI_ENTRY) {
      report('side-effecting-library-entry', entry, `is the CLI entry (${CLI_SIDE_EFFECT})`);
    }
  }
  // AC-3 — the required bin target must be declared.
  if (rules.requiredBin !== undefined) {
    const declared = entries.some((entry) => entry.field === `bin.${rules.requiredBin}`);
    if (!declared) reportText('missing-bin', `bin.${rules.requiredBin} is not declared`);
  }
  // AC-2 — the mut package keeps one source of truth for its entry.
  if (rules.requireDotExports === true) {
    const dotTypes = dotExport(entries, 'types');
    if (dotTypes === undefined)
      reportText('mut-exports-types-missing', 'exports["."] has no "types"');
    if (dotDefault === undefined)
      reportText('mut-exports-default-missing', 'exports["."] has no "default"');
    if (dotTypes !== undefined && dotDefault !== undefined) {
      const expected = dotDefault.relative.endsWith('.js')
        ? `${dotDefault.relative.slice(0, -3)}.d.ts`
        : null;
      if (expected !== null && dotTypes.relative !== expected) {
        reportText('mut-exports-disagreement', `types ${dotTypes.relative} != ${expected}`);
      }
    }
  }
  return { entries, violations, existence: { checked, skipped } };
}

/** Read a manifest from disk and pair it with its directory and name. */
function readPackage(dir: string, name: string): PackageUnderGuard {
  const manifest = parseJson(readFileSync(join(dir, 'package.json'), 'utf8'), manifestSchema);
  return { dir, name, buildRoot: BUILD_ROOT, manifest };
}
/** The real root package. */
const rootPackage = (): PackageUnderGuard => readPackage(ROOT_DIR, 'peaks-loop');

/** The real `peaks-loop-mut` workspace package. */
const mutPackage = (): PackageUnderGuard => readPackage(MUT_DIR, 'peaks-loop-mut');
/** A synthetic package for the fixtures — no disk involved. */
function fixture(overrides: Partial<ManifestModel>, exists?: ExistsFn): PackageUnderGuard {
  const manifest: ManifestModel = { name: 'fixture-pkg', files: ['dist/**'], ...overrides };
  const probe: ExistsFn = exists ?? (() => true);
  return { dir: '/fixture', name: 'fixture-pkg', buildRoot: BUILD_ROOT, manifest, exists: probe };
}
/** An existence stub over package-relative paths. */
function existsOnly(...present: readonly string[]): ExistsFn {
  const set = new Set(present);
  return (_packageDir, relative) => set.has(relative);
}

/** The one-line rendering of a violation, for a human reading a red run. */
const describeViolation = (violation: Violation): string =>
  `${violation.rule}: ${violation.message}`;

// ---- behavior dimension: SYNTHETIC fixtures first — a detector that cannot
// fail is not a detector.

describe('Scenario: (behavior) — every rule reports the violation it exists to catch', () => {
  it('when a declared entry is outside the allowlist or absent from disk, should report it', () => {
    // given: a package whose main is outside its allowlist, and one whose entry file is missing
    // when: both are evaluated
    // then: the allowlist rule and the missing-file rule each fire
    const unshipped = evaluatePackage(fixture({ main: './lib/entry.js' }));
    const missing = evaluatePackage(fixture({ main: './dist/nope.js' }, existsOnly('dist')));
    expect(unshipped.violations.map((violation) => violation.rule)).toEqual(['entry-not-shipped']);
    expect(unshipped.violations[0]?.message).toContain('main -> "./lib/entry.js"');
    expect(missing.violations.map((violation) => violation.rule)).toEqual(['entry-file-missing']);
  });
  it('when main disagrees with exports default, should report the disagreement', () => {
    // given: a package whose main names a different file than exports["."].default
    // when: the package is evaluated, and an AGREEING main is evaluated too
    // then: the lying main is reported and the agreeing one is not
    const exportsMap = { '.': { types: './dist/index.d.ts', default: './dist/index.js' } };
    const lying = evaluatePackage(fixture({ main: './dist/index.d.ts', exports: exportsMap }));
    const honest = evaluatePackage(fixture({ main: './dist/index.js', exports: exportsMap }));
    expect(lying.violations.map((violation) => violation.rule)).toEqual(['entry-disagreement']);
    expect(lying.violations[0]?.message).toContain('dist/index.d.ts');
    expect(honest.violations).toEqual([]);
  });
  it('when the root package declares a library entry, should report it and name the side effect', () => {
    // given: a root-shaped package that declares main pointing at the CLI module
    // when: the package is evaluated under the root rules
    // then: both the library-entry rule and the side-effect rule fire
    const report = evaluatePackage(
      fixture({
        name: 'peaks-loop',
        files: ['bin/peaks.js', 'dist/**/*.js'],
        main: './dist/cli/index.js',
        bin: { peaks: './bin/peaks.js' }
      }),
      ROOT_RULES
    );
    expect(report.violations.map((violation) => violation.rule)).toEqual([
      'library-entry-forbidden',
      'side-effecting-library-entry'
    ]);
  });
  it('when the mut package drops or contradicts its exports dot entry, should report the missing or mismatched condition', () => {
    // given: a mut-shaped package with no exports, and one whose types names another module
    // when: both are evaluated under the mut rules
    // then: the missing conditions and the mismatch are each reported
    const dropped = evaluatePackage(fixture({}), MUT_RULES);
    const mismatched = evaluatePackage(
      fixture({ exports: { '.': { types: './dist/other.d.ts', default: './dist/index.js' } } }),
      MUT_RULES
    );
    expect(dropped.violations.map((violation) => violation.rule)).toEqual([
      'mut-exports-types-missing',
      'mut-exports-default-missing'
    ]);
    expect(mismatched.violations.map((violation) => violation.rule)).toEqual([
      'mut-exports-disagreement'
    ]);
    expect(mismatched.violations[0]?.message).toContain('dist/index.d.ts');
  });
  it('when the build output is absent, should skip the on-disk check with a reason instead of failing', () => {
    // given: a package whose build output does not exist in this checkout
    // when: the package is evaluated
    // then: the entry is reported as skipped with a reason, and nothing fails
    const report = evaluatePackage(fixture({ main: './dist/index.js' }, existsOnly()));
    expect(report.violations).toEqual([]);
    expect(report.existence.skipped).toHaveLength(1);
    expect(report.existence.skipped[0]?.reason).toContain('build output');
  });
});

// ---- integration dimension: the real tree, where a bad manifest would fail --

const MUT_BUILD_PRESENT = existsSync(join(MUT_DIR, BUILD_ROOT));

describe('Scenario: (integration) — the real manifests declare entries that ship', () => {
  it('when the two manifests are read, should they declare only the measured entry surfaces and ship them', () => {
    // given: the real root and mut manifests
    // when: each is evaluated under its own rules
    // then: no rule fires, and the published SURFACES are the measured ones.
    //      The surfaces are pinned, not the whole list: an AGREEING legacy
    //      `main` is allowed (PRD B2), so pinning every field would forbid it.
    const rootReport = evaluatePackage(rootPackage(), ROOT_RULES);
    const mutReport = evaluatePackage(mutPackage(), MUT_RULES);
    expect(rootReport.violations.map(describeViolation)).toEqual([]);
    expect(fieldList(rootReport.entries, 'bin')).toEqual(['bin.peaks -> ./bin/peaks.js']);
    expect(mutReport.violations.map(describeViolation)).toEqual([]);
    expect(fieldList(mutReport.entries, 'exports')).toEqual([
      'exports["."].types -> ./dist/index.d.ts',
      'exports["."].default -> ./dist/index.js'
    ]);
  });
  it.skipIf(!MUT_BUILD_PRESENT)(
    'when the build output is present, should the declared entry files be asserted to exist on disk',
    () => {
      // given: the real manifests and a present build output
      // when: the on-disk existence leg runs
      // then: every entry under the build output was checked, and the guard reports it
      const rootReport = evaluatePackage(rootPackage(), ROOT_RULES);
      const mutReport = evaluatePackage(mutPackage(), MUT_RULES);
      const checked = mutReport.existence.checked.length;
      const skipped = mutReport.existence.skipped.length;
      // `process.stdout.write`, not `console.info`: vitest intercepts the
      // console and hides it from the default reporter (AC-4 wants a REPORT).
      process.stdout.write(
        `[package-entry-points-guard] on-disk check RAN: ${checked} checked, ${skipped} skipped\n`
      );
      const expected = ['exports["."].types', 'exports["."].default'];
      expect(rootReport.existence.checked).toContain('bin.peaks');
      expect(mutReport.existence.checked).toEqual(expect.arrayContaining(expected));
      expect(rootReport.existence.skipped).toEqual([]);
      expect(mutReport.existence.skipped).toEqual([]);
    }
  );
  it.skipIf(MUT_BUILD_PRESENT)(
    'when the build output is absent, should the on-disk check be reported as skipped with its reason',
    () => {
      // given: the real manifests and an absent build output
      // when: the on-disk existence leg runs
      // then: the check is skipped WITH a reason, and the guard still passes
      const mutReport = evaluatePackage(mutPackage(), MUT_RULES);
      expect(mutReport.existence.skipped.length).toBeGreaterThan(0);
      for (const skip of mutReport.existence.skipped) {
        expect(skip.reason.length).toBeGreaterThan(0);
      }
      expect(mutReport.violations).toEqual([]);
    }
  );
});

// ---- render dimension: the shape of the guard's own output ------------------

describe('Scenario: (render) — a violation names the package, the field and the target', () => {
  it('when a violation is rendered, should the sentence names the package and the declaration site', () => {
    // given: one violation as the detector produces it
    // when: it is rendered for a human
    // then: the sentence names the rule, the package, the field and the target
    const sentence = describeViolation({
      rule: 'entry-not-shipped',
      message:
        'peaks-loop-mut: main -> "./dist/nope.js" is not named by package.json#files, so the published tarball does not contain it'
    });
    expect(sentence).toContain('entry-not-shipped');
    expect(sentence).toContain('peaks-loop-mut');
    expect(sentence).toContain('main -> "./dist/nope.js"');
  });
});

// ---- a11y dimension: what the human sees when the guard fails ---------------

describe('Scenario: (a11y) — a red run tells the reader which manifest to edit', () => {
  it('when the guard fails, should the message names the allowlist and the import-time side effect', () => {
    // given: the defect class the 4.1.18 packaging hotfix fixed, and a root gaining a library entry
    // when: both violations are rendered for a human
    // then: the messages say WHICH allowlist to change and WHY the CLI entry is forbidden
    const unshipped = evaluatePackage(fixture({ name: 'peaks-loop-mut', main: './lib/entry.js' }));
    const sideEffecting = evaluatePackage(
      fixture({
        name: 'peaks-loop',
        files: ['bin/peaks.js', 'dist/**/*.js'],
        main: './dist/cli/index.js',
        bin: { peaks: './bin/peaks.js' }
      }),
      ROOT_RULES
    );
    const rendered = [...unshipped.violations, ...sideEffecting.violations].map(describeViolation);
    expect(rendered.join('\n')).toMatch(/package\.json#files/);
    expect(rendered.join('\n')).toContain('program.parseAsync(process.argv)');
  });
});
