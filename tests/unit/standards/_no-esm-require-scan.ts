// tests/unit/standards/_no-esm-require-scan.ts
//
// The scan machinery behind `tests/unit/standards/no-esm-require-mixing.test.ts` — the
// guard that refuses a `require(` call whose `require` identifier no `createRequire`
// in the same file binds, across the ESM-source census (`src/`, `scripts/`, `bin/`,
// `.husky/`, `packages/<pkg>/src/`).
//
// WHY THE MACHINERY IS A SEPARATE FILE
//
// The guard carries the rationale header, the scenario blocks and every assertion
// literal. With the walk, the two collectors, the git cross-check, the binding analysis
// and the fixture harness in one file it crossed the `tests/**` line budget, so it is
// split the way `tests/unit/standards/_esm-relative-import-scan.ts` split the TS2835
// guard: MECHANISM here, SCENARIO there.
//
// This is a scan LIBRARY, not a test file. The unit config collects `**/*.test.ts`, so
// this module is never a scenario module and declares no dimensions of its own. It is
// under `tests/`, so the TS2835 guard walks it — every relative specifier below carries
// its `.js` extension for that reason (it has none: every import here is bare).
//
// THE TWO COLLECTORS ARE THE POINT, AND THEY STAY TWO
//
// mechanism 1 (AST) answers "which `require` calls are unbound?"; mechanism 2 (text)
// answers "which lines mention `require`?". Mechanism 2 is a strict SUPERSET by
// construction — a call needs the token — and the guard asserts that inclusion on the
// live tree, so a mechanism 1 that stops reporting fails there instead of agreeing
// quietly with an empty partner. Neither shares a traversal with the other.

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
import { basename, dirname, extname, join, relative as relativePath, sep } from 'node:path';

import * as ts from 'typescript';

/** The census roots, exactly as the guard states them. */
export const SCOPE_ROOTS: readonly string[] = ['src', 'scripts', 'bin', '.husky', 'packages'];

/** `packages/<pkg>/src/…` — the only `packages` subtree in the census. */
export const PACKAGES_SRC = /^packages\/[^/]+\/src\//;

/** The `SCOPE_ROOTS` entries that are wholly in scope. */
const SCOPE_DIRS: readonly string[] = ['src', 'scripts', 'bin', '.husky'];

const SCANNABLE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs'
];

/**
 * Extensions the census may hold unscanned: data, prose and shell. A census file whose
 * extension is on neither this list nor `SCANNABLE_EXTENSIONS` is enumerated by
 * `listOffListFromGit`, so a new `src/x.jsx` fails the guard instead of being invisible
 * to both the scan and the reconciliation.
 */
const NON_CODE_EXTENSIONS: readonly string[] = ['.json', '.md', '.sh', '.ps1', '.sql'];

const EXCLUDED: readonly string[] = ['dist', 'node_modules'];

/** The module specifiers that can supply `createRequire`. */
const CJS_MODULES: readonly string[] = ['node:module', 'module'];

/**
 * The objects a shim reaches `require` through. `globalThis.require = createRequire(…)`
 * is the reintroduction this sweep's own auditors reached for, and `module.require` is
 * the same hole under a second spelling; neither is a local binding `readBindings` sees.
 */
const SHIM_REQUIRE_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'module']);

/**
 * A line that MENTIONS `require` as a token — mechanism 2. Deliberately wider than a
 * call: the property spellings (`globalThis.require(`, `module.require(`), the same
 * family's `require.resolve(`/`require.cache`, comments and string literals all match.
 * Only the superset property is relied on, never the extra matches.
 */
const REQUIRE_MENTION = /(?:^|[^\w$])require\b\s*[.(]/;

/** Export the git argv once: `--directory` reports an ignored directory as ONE entry. */
const IGNORE_ARGV = ['ls-files', '--others', '--ignored', '--exclude-standard'] as const;

/** One unbound `require` call: where it is, and the source line it sits on. */
export interface RequireHit {
  /** Repo-relative, POSIX separators — the form an operator can paste. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** One line that mentions `require` — mechanism 2's unit. */
export interface Mention {
  readonly file: string;
  readonly line: number;
}

/**
 * Which arms of the scan to run. The default is every arm; the non-default values exist
 * only for the injection cases, which need the damage they request to be observable.
 * Routing the damage through the SAME parameters the real scan reads means an edit that
 * removes an arm also removes the ability to honour its injection — the injection then
 * stops damaging anything and its case fails, instead of passing beside a damaged scan.
 */
export interface Arm {
  /** `false` models a walk that enumerates files but never reads them. */
  readonly read: boolean;
  /** `false` models a call collector that never fires. */
  readonly calls: boolean;
}

export const FULL_ARM: Arm = { read: true, calls: true };

export interface TreeScan {
  readonly files: readonly string[];
  /** Mechanism 1 — unbound `require` calls, the forward assertion's subject. */
  readonly hits: readonly RequireHit[];
  /** Mechanism 2 — every line mentioning `require`, the inclusion arm's other side. */
  readonly mentions: readonly Mention[];
}

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** `path`, as a repo-relative POSIX path, is inside the census. */
export function isInScope(rel: string): boolean {
  if (PACKAGES_SRC.test(rel)) return true;
  return SCOPE_DIRS.some((dir) => rel.startsWith(`${dir}/`));
}

function isExcluded(rel: string): boolean {
  return rel.split('/').some((segment) => EXCLUDED.includes(segment));
}

type Accept = (rel: string) => boolean;

/**
 * The paths GIT IGNORES under the census roots, repo-relative, POSIX, with a trailing
 * `/` marking a whole ignored directory. The walk enumerates the filesystem while the
 * git leg enumerates with `--exclude-standard`, so without this a gitignored file under
 * a census root sits in one set and not the other — a false positive that reads like a
 * real regression. `.husky/_/` holds seventeen such entries today and escapes only
 * because every one of them happens to be extensionless. A root that is not a git
 * working tree (the fixture trees live outside git) has no ignore rules to read, so it
 * prunes nothing there.
 */
export function listIgnoredFromGit(root: string): readonly string[] {
  try {
    const args = [...IGNORE_ARGV, '--directory', '--', ...SCOPE_ROOTS];
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // Repo convention: every child_process call site pins this, or Windows flashes a console.
      windowsHide: true
    })
      .split('\n')
      .filter((path) => path.length > 0);
  } catch {
    return [];
  }
}

/**
 * `rel` is ignored: a directory entry matches by PREFIX, a file entry by its whole path —
 * never by substring, so `.husky/_extra/a.ts` is not under `.husky/_/`.
 */
export function isGitIgnored(rel: string, ignored: readonly string[]): boolean {
  return ignored.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));
}

function listFiles(
  dir: string,
  root: string,
  accept: Accept,
  ignored: readonly string[],
  out: string[] = []
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = toPosix(relativePath(root, full));
    if (isExcluded(rel) || isGitIgnored(rel, ignored)) continue;
    if (entry.isDirectory()) listFiles(full, root, accept, ignored, out);
    else if (entry.isFile() && accept(rel)) out.push(full);
  }
  return out;
}

const isScannable: Accept = (rel) => isInScope(rel) && SCANNABLE_EXTENSIONS.includes(extname(rel));

/**
 * A census file the extension filter drops for carrying no extension at all. A dotfile
 * such as `.gitkeep` is a placeholder, not a script without an extension, so it is not
 * this population — the filter is "no dot in the basename and not a dotfile".
 */
const isExtensionless: Accept = (rel) => {
  const name = basename(rel);
  return isInScope(rel) && !name.startsWith('.') && !name.includes('.');
};

/**
 * A census file that is neither scannable, nor extensionless, nor a declared non-code
 * type — e.g. `src/x.jsx`, which before this arm was invisible to both the scan and the
 * reconciliation.
 */
const isOffList: Accept = (rel) => {
  const name = basename(rel);
  if (!isInScope(rel) || name.startsWith('.') || !name.includes('.')) return false;
  const ext = extname(rel);
  return !SCANNABLE_EXTENSIONS.includes(ext) && !NON_CODE_EXTENSIONS.includes(ext);
};

/**
 * The census as GIT reports it — `--cached` (in the index) unioned with `--others
 * --exclude-standard` (on disk, not ignored) — narrowed by `accept`. This is the
 * independent enumeration the guard cross-checks the walk against, and the reason a new
 * file costs no literal edit: git sees it, the walk sees it, and the two sets are
 * compared rather than two integers.
 *
 * A tracked file deleted but not yet staged is still listed by `--cached` and is not a
 * file the walk can see, so the index entry is dropped by an existence check.
 */
function listCensusFromGit(root: string, accept: Accept): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCOPE_ROOTS],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // Repo convention: every child_process call site pins this, or Windows flashes a console.
      windowsHide: true
    }
  );
  return listed
    .split('\n')
    .filter((path) => path.length > 0)
    .filter((path) => accept(path) && !isExcluded(path))
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

/** The scannable census — the files the forward assertion is stated over. */
export function listFilesFromGit(root: string): string[] {
  return listCensusFromGit(root, isScannable);
}

/**
 * The census files that carry NO extension — enumerated separately so the extension
 * filter above is a STATED boundary rather than a silent skip: a new extensionless file
 * under a census root changes this list and fails the guard, which is the moment to
 * decide whether it is a scan target or not.
 */
export function listExtensionlessFromGit(root: string): string[] {
  return listCensusFromGit(root, isExtensionless);
}

/** The census files whose extension is on neither stated list — asserted empty. */
export function listOffListFromGit(root: string): string[] {
  return listCensusFromGit(root, isOffList);
}

function parse(text: string, fileName: string): ts.SourceFile {
  const scriptKind =
    fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
}

interface Bindings {
  /** Names that ARE `createRequire` (imported under any local spelling). */
  readonly createRequireNames: ReadonlySet<string>;
  /** Names bound by calling `createRequire(...)` — the sanctioned CJS handle. */
  readonly requireNames: ReadonlySet<string>;
}

/**
 * Which `require` spellings this file sanctions. Only `createRequire` counts: any other
 * way of producing a `require` identifier is exactly what the rule refuses, so an
 * unbound call and a home-made binding are reported alike.
 *
 * The module-object shape (`import * as m from 'node:module'` then
 * `m.createRequire(...)`) is read too, because it is the same sanction written
 * differently and a guard that missed it would refuse correct code.
 */
function readBindings(sourceFile: ts.SourceFile): Bindings {
  const createRequireNames = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || !CJS_MODULES.includes(specifier.text)) continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) namespaces.add(clause.name.text);
    const named = clause.namedBindings;
    if (named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      namespaces.add(named.name.text);
      continue;
    }
    for (const element of named.elements) {
      const imported =
        element.propertyName === undefined ? element.name.text : element.propertyName.text;
      if (imported === 'createRequire') createRequireNames.add(element.name.text);
    }
  }
  const requireNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (isCreateRequireCall(node.initializer, createRequireNames, namespaces)) {
        for (const name of boundNames(node.name)) requireNames.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { createRequireNames, requireNames };
}

function isCreateRequireCall(
  expression: ts.Expression,
  createRequireNames: ReadonlySet<string>,
  namespaces: ReadonlySet<string>
): boolean {
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) return createRequireNames.has(callee.text);
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return callee.name.text === 'createRequire' && namespaces.has(callee.expression.text);
  }
  return false;
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) names.push(...boundNames(element.name));
  }
  return names;
}

/** The leftmost identifier of a callee — `require`, or `require` in `require.resolve`. */
function requireRootName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return requireRootName(expression.expression);
  }
  return undefined;
}

/**
 * A shim call: `globalThis.require(...)` / `module.require(...)`, and the same pair's
 * `require.resolve` continuations. The chain is walked rather than the outermost name
 * read, so `module.require.resolve(` is caught by the same predicate.
 */
function isShimRequireCallee(expression: ts.Expression): boolean {
  let node: ts.Expression = expression;
  let sawRequire = false;
  while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'require') sawRequire = true;
    node = node.expression;
  }
  return sawRequire && ts.isIdentifier(node) && SHIM_REQUIRE_OBJECTS.has(node.text);
}

/**
 * A `createRequire` binding sanctions the IDENTIFIER `require` in that file and nothing
 * else, so a shim spelled through an object is refused whether or not one is bound.
 */
function isRefusedCall(callee: ts.Expression, sanctioned: boolean): boolean {
  if (isShimRequireCallee(callee)) return true;
  return !sanctioned && requireRootName(callee) === 'require';
}

function collectUnboundCalls(sourceFile: ts.SourceFile, rel: string, arm: Arm): RequireHit[] {
  const found: RequireHit[] = [];
  if (!arm.calls) return found;
  const bindings = readBindings(sourceFile);
  const sanctioned =
    bindings.createRequireNames.has('require') || bindings.requireNames.has('require');
  const lines = sourceFile.text.split('\n');
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRefusedCall(node.expression, sanctioned)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ file: rel, line: line + 1, text: (lines[line] ?? '').trim() });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function collectMentions(text: string, rel: string, out: Mention[]): void {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (REQUIRE_MENTION.test(lines[index] ?? '')) out.push({ file: rel, line: index + 1 });
  }
}

/**
 * Walk the census. `root` is a parameter rather than the module constant so the decision
 * can be driven from a fixture; `arm` so the injection cases can drive the same scan
 * damaged; `ignored` so the pruning can be driven the same way, defaulting to git's
 * answer for the tree being walked.
 */
export function scanTree(
  root: string,
  arm: Arm = FULL_ARM,
  ignored: readonly string[] = listIgnoredFromGit(root)
): TreeScan {
  const files: string[] = [];
  const hits: RequireHit[] = [];
  const mentions: Mention[] = [];
  for (const tree of SCOPE_ROOTS) {
    for (const file of listFiles(join(root, tree), root, isScannable, ignored)) {
      files.push(file);
      const rel = toPosix(relativePath(root, file));
      const text = arm.read ? readFileSync(file, 'utf8') : '';
      collectMentions(text, rel, mentions);
      // The verdict is ALWAYS AST; this only skips parsing a file that cannot hold a
      // `require` token at all. It runs after the walk has produced its whole file
      // list, so it can never shorten the walk.
      if (!text.includes('require')) continue;
      hits.push(...collectUnboundCalls(parse(text, file), rel, arm));
    }
  }
  return { files, hits, mentions };
}

/** Unbound `require` calls, deduplicated per line and ordered so the report reads. */
export function decide(scan: TreeScan): readonly RequireHit[] {
  const seen = new Set<string>();
  const out: RequireHit[] = [];
  for (const hit of scan.hits) {
    const key = `${hit.file}:${hit.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out.sort((left, right) =>
    left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1
  );
}

/**
 * The message the guard fails with — asserted under `render`. It names the defect's
 * runtime shape (`require is not defined`) rather than merely the rule, because the
 * reader's next question is what breaks and when.
 */
export function describeViolations(violations: readonly RequireHit[]): string {
  if (violations.length === 0) return '';
  return (
    `${violations.length} \`require(\` call(s) are not bound by \`createRequire\`, so each ` +
    `one throws \`require is not defined\` the moment it runs (every package here declares ` +
    `\`"type": "module"\`). Convert each to a top-level ESM \`import\` — or bind it with ` +
    `\`createRequire(import.meta.url)\` when the path is computed at runtime: ` +
    violations.map((v) => `${v.file}:${v.line} ${v.text}`).join(' | ')
  );
}

export function withFixtureTree(
  files: Readonly<Record<string, string>>,
  body: (root: string) => void
): void {
  const root = mkdtempSync(join(tmpdir(), 'peaks-esm-require-'));
  try {
    // `scanTree` walks every root in SCOPE_ROOTS, so each fixture must materialise all
    // of them — a missing one throws ENOENT and every behavior case dies for a reason
    // that has nothing to do with the decision under test. `listFiles` stays strict: a
    // missing root is a real error, not something to swallow.
    for (const tree of SCOPE_ROOTS) mkdirSync(join(root, tree), { recursive: true });
    mkdirSync(join(root, 'packages', 'fixture-pkg', 'src'), { recursive: true });
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
