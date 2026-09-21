// tests/unit/standards/esm-relative-import-extension.test.ts
//
// Every RELATIVE import/export specifier under the wide tsconfig's include set
// must carry an explicit ESM file extension (`.js` / `.mjs` / `.cjs`).
//
// WHAT WENT WRONG, AND WHY PROSE DID NOT STOP IT
//
// `tsconfig.json` pins `module` + `moduleResolution` to `NodeNext`. Under
// `node16` / `nodenext` a relative specifier needs an explicit extension, so
// TypeScript emitted **22 × TS2835** across 19 files under `tests/`
// ("Relative import paths need explicit file extensions in ECMAScript imports
// when '--moduleResolution' is 'node16' or 'nodenext'").
//
// Nothing in CI could see them. `ci.yml` runs `pnpm test:unit` — vitest, which
// performs no type checking and happily maps `./x.js` onto the on-disk `./x.ts`
// — and `npm run build`, which uses `tsconfig.build.json`, whose `include`
// excludes `tests/**`. The wide tsconfig (`pnpm typecheck`) is the only thing
// that compiles them, and it was not on the CI path. 142 errors accumulated
// invisibly; 22 of them were this class.
//
// WHY IT PARSES INSTEAD OF GREPPING
//
// A text scan cannot tell a module specifier from the same string in a comment,
// in a `vi.mock()` argument, or in an assertion's expected-output literal. This
// repository contains all three, and the last two are NOT the same rule: a
// `vi.mock('<path>')` argument is not type-checked by TS2835, so demanding an
// extension there would be a false positive. An AST walk over
// `ImportDeclaration` / `ExportDeclaration` nodes is exact by construction —
// the same reason, and the same choice, as
// `tests/unit/workspace/runtime-layout-drift-guard.test.ts`.
//
// WHAT IT ASSERTS
//
//   forward (load-bearing): every relative specifier in every `.ts` file under
//            `src/` and `tests/` ends in `.js` / `.mjs` / `.cjs`.
//   reach   (the anti-weakening arm): the walk really visited the tree — the
//            file set and the specifier set are both CROSS-MEASURED against
//            independent sources, so a walk that returns early, drops
//            `ExportDeclaration`, or quietly narrows its root fails HERE
//            instead of passing below.
//
// WHY THE REACH ARM IS CROSS-MEASURED AND NOT SELF-DERIVED (slice rid-b1)
//
// The reach arm used to be two hand-kept literals: `scan.files.length` and
// `scan.specifiers.length`. Every new file or new import moved them, and one
// integer made five round trips (1197→1201→1202; 2738→2748→2786→2792→2793).
// A literal that must be edited on every legitimate change is a tax — but
// replacing it with a number computed by the very traversal it guards would be
// strictly worse: that guard is green forever and means nothing.
//
// The reach arm is therefore TWO measurements, from TWO sources, that must
// agree. Neither is read back out of the guarded walk, and neither needs an edit
// when the tree grows:
//
//   1. FILE SET — compared, set for set, against `git ls-files` (tracked ∪
//      untracked-not-ignored). That enumeration comes from git's index, not from
//      the `readdirSync` recursion guarded here, and it sees a new file at the
//      same moment the walk does. A walk that returns early, drops a subtree or
//      narrows its root stops matching.
//
//   2. SPECIFIER SET — compared against a SECOND collector that shares no
//      traversal with the first: no recursion, no `forEachChild`, one flat pass
//      over the file's top-level statements. Import/export declarations are
//      top-level statements, so the two mechanisms must agree exactly; measured
//      on this tree they do, 2793 both ways across 1202 files.
//
// The residual assumption is that both mechanisms could be broken TOGETHER. The
// `injection` describe below refuses to leave that unexamined: it drives the
// real traversal through deliberately damaged configurations and requires the
// damage to be visible. Because each damage is requested through the same
// parameter the real walk reads, deleting a real arm turns the matching
// injection into a no-op — and that injection case then fails, instead of
// silently agreeing with the damaged walk.
//
// SCOPE — and the one boundary this guard deliberately does not cross
//
// `src/` + `tests/` is exactly `tsconfig.json`'s `include`, i.e. exactly the set
// the wide tsconfig compiles, i.e. exactly the set that can emit TS2835. The
// rule is stated over ALL relative specifiers rather than only the
// `../../packages/*/src/...` shape that prompted the slice: the measured 22
// split 17 into `packages/*/src/**` and 5 into `src/**`, so a guard scoped to
// the packages shape alone would have caught 17 of 22 and let the other 5 back.
//
// `vi.mock('<relative path>')` arguments are NOT scanned. They are not
// type-checked by TS2835, and today several are extensionless on purpose-named
// modules. They ARE load-bearing at runtime (vitest resolves the mock id and the
// import id independently, and they must land on the same module), which is why
// the 22 specifiers this guard protects were each verified by running the
// affected suites. Widening this guard to cover them is a separate decision with
// its own measurement, not a free addition — see the slice report.
//
// Omitting the `a11y` dimension: this guard has no human-visible surface of its
// own — it produces no stdout, no exit code and no user-facing message. The
// vitest assertion text it fails with is covered by `render`.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative as relativePath, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/standards/esm-relative-import-extension.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Exactly `tsconfig.json`'s `include` (`src/**\/*.ts`, `tests/**\/*.ts`), which
 * is exactly the set the wide tsconfig compiles and therefore the set that can
 * emit TS2835. `tsconfig.build.json` covers neither tree, which is the reason
 * this class stayed invisible to `npm run build`.
 */
const TREES: readonly string[] = ['src', 'tests'];

/**
 * Exactly `tsconfig.json`'s `exclude`, applied while walking. Carried over
 * because it is part of the same definition of "the set tsc compiles": a file
 * tsc does not compile cannot emit TS2835.
 *
 * `tests/fixtures/bdd-reporter-tmp` is the entry that earns its keep.
 * `tests/unit/reporters/bdd-reporter.test.ts` writes transient
 * `case-XXXX/*.test.ts` files there and removes them in `afterEach`. The whole
 * directory is gitignored, so git never sees those files either — which is what
 * keeps the cross-check below from reporting a race as a reach regression.
 */
const EXCLUDED: readonly string[] = ['dist', 'node_modules', 'tests/fixtures/bdd-reporter-tmp'];

const ESM_EXTENSION = /\.(js|mjs|cjs)$/;

/** `packages/<pkg>/src/…` — the shape that prompted this slice (17 of the 22). */
const PACKAGES_SRC = /(?:^|\/)packages\/[^/]+\/src\//;

interface Specifier {
  /** Repo-relative, POSIX separators — the form an operator can paste. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Which arms of the traversal to run. The default is every arm; the non-default
 * values exist only for the injection cases, which require the damage they
 * request to be observable.
 *
 * The point of routing the damage through the SAME parameters the real walk
 * reads is that a future edit which removes an arm from this file also removes
 * the ability to honour the matching injection — so `continueWalk: false`, for
 * instance, stops truncating the walk, the injection stops losing specifiers,
 * and the injection case fails. A private copy of the walk for the injections
 * would not have that property.
 */
interface Arm {
  readonly imports: boolean;
  readonly exports: boolean;
  /** `false` models an early `return`: the walk halts at its first match. */
  readonly continueWalk: boolean;
}

const FULL_ARM: Arm = { imports: true, exports: true, continueWalk: true };

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function isExcluded(full: string, root: string): boolean {
  const rel = toPosix(relativePath(root, full));
  return EXCLUDED.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
}

function listTsFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (isExcluded(full, root)) continue;
    if (entry.isDirectory()) listTsFiles(full, root, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * The `.ts` files under TREES as GIT reports them — `--cached` (in the index)
 * unioned with `--others --exclude-standard` (on disk, not ignored). This is the
 * independent enumeration the reach arm cross-checks the walk against, and the
 * reason a new file costs no literal edit: git sees it, the walk sees it, and
 * the two are compared rather than a number being compared to a number.
 *
 * One difference between git and a worktree is repaired rather than asserted: a
 * tracked file deleted but not yet staged is still listed by `--cached`, and it
 * is not a file the walk can see, so the index entry is dropped by an existence
 * check. That check repairs the enumeration; it is not where the expectation
 * comes from.
 */
function listTsFilesFromGit(root: string): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...TREES],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // Repo standard (`tests/unit/spawn-windows-hide-guard.test.ts`): every
      // child_process call site pins this, or Windows flashes a console window.
      windowsHide: true
    }
  );
  return listed
    .split('\u0000')
    .filter((path) => path.length > 0 && path.endsWith('.ts'))
    .filter(
      (path) => !EXCLUDED.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))
    )
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function isRelativeSpecifier(text: string): boolean {
  return text.startsWith('./') || text.startsWith('../');
}

/** The relative specifier a single import/export declaration writes, if any. */
function specifierAt(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  file: string,
  root: string
): Specifier | undefined {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return undefined;
  const specifier = node.moduleSpecifier;
  if (specifier === undefined) return undefined;
  if (!ts.isStringLiteral(specifier)) return undefined;
  if (!isRelativeSpecifier(specifier.text)) return undefined;
  const { line } = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile));
  return {
    file: toPosix(relativePath(root, file)),
    line: line + 1,
    text: specifier.text
  };
}

/**
 * Every RELATIVE module specifier written by an import OR export declaration —
 * mechanism 1, the recursive one the forward assertion is stated over.
 *
 * The walk recurses with `forEachChild` on every node it visits — including the
 * declarations it already matched — so nothing is skipped by an early return.
 * `arm.continueWalk` is the one exception, and it exists so that an early return
 * can be *injected* and seen.
 */
function collectRelativeSpecifiers(
  sourceFile: ts.SourceFile,
  file: string,
  root: string,
  arm: Arm = FULL_ARM
): Specifier[] {
  const found: Specifier[] = [];
  const visit = (node: ts.Node): boolean | undefined => {
    const matched =
      (arm.imports && ts.isImportDeclaration(node)) ||
      (arm.exports && ts.isExportDeclaration(node));
    if (matched) {
      const specifier = specifierAt(node, sourceFile, file, root);
      if (specifier !== undefined) {
        found.push(specifier);
        // A truthy `forEachChild` callback stops the sibling iteration as well:
        // this is what makes `continueWalk: false` model "the walk stops early"
        // rather than merely "this node's children are skipped".
        if (!arm.continueWalk) return true;
      }
    }
    return ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The same question — "which relative specifiers are written in this file?" —
 * answered by mechanism 2, which shares no traversal with mechanism 1: no
 * recursion, no `forEachChild`, one flat pass over the file's top-level
 * statements.
 *
 * This is sound because import and export declarations are TOP-LEVEL statements
 * in TypeScript; nothing nests them. Measured on this tree, the two mechanisms
 * agree exactly — same count, same order — which is the whole basis of the
 * reach cross-check.
 */
function collectRelativeSpecifiersFlat(
  sourceFile: ts.SourceFile,
  file: string,
  root: string
): Specifier[] {
  const found: Specifier[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = specifierAt(statement, sourceFile, file, root);
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

interface TreeScan {
  readonly files: readonly string[];
  /** Mechanism 1 — the recursion the forward assertion is stated over. */
  readonly specifiers: readonly Specifier[];
  /** Mechanism 2 — the flat pass that independently measures the same reach. */
  readonly specifiersFlat: readonly Specifier[];
}

/**
 * Walk a source tree. `root` is a parameter rather than the module constant so
 * the decision below can be driven from a fixture (see the behavior cases);
 * `arm` is a parameter so the injection cases can drive the same walk damaged.
 * Each file is parsed ONCE and handed to both mechanisms.
 */
function scanTree(root: string, arm: Arm = FULL_ARM): TreeScan {
  const files: string[] = [];
  const specifiers: Specifier[] = [];
  const specifiersFlat: Specifier[] = [];
  for (const tree of TREES) {
    for (const file of listTsFiles(join(root, tree), root)) {
      files.push(file);
      const sourceFile = parse(file);
      specifiers.push(...collectRelativeSpecifiers(sourceFile, file, root, arm));
      specifiersFlat.push(...collectRelativeSpecifiersFlat(sourceFile, file, root));
    }
  }
  return { files, specifiers, specifiersFlat };
}

/** Relative specifiers that omit the extension NodeNext requires. */
function decide(scan: TreeScan): readonly Specifier[] {
  return scan.specifiers.filter((specifier) => !ESM_EXTENSION.test(specifier.text));
}

/**
 * The message the guard fails with — asserted under `render`.
 *
 * `root` is the scanned root so the paths read as the operator's checkout sees
 * them (`tests/unit/...`), not as this machine's tmp directory.
 */
function describeViolations(violations: readonly Specifier[]): string {
  if (violations.length === 0) return '';
  return (
    `${violations.length} relative import/export specifier(s) omit the explicit ESM extension ` +
    `NodeNext requires (TS2835). Append \`.js\` (TypeScript's ESM convention: write \`.js\`, ` +
    `the emitted file is that file): ` +
    violations.map((v) => `${v.file}:${v.line} '${v.text}'`).join(', ')
  );
}

function withFixtureTree(
  files: Readonly<Record<string, string>>,
  body: (root: string) => void
): void {
  const root = mkdtempSync(join(tmpdir(), 'peaks-esm-ext-'));
  try {
    // `scanTree` walks every tree in TREES, so a fixture must materialise both —
    // otherwise the missing one throws ENOENT and every behavior case dies for a
    // reason that has nothing to do with the decision under test. Both trees are
    // created explicitly and `listTsFiles` stays strict: a missing tree is a real
    // error, not something to swallow.
    for (const tree of TREES) mkdirSync(join(root, tree), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const full = join(root, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── integration: the real tree ───────────────────────────────────────

describe('Scenario: integration — the guard walks the real src/ + tests/ trees', () => {
  const scan = scanTree(REPO_ROOT);
  const violations = decide(scan);
  // Enumerated once, from git, and reused by both reach assertions below.
  const filesFromGit = listTsFilesFromGit(REPO_ROOT);

  it('reaches exactly the .ts files git reports under src/ + tests/', () => {
    // Set equality, not a count: a duplicate, a dropped subtree and a narrowed
    // root each break it, and a NEW FILE does not — both sides see it. This is
    // what replaced `expect(scan.files.length).toBe(1202)`.
    const walked = scan.files.map((file) => toPosix(relativePath(REPO_ROOT, file))).sort();
    expect(walked).toEqual(filesFromGit);
  });

  it('reaches every relative specifier, as measured by a second, non-recursive pass', () => {
    // The anti-weakening arm. `specifiersFlat` comes from mechanism 2, which
    // never recurses and never consults `arm`; a walk that stops early or drops
    // `ExportDeclaration` (109 specifiers, measured) can no longer agree with
    // it. This is what replaced `expect(scan.specifiers.length).toBe(2793)`.
    expect(scan.specifiers).toEqual(scan.specifiersFlat);
  });

  it('reaches at least one relative specifier per file git reports (a collapse floor)', () => {
    // A floor, deliberately loose, tied to the INDEPENDENT file enumeration: it
    // cannot detect a subtle drop — the cross-check above is what does that —
    // but it cannot pass a walk that has collapsed to nothing either, which is
    // the failure mode two agreeing-but-empty mechanisms would otherwise hide.
    expect(scan.specifiers.length).toBeGreaterThanOrEqual(filesFromGit.length);
  });

  it('reaches every relative specifier that crosses into packages/*/src', () => {
    // The class that prompted the slice, measured separately: 17 of the 22
    // TS2835 errors pointed here (the other 5 pointed into `src/**`), plus 2
    // that were already correct — `tests/unit/runtime/process-supervisor.test.ts`
    // and `tests/unit/services/ecc/ecc-materialize.test.ts`.
    //
    // The exact count used to be pinned here too; it is now carried by the
    // cross-check above, which is strict and needs no edit when a
    // `packages/*/src` import is added. What is asserted here is that the arm is
    // still REACHED at all.
    const inPackagesScope = scan.specifiers.filter((specifier) =>
      PACKAGES_SRC.test(specifier.text)
    );
    const flatInPackagesScope = scan.specifiersFlat.filter((specifier) =>
      PACKAGES_SRC.test(specifier.text)
    );
    expect(inPackagesScope.length).toBe(flatInPackagesScope.length);
    expect(inPackagesScope.length).toBeGreaterThan(0);
  });

  it('finds no relative specifier missing its ESM extension', () => {
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});

// ── injection: damaging the traversal must be visible ────────────────

describe('Scenario: injection — damage to the traversal is visible, not absorbed', () => {
  const full = scanTree(REPO_ROOT);

  it('loses specifiers when the ExportDeclaration arm is dropped', () => {
    // The concrete regression this refuses to leave uncovered: deleting
    // `isExportDeclaration` from the walk. Measured on this tree that arm
    // carries 109 of the 2793 specifiers.
    const withoutExports = scanTree(REPO_ROOT, { ...FULL_ARM, exports: false });
    expect(withoutExports.specifiers.length).toBeLessThan(full.specifiers.length);
  });

  it('loses specifiers when the ImportDeclaration arm is dropped', () => {
    const withoutImports = scanTree(REPO_ROOT, { ...FULL_ARM, imports: false });
    expect(withoutImports.specifiers.length).toBeLessThan(full.specifiers.length);
  });

  it('loses specifiers when the walk halts at its first match', () => {
    // An early `return` in the recursion. Measured: 900 of the 2793 survive.
    const truncated = scanTree(REPO_ROOT, { ...FULL_ARM, continueWalk: false });
    expect(truncated.specifiers.length).toBeLessThan(full.specifiers.length);
  });

  it('makes the two mechanisms DISAGREE, which is the arm that catches it', () => {
    // The three cases above show the damage is real; this one shows the guard
    // NOTICES. `specifiersFlat` is mechanism 2 and is untouched by `arm`, so a
    // damaged mechanism 1 is exactly the situation the integration cross-check
    // fails on. If a future edit removes an arm from the real walk, the matching
    // injection stops damaging anything and this assertion fails with it.
    const damaged = scanTree(REPO_ROOT, { ...FULL_ARM, exports: false });
    expect(damaged.specifiers.length).not.toBe(damaged.specifiersFlat.length);
  });
});

// ── behavior: the decision, on fixtures ──────────────────────────────

describe('Scenario: behavior — the decision, on fixture trees', () => {
  it('flags a relative import into packages/*/src with no extension', () => {
    withFixtureTree(
      {
        'tests/a.test.ts': `import { X } from '../../packages/peaks-loop-internal-runtime/src/index';\n`
      },
      (root) => {
        expect(decide(scanTree(root))).toEqual([
          {
            file: 'tests/a.test.ts',
            line: 1,
            text: '../../packages/peaks-loop-internal-runtime/src/index'
          }
        ]);
      }
    );
  });

  it('flags a relative import into src/ with no extension (the 5-of-22 shape)', () => {
    withFixtureTree(
      { 'tests/a.test.ts': `import { g } from '../../src/services/sop/sop-types';\n` },
      (root) => {
        expect(decide(scanTree(root))).toHaveLength(1);
      }
    );
  });

  it('flags an EXPORT declaration, not just an import', () => {
    withFixtureTree({ 'tests/a.test.ts': `export * from '../../packages/p/src/x';\n` }, (root) => {
      expect(decide(scanTree(root))).toHaveLength(1);
    });
  });

  it('passes .js, .mjs and .cjs specifiers', () => {
    withFixtureTree(
      {
        'tests/a.test.ts':
          `import { A } from '../../packages/p/src/a.js';\n` +
          `import { B } from '../../packages/p/src/b.mjs';\n` +
          `import { C } from '../../packages/p/src/c.cjs';\n`
      },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('ignores bare and aliased specifiers, which need no extension', () => {
    // `peaks-loop-internal-runtime` names a package but is NOT relative, and
    // `~/src/x` is a tsconfig `paths` alias — neither is TS2835.
    withFixtureTree(
      {
        'tests/a.test.ts':
          `import { A } from 'peaks-loop-internal-runtime';\n` +
          `import { B } from '~/src/services/sop/sop-types';\n` +
          `import { C } from 'node:path';\n`
      },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('reads a specifier in a COMMENT as prose, not as an import', () => {
    // A text scan would flag both of these; the AST walk cannot see them.
    withFixtureTree(
      {
        'tests/a.test.ts':
          `// measured: import { X } from '../../packages/p/src/x' was the TS2835 shape\n` +
          `const s = "from '../../src/services/sop/sop-types'";\n`
      },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('does not read a `vi.mock()` argument as an import specifier', () => {
    // The deliberate boundary from the header: a mock path is not type-checked
    // by TS2835, so it is out of this guard's rule.
    withFixtureTree(
      { 'tests/a.test.ts': `vi.mock('../../packages/p/src/x', () => ({}));\n` },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });
});

// ── render: the failure message ──────────────────────────────────────

describe('Scenario: render — the failure message names the file, the line and the specifier', () => {
  it('names each offending specifier and tells the reader what to append', () => {
    const message = describeViolations([
      {
        file: 'tests/unit/runtime/lifecycle.test.ts',
        line: 5,
        text: '../../../packages/p/src/lifecycle'
      }
    ]);
    expect(message).toContain('tests/unit/runtime/lifecycle.test.ts:5');
    expect(message).toContain("'../../../packages/p/src/lifecycle'");
    expect(message).toContain('.js');
  });

  it('says nothing at all when there is no violation', () => {
    expect(describeViolations([])).toBe('');
  });
});
