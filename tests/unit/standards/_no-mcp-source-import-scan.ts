// tests/unit/standards/_no-mcp-source-import-scan.ts
//
// The scan behind `no-mcp-source-import.test.ts`. Split out for the same reason
// `_file-size-cap-scan.ts` was: the guard file is a capped file under `tests/`,
// and the injection-control arms want the walker without the guard's own arms.
//
// TWO BOUNDARIES, ONE WALK.
//
//   1. NO MODULE IMPORTS MCP SOURCE. The read-only surface is designed so that
//      deleting the MCP module leaves the CLI and the pre-tool interceptor
//      unchanged (spec §1). That holds only while nothing outside the MCP module
//      imports INTO it - one `import` from `gate enforce` and the module stops
//      being removable. The root is declared once, here.
//
//   2. NO MODULE IMPORTS THE WHITELIST ARTIFACT. The generated whitelist is read
//      by the interceptor and the future server, both of which must survive the
//      MCP module's deletion, so it is DATA reached through the filesystem
//      (`readonly-whitelist.ts`). An `import` of the JSON would restore the static
//      edge AC-1 forbids.
//
// SPECIFIERS ARE READ FROM THE AST, NOT FROM THE TEXT. A regex over the file
// would match the very strings the injection-control arms PLANT, and the guard
// would then fail on itself. `typescript` is already a devDependency and
// `_file-size-cap-scan.ts` uses the same parser.
//
// REQUIRE() IS AN EDGE TOO (QA repair cycle 1, P2). The first version read only
// `ImportDeclaration` / `ExportDeclaration` / dynamic `import()`. A CommonJS
// `require('<root>/server.js')` is the same edge by a different spelling, and it
// was invisible, so `specifiersOf` now also reads `require(...)`,
// `<expr>.require(...)`, `createRequire(...)(...)` and TS `import x = require(...)`.
// What an AST cannot see is ALIASING (`const r = createRequire(import.meta.url);
// r('...')`) because that needs dataflow; the guard therefore stays a conservative
// AST scan and does not claim to decide aliased requires.

import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

/**
 * The declared MCP module root. Slice ② owns this path (the repository's prior
 * MCP subsystem lived at the same place, so it is the precedent, not a guess);
 * this guard is what makes moving it a deliberate act rather than a silent one.
 */
export const MCP_SURFACE_ROOT_REL = 'src/services/mcp';

/** The generated artifact that must stay data. */
export const READONLY_WHITELIST_ARTIFACT_REL = 'contracts/readonly-argv-whitelist.json';

/**
 * Directories the repo-wide scan walks, relative to the root.
 *
 * WHY THESE FIVE (QA repair cycle 1, P2):
 *   - `src`     the shipped CLI - where an import edge would break deletability.
 *   - `scripts` repo automation that also runs in this process (`tsx scripts/...`).
 *   - `tests`   the suite itself. A test OUTSIDE the module's own mirror directory that
 *               imports MCP source makes the module undeletable for every OTHER suite;
 *               a test that mirrors the root is that module's own test (see
 *               `isMcpModuleTest`) and is exempt.
 *   - `bin`     the CLI ENTRY the three-layer proof actually launches (`node bin/peaks.js`).
 *               Excluding it meant an edge from the entry point to MCP source was invisible.
 *   - `packages` the workspace packages (each package's `src` and `tests`); they are
 *               repo sources with real relative-import edges.
 *
 * DELIBERATELY EXCLUDED, and why (asserted by `no-mcp-source-import.test.ts`):
 *   - `dist`, `node_modules`, `.git`, `.husky`, `coverage` - generated or third-party
 *     (already in `SKIPPED_DIRS`); `dist` mirrors `src`'s edges, so scanning it would
 *     only duplicate findings on a build that may not exist.
 *   - `config` and the root-level `*.ts` files (`vitest*.ts`, `stryker*.js`) - build and
 *     test TOOLING config, not runtime modules; none can be an import edge of the CLI.
 *   - root-level `*.md` / `*.json` - not modules.
 */
export const SCAN_ROOTS = ['src', 'scripts', 'tests', 'bin', 'packages'] as const;

/**
 * A TEST file that mirrors the MCP root may import into it (slice ②, rid-036).
 *
 * WHY THIS EXEMPTION EXISTS, AND WHY IT IS NARROW. The invariant is about the
 * SHIPPED tree: delete `src/services/mcp/` and the CLI and the pre-tool
 * interceptor are unchanged (spec §1) — that is what "deletable" means, and the
 * second half of AC-1 states it as "the existing tests stay green". A test that
 * lives at `tests/**\/services/mcp/**` is a test OF that module: it is deleted
 * with it, and it was not an existing test before the module shipped. Forbidding
 * it would not protect the invariant, it would make the new module untestable —
 * and the design's own test matrix (§10) asks for exactly these tests
 * (per-channel L3 coverage, argument injection, bounded returns, per-argv
 * timeouts), none of which is expressible without reaching the code.
 *
 * The exemption is a path MIRROR, not a blanket `tests/` exemption: a test that
 * sits anywhere else and reaches into the root is still a finding, and
 * `no-mcp-source-import.test.ts` carries a control arm for exactly that — so the
 * rule can still fail.
 */
export const MCP_MODULE_TEST_SEGMENT = '/services/mcp/';

/**
 * A tests ROOT, anchored at position 0: the repository's own `tests/`, or a
 * workspace package's `packages/<name>/tests/`.
 *
 * WHAT ANCHORING EXCLUDES. The predicate below used to accept any path with a
 * segment spelled `tests`, so a directory that merely NAMED itself that way
 * (`src/tests/...`, `scripts/tests/...`) bought an exemption it was never meant
 * to have — shipped code and repo automation could opt out of the invariant by
 * choosing a directory name. The comment above the exemption says
 * `tests/**\/services/mcp/**`; this pattern is what makes that sentence true.
 */
const TESTS_ROOT_PATTERN = /^(?:tests\/|packages\/[^/]+\/tests\/)/;

/**
 * Is this path that module's OWN test?
 *
 * Narrowed in QA repair cycle 1 (F-2) from
 * `startsWith('tests/') || includes('/tests/')`. The tests-root form covers
 * exactly the same files on this tree — measured delta `[]`, all 5 real MCP
 * test files still exempt — and does not cover the two over-broad forms. The
 * control arm in `no-mcp-source-import.test.ts` (a test outside the mirror that
 * still reaches in) is reported under it too, so the rule can still fail.
 */
function isMcpModuleTest(relativePath: string): boolean {
  return TESTS_ROOT_PATTERN.test(relativePath) && relativePath.includes(MCP_MODULE_TEST_SEGMENT);
}

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.cts', '.mjs', '.cjs', '.js'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.husky']);

export type ForbiddenRule = 'mcp-source-import' | 'whitelist-artifact-import';

export interface ForbiddenImportFinding {
  /** Path relative to the scanned root, POSIX separators. */
  readonly file: string;
  readonly specifier: string;
  readonly rule: ForbiddenRule;
  readonly message: string;
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

/** Every source file under the given root directories. Missing roots yield nothing. */
export function sourceFilesUnder(root: string, dirs: readonly string[] = SCAN_ROOTS): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        walk(join(absolute, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
      found.push(join(absolute, entry.name));
    }
  };
  for (const dir of dirs) {
    const absolute = join(root, dir);
    try {
      if (statSync(absolute).isDirectory()) walk(absolute);
    } catch {
      continue;
    }
  }
  return found;
}

/**
 * A call whose first argument is a module specifier: `require('x')`,
 * `mod.require('x')`, `require.resolve('x')`, `createRequire(url)('x')`. Returns
 * the first argument node when the callee has one of those shapes, else
 * `undefined` - the callee test deliberately does NOT require the argument to be a
 * string literal, so the caller's `take` applies the same string-literal rule as
 * every other form.
 */
function requireCallArgument(node: ts.CallExpression): ts.Expression | undefined {
  const callee = node.expression;
  const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
  if (isDynamicImport) return node.arguments[0];
  const isMemberOfRequire =
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'require';
  const isBareRequire =
    (ts.isIdentifier(callee) && callee.text === 'require') ||
    isMemberOfRequire ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 'require') ||
    (ts.isCallExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'createRequire');
  return isBareRequire ? node.arguments[0] : undefined;
}

/**
 * Every module specifier a file names - static imports, re-exports, dynamic
 * imports and the CommonJS `require()` family (see `requireCallArgument`).
 */
export function specifiersOf(file: string, text?: string): string[] {
  const source = text ?? readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const take = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteral(node)) specifiers.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) take(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      // TS `import x = require('<specifier>')` - the CommonJS edge in TS syntax.
      if (ts.isExternalModuleReference(node.moduleReference)) {
        take(node.moduleReference.expression);
      }
    } else if (ts.isCallExpression(node)) {
      take(requireCallArgument(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

/**
 * Normalize a specifier to a repo-relative POSIX path, or `undefined` when it
 * leaves the repository (a bare package name, a `node:` builtin).
 */
export function normalizeSpecifier(file: string, root: string, specifier: string): string | undefined {
  if (specifier.startsWith('node:')) return undefined;
  const aliased = /^~\/src\/(.*)$/.exec(specifier);
  const aliasedRest = aliased?.[1];
  if (aliasedRest !== undefined) return toPosix(join('src', aliasedRest));
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined;
  return toPosix(relative(root, resolve(dirname(file), specifier)));
}

/** Does this repo-relative path live inside the MCP module root? */
export function isInsideMcpRoot(relativePath: string): boolean {
  const prefix = `${MCP_SURFACE_ROOT_REL}/`;
  return relativePath.startsWith(prefix);
}

export interface ScanOptions {
  readonly roots?: readonly string[];
}

/** Scan a repository root and report every forbidden import it finds. */
export function scanForbiddenImports(root: string, options: ScanOptions = {}): ForbiddenImportFinding[] {
  const findings: ForbiddenImportFinding[] = [];
  for (const file of sourceFilesUnder(root, options.roots ?? SCAN_ROOTS)) {
    const relativeFile = toPosix(relative(root, file));
    const importerIsMcpSource = isInsideMcpRoot(relativeFile) || isMcpModuleTest(relativeFile);
    for (const specifier of specifiersOf(file)) {
      const normalized = normalizeSpecifier(file, root, specifier);
      if (normalized === undefined) continue;
      if (!importerIsMcpSource && isInsideMcpRoot(normalized)) {
        findings.push({
          file: relativeFile,
          specifier,
          rule: 'mcp-source-import',
          message: `${relativeFile} imports MCP source (${specifier}). The MCP module must stay deletable: nothing outside ${MCP_SURFACE_ROOT_REL}/ may import into it.`
        });
        continue;
      }
      if (normalized.endsWith(READONLY_WHITELIST_ARTIFACT_REL)) {
        findings.push({
          file: relativeFile,
          specifier,
          rule: 'whitelist-artifact-import',
          message: `${relativeFile} imports the generated whitelist artifact (${specifier}). It is DATA: read it through readonly-whitelist.ts so no module depends on it statically.`
        });
      }
    }
  }
  return findings;
}
