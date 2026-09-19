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
//            number of files and the number of relative specifiers are pinned,
//            so a walk that returns early, drops `ExportDeclaration`, or
//            quietly narrows its root fails HERE instead of passing below.
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

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
 * `case-XXXX/*.test.ts` files there and removes them in `afterEach`, so a walk
 * that did not skip that directory could observe a fixture mid-flight and move
 * the pinned specifier total by ±1. A pin that is right only when it loses a
 * race is worse than no pin at all.
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

/**
 * Every RELATIVE module specifier written by an import OR export declaration.
 *
 * The walk recurses with `forEachChild` on every node it visits — including the
 * declarations it already matched — so nothing is skipped by an early return.
 */
function collectRelativeSpecifiers(
  sourceFile: ts.SourceFile,
  file: string,
  root: string
): Specifier[] {
  const found: Specifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (
        specifier !== undefined &&
        ts.isStringLiteral(specifier) &&
        isRelativeSpecifier(specifier.text)
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile));
        found.push({
          file: toPosix(relativePath(root, file)),
          line: line + 1,
          text: specifier.text
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

interface TreeScan {
  readonly files: readonly string[];
  readonly specifiers: readonly Specifier[];
}

/**
 * Walk a source tree. `root` is a parameter rather than the module constant so
 * the decision below can be driven from a fixture (see the behavior cases).
 */
function scanTree(root: string): TreeScan {
  const files: string[] = [];
  const specifiers: Specifier[] = [];
  for (const tree of TREES) {
    for (const file of listTsFiles(join(root, tree), root)) {
      files.push(file);
      specifiers.push(...collectRelativeSpecifiers(parse(file), file, root));
    }
  }
  return { files, specifiers };
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

  it('visits every .ts file under src/ + tests/ (the root is pinned, not sampled)', () => {
    // A probe that samples nothing reports green for the whole space. These two
    // pins are asserted separately so a reader can tell WHICH one moved: this one
    // moves only when a `.ts` file is added to or removed from `src/` or `tests/`.
    //
    // 1192 -> 1193 (slice S3c): +1 is `tests/unit/_setup/first-of.ts`, the shared
    // `firstOf` helper that replaces 29 unchecked `result[0]` reads.
    //
    // 1193 -> 1194 (slice S5a): +1 is
    // `tests/unit/lint/silent-warning-grace-marker.test.ts`, which pins the
    // silent-warning grace marker against the real prettier. A new file is the
    // documented reason this pin moves.
    // 1194 -> 1195 (slice rid-s6-slow-test-timeouts): +1 is
    // `tests/unit/_setup/subprocess-timeouts.ts`, the shared measured budgets for
    // the tests whose cost is a real process spawn. As in S3c and S5a, a new file
    // is the documented reason this pin moves.
    expect(scan.files.length).toBe(1195);
  });

  it('visits every relative specifier in those files (the recursion is pinned)', () => {
    // A walk that stops early, or that drops one node kind, reports green for
    // everything it no longer reaches — measured: deleting `isExportDeclaration`
    // from the condition below left the violation assertion GREEN while silently
    // dropping 109 specifiers, and only this pin caught it.
    //
    // So this number is a PIN, not trivia. It moves when a relative import or
    // export is added to or removed from `src/` or `tests/`. A change that leaves
    // the tree alone but moves this number means the WALK changed — read the
    // `collectRelativeSpecifiers` recursion before touching the constant.
    //
    // 2715 -> 2717 (slice S3c): +2 is the `'../_setup/first-of.js'` import added
    // to `codegraph-capability-fallback.test.ts` and
    // `codegraph-resolved-path-capability.test.ts`. Both carry the `.js` extension
    // the rule requires, which is why the violation assertion below is unaffected.
    //
    // 2717 -> 2718 (slice S3e): +1 is the `type SkillPresenceLease` import added
    // to `tests/integration/skill-presence-lease-gc.test.ts` so its `stale` lease
    // fixture is declared as the contract type instead of an untyped literal. It
    // carries the `.js` extension the rule requires, so — as with S3c — the
    // violation assertion below is unaffected. `scan.files.length` did NOT move:
    // no `.ts` file was added or removed.
    //
    // 2718 -> 2719 (slice S5a): +1 is the `'../_setup/4dim-template.js'` import in
    // the new `tests/unit/lint/silent-warning-grace-marker.test.ts`. It carries
    // the `.js` extension the rule requires, so — as with S3c and S3e — the
    // violation assertion below is unaffected. `scan.files.length` moved by +1
    // as well, in the pin above.
    // 2719 -> 2727 (slice rid-s6-slow-test-timeouts): +8 is the
    // `'../_setup/subprocess-timeouts.js'` / `'../../_setup/subprocess-timeouts.js'`
    // import added to each of the eight test files that now carry an explicit
    // budget — service-shutdown, the two final-review suites,
    // codegraph-config-restore, codegraph-config-repair, codegraph-exclude-repair,
    // pre-tool-superpowers-bridge and no-ai-co-author-trailer. All eight carry the
    // `.js` extension the rule requires, so — as with S3c, S3e and S5a — the
    // violation assertion below is unaffected. `scan.files.length` moved by +1 as
    // well, in the pin above.
    // 2727 -> 2710 (slice rid-s7-mechanical-and-type-quality): −17, the net
    // number of relative specifiers removed when that slice deleted unused
    // import bindings. The removed names are all relative modules, so the
    // violation assertion below is unaffected — no `.js` extension was
    // dropped, a whole specifier was. `scan.files.length` is unchanged.
    expect(scan.specifiers.length).toBe(2710);
  });

  it('reaches every relative specifier that crosses into packages/*/src', () => {
    // The class that prompted the slice, pinned separately: 17 of the 22
    // measured TS2835 errors pointed here (the other 5 pointed into `src/**`),
    // plus 2 that were already correct — `tests/unit/runtime/process-supervisor.test.ts`
    // and `tests/unit/services/ecc/ecc-materialize.test.ts`.
    const inPackagesScope = scan.specifiers.filter((specifier) =>
      PACKAGES_SRC.test(specifier.text)
    );
    expect(inPackagesScope.length).toBe(19);
  });

  it('finds no relative specifier missing its ESM extension', () => {
    expect(violations, describeViolations(violations)).toEqual([]);
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
