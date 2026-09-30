// tests/unit/standards/_vitest-worker-cap-scan.ts
//
// The scan library behind `tests/unit/standards/vitest-worker-cap.test.ts` —
// the same division `tests/unit/standards/_esm-relative-import-scan.ts` already
// uses: the machinery lives here, the collected scenario module keeps every
// case. The split is by the §4 line budget for `tests/**`, not by reach.
//
// WHY THIS GUARD EXISTS AT ALL (slice c5-verifier-concurrency, 2026-09-30)
//
// `vitest.workers.ts` is the declared single source of truth for the vitest
// worker count and its header claimed it was "shared by all four vitest
// configs". The repository had SEVEN configs; the three under `packages/*/`
// imported nothing and set no `pool` / `maxWorkers`, so each of them ran at
// vitest's own default of one fork per core — on a 16 GB box whose measured
// whole-program footprints are ~786 MB for one `tsc --noEmit` and ~985 MB for
// one type-aware eslint batch, which is how the host arrived at three
// `0x10E PFN_LIST_CORRUPT` bugchecks. The rot mechanism was a hand-maintained
// count in prose, so this scanner carries no list either: it enumerates the
// filesystem and reports what it finds, naming the drifting config.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { loadConfigFromFile } from 'vite';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** A project config: the basename is anchored on `vitest.config`. */
export const CENSUS_NAME = /^vitest\.config[^/\\]*\.ts$/;
/** Any name that ends in a vitest-config shape, anchored or not. */
const WIDER_NAME = /vitest\.config[^/\\]*\.ts$/;
/** The module every cap must trace back to, as a basename without extension. */
export const POLICY_MODULE = /^vitest\.workers$/;
/** Directories a walk must not enter: generated output and dependencies. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage']);

export type CapShape = 'policy' | 'literal' | 'absent' | 'untraceable';

export type ConfigFacts = {
  readonly file: string;
  readonly shape: CapShape;
};

export type Finding = {
  readonly file: string;
  readonly reason: string;
};

/**
 * Every `.ts` file under `dir`, as POSIX paths relative to `root`.
 *
 * Dot-directories are skipped on purpose: `.peaks/_runtime/**` keeps snapshots
 * of past sessions, and a `vitest.config.ts` copy in one is history, not a live
 * project config.
 */
export function listTsFiles(root: string, dir: string, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      listTsFiles(root ? `${root}/${entry.name}` : entry.name, join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(root ? `${root}/${entry.name}` : entry.name);
    }
  }
  return out;
}

/** Last POSIX path segment — the only thing either census predicate reads. */
export function baseName(file: string): string {
  const segments = file.split('/');
  return segments[segments.length - 1] ?? file;
}

/** The basename of a module specifier, minus any ESM or TS extension. */
export function moduleBasename(specifier: string): string {
  const segments = specifier.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? specifier;
  return last.replace(/\.[cm]?[jt]s$/, '');
}

/** Names this config binds to the shared policy module, however it imports it. */
function policyBindings(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!POLICY_MODULE.test(moduleBasename(statement.moduleSpecifier.text))) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const spec of bindings.elements) names.add(spec.name.text);
    }
  }
  return names;
}

/** The initializer of a top-level `const NAME = …`, if this file writes one. */
function constInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

/** Where a `maxWorkers` value actually comes from, through one hop of `const`. */
function shapeOfExpression(
  expr: ts.Expression,
  policy: Set<string>,
  source: ts.SourceFile,
  seen: Set<string>
): CapShape {
  if (ts.isNumericLiteral(expr) || ts.isStringLiteral(expr)) return 'literal';
  if (ts.isPropertyAccessExpression(expr)) {
    return POLICY_MODULE.test(moduleBasename(expr.getText())) ? 'policy' : 'untraceable';
  }
  if (!ts.isIdentifier(expr)) return 'untraceable';
  if (policy.has(expr.text)) return 'policy';
  if (seen.has(expr.text)) return 'untraceable';
  seen.add(expr.text);
  const initializer = constInitializer(source, expr.text);
  if (!initializer) return 'untraceable';
  return shapeOfExpression(initializer, policy, source, seen);
}

/**
 * Parse one config and report what its `maxWorkers` is.
 *
 * Comments are not AST nodes, so `// maxWorkers: workerCount` parses as ABSENT —
 * the mutation the substring-matching sibling guard
 * (`tests/unit/vitest-concurrency-guard.test.ts`) could not see.
 */
export function inspectConfig(file: string, text: string): ConfigFacts {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const policy = policyBindings(source);
  let shape: CapShape = 'absent';
  const visit = (node: ts.Node): void => {
    if (
      shape === 'absent' &&
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
    ) {
      const key = ts.isPropertyAssignment(node) ? node.name.getText() : node.name.text;
      if (key === 'maxWorkers') {
        const value = ts.isPropertyAssignment(node) ? node.initializer : node.name;
        shape = shapeOfExpression(value, policy, source, new Set<string>());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { file, shape };
}

/** The rule. Pure, so a fixture tree can be driven through the same code path. */
export function decide(facts: readonly ConfigFacts[]): Finding[] {
  const findings: Finding[] = [];
  for (const fact of facts) {
    if (fact.shape === 'policy') continue;
    const reason =
      fact.shape === 'absent'
        ? 'declares no `maxWorkers` at all, so it fans out to one fork per core'
        : fact.shape === 'literal'
          ? 'hard-codes `maxWorkers` as a number instead of importing `vitest.workers.ts`'
          : 'sets `maxWorkers` from something that does not trace back to `vitest.workers.ts`';
    findings.push({ file: fact.file, reason });
  }
  return findings;
}

/** The failure text: a bare rule name is useless across seven configs. */
export function describeFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return '';
  return (
    `${findings.length} vitest config(s) are outside the shared worker policy:\n` +
    findings.map((f) => `  - ${f.file}: ${f.reason}`).join('\n') +
    '\nImport `maxWorkers` from `vitest.workers.ts` (single source of truth, PEAKS_VITEST_MAX_WORKERS override).'
  );
}

/** The boundary rule, same shape: pure over a file list. */
export function boundaryFindings(tsFiles: readonly string[]): Finding[] {
  return tsFiles
    .filter((file) => WIDER_NAME.test(baseName(file)) && !CENSUS_NAME.test(baseName(file)))
    .filter((file) => !file.startsWith('tests/fixtures/'))
    .map((file) => ({
      file,
      reason:
        'a vitest-config-shaped file outside `tests/fixtures/` is invisible to the anchored census'
    }));
}

/**
 * A fixture tree under OS tmp — never inside `src/` or `tests/`, because a
 * fixture the other gates enumerate poisons the regenerated ceilings.
 */
export function withFixtureTree(
  files: Readonly<Record<string, string>>,
  body: (root: string) => void
): void {
  const root = mkdtempSync(join(tmpdir(), 'peaks-vitest-cap-'));
  try {
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

/** A config that does the right thing, for the controls that must PASS. */
export function cappedFixture(specifier: string): string {
  return (
    `import { defineConfig } from 'vitest/config';\n` +
    `import { maxWorkers as workerCount } from '${specifier}';\n\n` +
    `export default defineConfig({ test: { pool: 'forks', maxWorkers: workerCount } });\n`
  );
}

export type LoadedConfig = {
  config?: { test?: { pool?: string; maxWorkers?: number; fileParallelism?: boolean } };
  dependencies?: string[];
};

/**
 * Load a config the way vitest loads it: vite's own `loadConfigFromFile`, which
 * bundles it with esbuild and EVALUATES the bundle. That is what makes the
 * resolved `maxWorkers` real evidence rather than a grep — a cap that is only
 * mentioned in a comment, or a literal that happens to equal 2, still fails.
 *
 * The `command: 'test'` the runner actually passes is not in vite's published
 * union (`'build' | 'serve'`), and the result is typed as a loose record, so
 * both ends are admitted through `unknown`.
 */
export async function loadAsVitestDoes(repoRelPath: string): Promise<LoadedConfig | null> {
  const env: unknown = { command: 'test', mode: 'test', isPreview: false };
  const loaded: unknown = await loadConfigFromFile(
    env as Parameters<typeof loadConfigFromFile>[0],
    join(REPO_ROOT, repoRelPath)
  );
  return loaded as LoadedConfig | null;
}

/**
 * `git ls-files` reads the index plus the untracked-and-not-ignored pair, so it
 * sees a new file at the same moment the walk does — and it shares no recursion
 * with `listTsFiles`, which is the point of cross-measuring against it.
 */
export function gitProjectFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  return out.split('\n').filter((line) => line !== '');
}

/**
 * Walk `root`, keep every project-shaped vitest config, and report what each one
 * declares. One code path serves both the real tree and the fixture trees.
 */
export function configFactsUnder(root: string): ConfigFacts[] {
  return listTsFiles('', root, [])
    .filter((file) => CENSUS_NAME.test(baseName(file)))
    .map((file) => inspectConfig(file, readFileSync(join(root, file), 'utf8')));
}
