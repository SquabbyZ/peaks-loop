/**
 * A throwaway vitest config whose `include` is exactly the caller's test files.
 *
 * THE DEFECT THIS EXISTS FOR. `peaks mut run --test-files <a> <b>` passed the
 * files to Stryker, but Stryker loads the project's `stryker.conf.js`, which
 * points `vitest.configFile` at `stryker.vitest.config.mjs` — a config whose
 * `include` names TWO hard-coded test files. Vitest filters `--test-files`
 * through that `include`, so any other file selected ZERO tests and the dry run
 * aborted with "No tests were executed". Measured 2026-11-17: a brand-new test
 * file for a brand-new module could not be mutation-tested at all. The
 * `--test-files` option was effectively decorative for every file outside those
 * two.
 *
 * WHY NOT JUST WIDEN THE PROJECT CONFIG'S `include`. `stryker.vitest.config.mjs`
 * is also what a direct `npx stryker run` uses, and its narrow list is deliberate
 * there: the main suite contains CLI tests that call `process.chdir()`, which
 * Stryker's forced-threaded vitest workers reject. Widening it would break that
 * path. A per-run generated config leaves the project's own file exactly as its
 * author intended and gives `peaks mut` the selection the caller asked for.
 *
 * WHERE IT LIVES. Under the project's `.peaks/_runtime/<sid>/mut/`, which is
 * gitignored runtime state and is already in `alwaysIgnoredPatterns`, so the file
 * neither pollutes the tree nor gets copied into the Stryker sandbox.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export type GeneratedVitestConfig = {
  /** Absolute path of the config file that was written. */
  readonly configPath: string;
};

/** One `'<path>',` line for an array literal in the generated module. */
function includeLine(projectRoot: string, file: string): string {
  const rel = relative(projectRoot, resolve(projectRoot, file)).split(sep).join('/');
  return `      '${rel.replace(/'/g, "\\'")}',`;
}

/**
 * Write a vitest config under `<project>/.peaks/_runtime/<sid>/mut/` whose
 * `include` is exactly `testFiles`, and whose aliases match the project's own
 * `~/src/*` mapping so tests load exactly as they do normally.
 *
 * `setupFiles` is carried over from the project's config when the caller names
 * one: a suite that depends on global setup (the workspace build, for instance)
 * fails without it, and a mutation run that fails for a setup reason reports
 * mutants as killed when nothing ran.
 */
export function writeRunScopedVitestConfig(input: {
  readonly project: string;
  readonly sessionId: string;
  readonly testFiles: ReadonlyArray<string>;
  readonly setupFiles?: ReadonlyArray<string>;
}): GeneratedVitestConfig {
  const projectRoot = resolve(input.project);
  const outDir = join(projectRoot, '.peaks', '_runtime', input.sessionId, 'mut');
  mkdirSync(outDir, { recursive: true });
  const configPath = join(outDir, 'vitest.run-scoped.config.mjs');

  // PROJECT-RELATIVE, never absolute. Stryker copies the project into
  // `.stryker-tmp/sandbox-*` and evaluates this config THERE, so an absolute
  // path baked at generation time names the ORIGINAL tree — outside the
  // sandbox's `root`, which vitest then filters away, reporting zero tests.
  // Measured 2026-11-17: absolute includes produced exactly that.
  const includes = input.testFiles.map((f) => includeLine(projectRoot, f)).join('\n');
  const setup = (input.setupFiles ?? []).map((f) => includeLine(projectRoot, f)).join('\n');

  writeFileSync(configPath, renderConfigSource(includes, setup), 'utf8');
  return { configPath };
}

/** The module text a run-scoped config is made of. Separate from the file write
 *  so the template stays readable (and under the function-length cap). */
function renderConfigSource(includes: string, setup: string): string {
  return [
    '// GENERATED PER MUTATION RUN — do not edit, do not commit.',
    '//',
    '// Its `include` is exactly the test files this run was asked for, which is',
    "// what `--test-files` means. See writeRunScopedVitestConfig's header.",
    '',
    '// NO `vitest/config` IMPORT, and a PLAIN OBJECT export. A target project may',
    '// have no node_modules at all — the integration fixture deliberately has',
    '// none, to prove the runner is loaded from peaks-loop own installation — so',
    '// `import { defineConfig } from "vitest/config"` would fail to resolve and',
    '// the run would die before Stryker started. `defineConfig` is a typing',
    '// helper, not a requirement: vitest accepts an exported plain object.',
    '',
    '// NO `root`, AND RELATIVE `include`/`alias` BASE. Stryker evaluates this',
    '// config inside a copy of the project at `.stryker-tmp/sandbox-*`, so any',
    '// absolute path baked at generation time would name the ORIGINAL tree —',
    '// outside the sandbox — and vitest would filter every include away',
    '// (measured 2026-11-17: exactly zero tests selected that way). Omitting',
    '// `root` lets vitest use its own cwd, which is the sandbox.',
    'const projectRoot = process.cwd();',
    '',
    'export default {',
    '  resolve: {',
    '    alias: [',
    "      { find: /^~\\/src\\/(.*)$/, replacement: projectRoot + '/src/' + '$1' },",
    "      { find: /^~\\/src\\/(.*)\\.js$/, replacement: projectRoot + '/src/' + '$1' + '.ts' }",
    '    ]',
    '  },',
    '  test: {',
    '    include: [\n' + includes + '\n    ],',
    ...(setup === '' ? [] : ['    setupFiles: [\n' + setup + '\n    ],']),
    '    passWithNoTests: false',
    '  }',
    '};',
    ''
  ].join('\n');
}

/** Display path for a generated config, relative to the project when possible. */
export function displayConfigPath(project: string, configPath: string): string {
  const rel = relative(resolve(project), configPath);
  return rel === '' ? configPath : rel.split(sep).join('/');
}

/**
 * The `vitest` options for a run that names its test files.
 *
 * TWO THINGS, both required:
 *   - `related: false` — an explicit test list is authoritative, so vitest's
 *     related-mode narrowing must not discard it;
 *   - `configFile` — the generated config below, whose `include` IS the list.
 *     A project `stryker.conf.js` normally points at a config with a fixed
 *     short `include`, and vitest filters `--test-files` through it, so any
 *     other file selects ZERO tests and the dry run aborts with "No tests were
 *     executed". Measured 2026-11-17: a new test file could not be
 *     mutation-tested at all.
 *
 * WITHOUT A SESSION ID, `configFile` is OMITTED and only `related` is returned.
 * This function builds OPTIONS; it does not own the run's preconditions. An
 * earlier version threw here, which made every caller that only inspects the
 * built options — the package's own `stryker-options.test.ts` does exactly that
 * — supply a session id it has no use for. The requirement belongs where the
 * run is started: `peaks mut run` declares `--session-id` a REQUIRED option, so
 * an unscoped run cannot reach Stryker through the CLI. A programmatic caller
 * that omits it falls back to the project's own `include` and sees the
 * zero-tests abort, which is loud and names its own cause.
 */
export function scopedVitestOptions(input: {
  readonly project: string;
  readonly testFiles: ReadonlyArray<string>;
  readonly sessionId: string | undefined;
  readonly setupFiles?: ReadonlyArray<string>;
}): { related: boolean; configFile?: string } {
  if (input.sessionId === undefined) {
    return { related: false };
  }
  const generated = writeRunScopedVitestConfig({
    project: input.project,
    sessionId: input.sessionId,
    testFiles: input.testFiles,
    ...(input.setupFiles !== undefined ? { setupFiles: input.setupFiles } : {})
  });
  return { related: false, configFile: generated.configPath };
}

/**
 * Resolve test-file patterns against the project root so the result does
 * not depend on the caller's CWD. Absolute patterns are kept as-is.
 *
 * PURE: a path that does not exist is resolved anyway. Rejecting it is this
 * module's own `assertTestFilesUsable`, which runs at the boundary that owns
 * the file system — see the module header.
 *
 * Lives here rather than in `stryker-options.ts` because it is about test
 * files, not about Stryker options; the options builder imports it.
 */
export function resolveTestFiles(
  project: string,
  patterns: ReadonlyArray<string> | undefined
): string[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }
  return patterns.map((pattern) => (isAbsolute(pattern) ? pattern : resolve(project, pattern)));
}
