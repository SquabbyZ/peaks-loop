// tests/unit/standards/_esm-relative-import-scan.ts
//
// The scan machinery behind
// `tests/unit/standards/esm-relative-import-extension.test.ts` — the guard that
// requires every RELATIVE import/export specifier under the wide tsconfig's include
// set (`src/` + `tests/`) to carry an explicit ESM extension (`.js` / `.mjs` / `.cjs`),
// the way `moduleResolution: NodeNext` demands (TS2835).
//
// WHY IT LIVES HERE
//
// The guard file carries a long rationale header and four scenario blocks; with the
// traversal, the two collector mechanisms, the git cross-check, the decision and the
// fixture harness in the same file it sat over the 500-raw-line cap for `tests/**`. The
// cap is a line budget, not a design change, so the seam chosen here is the one the
// guard already had: MECHANISM vs SCENARIO. Everything below was moved byte-for-byte out
// of the guard (the only edit is the `export ` prefix on the nine names the guard reads
// back); the guard keeps its full header, all four scenarios, all eighteen cases, and
// every assertion literal unchanged.
//
// WHAT THIS MODULE MUST NOT LOSE
//
// The two collectors are the point, and they must stay two: mechanism 1 recurses with
// `forEachChild` and honours `arm`; mechanism 2 is one flat pass over top-level
// statements and reads no `arm`. The guard's reach cross-check is those two agreeing, so
// a refactor that collapses them into one — or that has mechanism 2 call mechanism 1 —
// turns the anti-weakening arm into a tautology. The same argument keeps `root`, `arm` and
// `TREES` as the inputs the walk actually reads: `scanTree` is driveable from a fixture
// root and a damaged arm precisely so the injections in the guard stay observable rather
// than simulated by a private copy of the walk.
//
// This module is a scan LIBRARY, not a test file: it has no `.test.ts` suffix, so the
// unit config (`include: tests/unit/**/*.test.ts`) does not collect it, and it declares no
// dimensions of its own (there is no scenario here to attribute). It is, however, a file
// under `tests/`, so the guard whose machinery it holds walks it — every relative specifier
// below carries its `.js` extension for exactly that reason.

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
import { dirname, join, relative as relativePath, sep } from 'node:path';

import * as ts from 'typescript';
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
export const PACKAGES_SRC = /(?:^|\/)packages\/[^/]+\/src\//;

export interface Specifier {
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

export const FULL_ARM: Arm = { imports: true, exports: true, continueWalk: true };

export function toPosix(path: string): string {
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
export function listTsFilesFromGit(root: string): string[] {
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
export function scanTree(root: string, arm: Arm = FULL_ARM): TreeScan {
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
export function decide(scan: TreeScan): readonly Specifier[] {
  return scan.specifiers.filter((specifier) => !ESM_EXTENSION.test(specifier.text));
}

/**
 * The message the guard fails with — asserted under `render`.
 *
 * `root` is the scanned root so the paths read as the operator's checkout sees
 * them (`tests/unit/...`), not as this machine's tmp directory.
 */
export function describeViolations(violations: readonly Specifier[]): string {
  if (violations.length === 0) return '';
  return (
    `${violations.length} relative import/export specifier(s) omit the explicit ESM extension ` +
    `NodeNext requires (TS2835). Append \`.js\` (TypeScript's ESM convention: write \`.js\`, ` +
    `the emitted file is that file): ` +
    violations.map((v) => `${v.file}:${v.line} '${v.text}'`).join(', ')
  );
}

export function withFixtureTree(
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
