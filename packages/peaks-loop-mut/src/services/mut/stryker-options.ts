/**
 * Pure Stryker configuration builder for `peaks mut`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured against the installed Stryker 9.6.1
 * (`node_modules/@stryker-mutator/core/package.json` → 9.6.1,
 * `@stryker-mutator/vitest-runner/package.json` → 9.6.1):
 *
 *   - `new Stryker(cliOptions)` merges the cliOptions OVER whatever
 *     `stryker.conf.js` the ConfigReader found in the CWD
 *     (`config/config-reader.js` → `deepMerge(options, cliOptions)`).
 *     So the whole mutation surface can be expressed in code and the
 *     project no longer has to hand-author a Stryker config file.
 *   - `ConfigReader.findConfigFile()` looks the config file up relative
 *     to `process.cwd()`, and `ProjectReader` resolves every `mutate` /
 *     `testFiles` pattern against `process.cwd()` as well
 *     (`config/file-matcher.js` → `path.resolve(pattern)`). So the
 *     project scope of a run is decided by the CWD — the invoker owns
 *     that (see `production-stryker.ts`).
 *
 * DESIGN
 * ------
 * This module is PURE in everything it SETS: no clock, no process state, and
 * every default it applies arrives as input, so it can be unit-tested without
 * Stryker being installed at all. The single source of truth for every
 * default lives in `STRYKER_DEFAULTS` below — nothing else in the package may
 * hard-code a default value.
 *
 * NO EXCEPTION TO THAT PURITY. This module never reads the file system, so it
 * cannot know whether a `--test-files` entry exists — and it must not try: a
 * builder that throws on a missing path is not a builder any more, it is half
 * of the validator. The existence check therefore lives where the file system
 * is legitimately read, and it is ONE check with THREE callers (see
 * `test-files.ts`): the CLI boundary (`assertMutTestFiles()`), the assertion
 * scanner (`assert-scanner.ts`) and the production Stryker invoker
 * (`production-stryker.ts`). The invoker is the one that protects the
 * PUBLISHED package: a programmatic caller that never goes through the CLI
 * still cannot hand a missing test file to Stryker, whose own file matcher
 * drops it silently and lets the run fall back to the project's default test
 * discovery. A PATTERN is never checked anywhere: Stryker expands patterns,
 * so a pattern is not a file and cannot be "missing".
 *
 * MEASURED BEHAVIOURS THIS ENCODES
 * --------------------------------
 *   - `mutate` patterns are passed through VERBATIM. Stryker supports
 *     `!`-negation and `:line-range` suffixes (`!src/foo.ts`,
 *     `src/foo.ts:1-11`); `path.resolve()` would mangle both, so the
 *     patterns stay relative to the project root (the invoker chdirs
 *     there before the run).
 *   - `testFiles` patterns ARE resolved against the project root. Stryker
 *     resolves them with `path.resolve(pattern)` too, but relative to
 *     whatever the CWD happens to be; resolving them here makes the
 *     result independent of the caller's CWD.
 *   - `vitest.related` is forced OFF whenever explicit test files are
 *     given. With `related: true` (the Stryker default) the vitest
 *     runner narrows the dry run to test files that IMPORT the mutated
 *     source (`@stryker-mutator/vitest-runner` 9.6.1 →
 *     `vitest-test-runner.js` → `this.ctx.config.related = ...`). A
 *     mutated file that no test imports then yields "No tests were
 *     executed" and Stryker aborts BEFORE the mutation stage. That is
 *     the degradation this switch removes: with an explicit `--test-files`
 *     list, the list is authoritative. Measured — see the RD artifact.
 *   - `reporters: []` + `logLevel: 'off'` are what keep stdout free for
 *     the `--json` envelope: Stryker's logging backend writes to
 *     `process.stdout` (`core/stryker.js` → `provideLoggingBackend(
 *     rootInjector, process.stdout)`) and the built-in reporters write
 *     there too. Measured: stdout length 0 for a real run.
 */
import { isAbsolute, resolve } from 'node:path';
import type { Stryker } from '@stryker-mutator/core';

/**
 * The exact option type `new Stryker(...)` accepts, derived from the
 * installed `@stryker-mutator/core` (9.6.1) instead of re-declared by
 * hand — so `tsc` checks every option name against the real API.
 */
export type StrykerCliOptions = ConstructorParameters<typeof Stryker>[0];

/**
 * The options this package actually sets.
 *
 * Two deviations from `StrykerCliOptions`, both deliberate:
 *
 *   - `logLevel` / `fileLogLevel` are typed as plain strings. In
 *     `@stryker-mutator/api` 9.6.1 they are the `LogLevel` const enum,
 *     and that package is NOT a declared dependency of peaks-loop-mut
 *     (pnpm's strict layout does not expose it here), so the enum type
 *     cannot be named. `production-stryker.ts` restores the narrow type at
 *     the single `new Stryker(...)` boundary.
 *   - `vitest` is a real Stryker option (it is in the core JSON schema and
 *     the vitest-runner plugin contributes it too), but the GENERATED
 *     TypeScript type for `StrykerOptions` does not declare it — measured
 *     in `@stryker-mutator/api` 9.6.1 → `src-generated/stryker-core.d.ts`.
 *     The option therefore travels in an intersection type: the extra key
 *     is accepted at runtime (the core schema validates it) and ignored by
 *     the type system.
 */
export type StrykerOptionsShape = Omit<StrykerCliOptions, 'logLevel' | 'fileLogLevel'> & {
  logLevel?: string;
  fileLogLevel?: string;
  vitest?: { related?: boolean; configFile?: string; dir?: string };
};

/** Every default the builder applies lives here — nowhere else. */
export const STRYKER_DEFAULTS = {
  testRunner: 'vitest',
  coverageAnalysis: 'off',
  timeoutMS: 30_000,
  concurrency: 1,
  reporters: [] as ReadonlyArray<string>,
  logLevel: 'off',
  fileLogLevel: 'off',
  allowConsoleColors: false
} as const;

export interface StrykerOptionsInput {
  /** Project root — the scope of the mutation run. */
  readonly project: string;
  /** Source patterns to mutate. Empty means "let the project config decide". */
  readonly mutate?: ReadonlyArray<string>;
  /** Test files to run. Empty means "let the runner discover them". */
  readonly testFiles?: ReadonlyArray<string>;
  /** Absolute paths (or file URLs) of Stryker plugins to load. */
  readonly pluginDescriptors?: ReadonlyArray<string>;
  readonly tsconfigFile?: string;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly testRunner?: string;
  readonly coverageAnalysis?: string;
}

export interface BuiltStrykerOptions {
  readonly options: StrykerCliOptions;
  readonly pluginDescriptors: ReadonlyArray<string>;
}

/**
 * Build the Stryker options for one mutation run.
 *
 * Pure: the same input always yields the same output.
 */
export function buildStrykerOptions(input: StrykerOptionsInput): BuiltStrykerOptions {
  const project = resolve(input.project);
  const pluginDescriptors = [...(input.pluginDescriptors ?? [])];
  const options: StrykerOptionsShape = {
    reporters: [...STRYKER_DEFAULTS.reporters],
    logLevel: STRYKER_DEFAULTS.logLevel,
    fileLogLevel: STRYKER_DEFAULTS.fileLogLevel,
    allowConsoleColors: STRYKER_DEFAULTS.allowConsoleColors
  };
  applyCallerOwnedOptions(options, input);

  if (input.mutate && input.mutate.length > 0) {
    // Verbatim: `!` negation and `:line-range` suffixes must survive.
    options.mutate = [...input.mutate];
  }

  const testFiles = resolveTestFiles(project, input.testFiles);
  if (testFiles.length > 0) {
    options.testFiles = testFiles;
    // An explicit test list is authoritative — do not let vitest's
    // related-mode narrowing discard it. See the module header.
    options.vitest = { related: false };
  }

  if (pluginDescriptors.length > 0) {
    // `appendPlugins` (not `plugins`) so a project `stryker.conf.js` keeps
    // its own plugin list; ours is added on top.
    options.appendPlugins = pluginDescriptors;
  }

  return { options: toStrykerCliOptions(options), pluginDescriptors };
}

/**
 * Apply the options the caller owns. Everything here is a PROJECT-owned
 * setting: it is written only when the caller asked for it, so a project
 * `stryker.conf.js` keeps its own value.
 *
 *   - the test runner: the CLI names one only for a project without a
 *     config file. The vitest runner is the one that implements Stryker's
 *     `--testFiles` contract (the built-in `command` runner throws "The
 *     command test runner does not support the --testFiles option" —
 *     measured on @stryker-mutator/core 9.6.1), so a project that names
 *     another runner and is handed `--test-files` fails LOUDLY rather
 *     than silently running something else.
 *   - the timing and coverage settings: a project config file owns them.
 */
function applyCallerOwnedOptions(options: StrykerOptionsShape, input: StrykerOptionsInput): void {
  if (input.testRunner) {
    options.testRunner = input.testRunner;
  }
  if (input.coverageAnalysis) {
    options.coverageAnalysis = input.coverageAnalysis;
  }
  if (input.timeoutMs !== undefined) {
    options.timeoutMS = input.timeoutMs;
  }
  if (input.concurrency !== undefined) {
    options.concurrency = input.concurrency;
  }
  if (input.tsconfigFile) {
    options.tsconfigFile = input.tsconfigFile;
  }
}

/**
 * Narrow the built options back to the type `new Stryker(...)` accepts.
 * `StrykerCliOptions` is assignable to `StrykerOptionsShape`, so this
 * assertion is a widening of two `logLevel` fields and never a cast that
 * hides a wrong option name — every other option was already checked
 * against the real API by `Omit<StrykerCliOptions, ...>`.
 */
export function toStrykerCliOptions(options: StrykerOptionsShape): StrykerCliOptions {
  return options as StrykerCliOptions;
}

/**
 * Resolve test-file patterns against the project root so the result does
 * not depend on the caller's CWD. Absolute patterns are kept as-is.
 *
 * PURE: a path that does not exist is resolved anyway. Rejecting it is the
 * validator's job (`test-files.ts`), and the validator runs at the boundary
 * that owns the file system — see the module header.
 */
function resolveTestFiles(project: string, patterns: ReadonlyArray<string> | undefined): string[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }
  return patterns.map((pattern) => (isAbsolute(pattern) ? pattern : resolve(project, pattern)));
}
