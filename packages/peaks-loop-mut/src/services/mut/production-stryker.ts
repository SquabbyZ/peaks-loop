/**
 * Production Stryker invoker — runs a REAL mutation test through
 * `@stryker-mutator/core`'s programmatic API.
 *
 * MEASURED against the installed toolchain (@stryker-mutator/core 9.6.1,
 * @stryker-mutator/vitest-runner 9.6.1):
 *
 *   - PROJECT SCOPE. `Stryker.runMutationTest()` hands its cliOptions to
 *     `PrepareExecutor`, whose `ConfigReader` looks for a config file and
 *     whose `ProjectReader` resolves every `mutate` / `testFiles` pattern
 *     against `process.cwd()` (`config/file-matcher.js` →
 *     `path.resolve(pattern)`). The project of a run is therefore decided
 *     by the CWD, so this invoker chdirs into `--project` for the run and
 *     restores the previous CWD in a `finally`. The chdir is
 *     process-global, so runs are serialised through `runExclusive()`.
 *   - PLUGIN LOADING. The vitest runner is resolved from THIS package's own
 *     installation — see `stryker-plugin.ts`.
 *
 * NO FAKE GREEN. A run that produces zero mutants, or that cannot load
 * its test runner, fails with a named error code — it never reports
 * `mutantsTotal: 0` as if it were a measurement.
 *
 * THE SPLIT. This module used to carry the plugin resolution and the
 * mutant-result normalisation as well, and grew past the repository's
 * raw-line cap (`src/services/scan/file-size-policy.ts` → 300 for
 * `packages/**`). Those halves now live in `stryker-errors.ts` (the named
 * codes), `stryker-plugin.ts` (the plugin path) and `stryker-result.ts`
 * (the report shaping). The names THIS module exports are unchanged.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StrykerInvoker } from './mut-runner.js';
import { MUT_ERROR_CODES, MutToolchainError } from './stryker-errors.js';
import {
  buildStrykerOptions,
  STRYKER_DEFAULTS,
  type StrykerCliOptions
} from './stryker-options.js';
import { resolveVitestRunnerPlugin } from './stryker-plugin.js';
import { normalizeMutants, type StrykerMutant } from './stryker-result.js';

export { MUT_ERROR_CODES, MutToolchainError };

/** The config file names Stryker looks for (SUPPORTED_CONFIG_FILE_NAMES, core 9.6.1). */
const STRYKER_CONFIG_FILE_NAMES: readonly string[] = ['', '.'].flatMap((prefix) =>
  ['.conf', '.config'].flatMap((suffix) =>
    ['json', 'js', 'mjs', 'cjs'].map((ext) => `${prefix}stryker${suffix}.${ext}`)
  )
);

/** Serialises the process-global CWD window (see the module header). */
let runQueue: Promise<unknown> = Promise.resolve();

export function createProductionStrykerInvoker(): StrykerInvoker {
  return async (input) => {
    const project = resolve(input.project);
    if (!existsSync(project)) {
      throw new MutToolchainError(
        MUT_ERROR_CODES.projectNotFound,
        `The project directory "${project}" does not exist.`
      );
    }
    assertMutateScope(project, input.mutate);
    const pluginDescriptors = [resolveVitestRunnerPlugin()];
    // A project `stryker.conf.js` owns the runner, the timing and the
    // coverage settings; a project without one gets the CLI's defaults.
    const projectOwned = hasProjectStrykerConfig(project)
      ? {}
      : {
          testRunner: STRYKER_DEFAULTS.testRunner,
          timeoutMs: STRYKER_DEFAULTS.timeoutMS,
          concurrency: STRYKER_DEFAULTS.concurrency,
          coverageAnalysis: STRYKER_DEFAULTS.coverageAnalysis
        };
    const { options } = buildStrykerOptions({
      project,
      mutate: input.mutate,
      testFiles: input.testFiles,
      pluginDescriptors,
      tsconfigFile: input.tsconfigFile,
      ...projectOwned
    });
    const mutants = await runInProject(project, options);
    if (mutants.length === 0) {
      throw new MutToolchainError(
        MUT_ERROR_CODES.noMutants,
        'The mutation run produced 0 mutants. Check the --mutate patterns against the project root ' +
          `("${project}") — a pattern that matches no file is a configuration error, not a passing measurement.`
      );
    }
    return normalizeMutants(mutants, project);
  };
}

/**
 * R4: the mutation scope must come from `--mutate`, or from a Stryker
 * config file at the project root (backwards compatibility).
 */
function assertMutateScope(project: string, mutate: ReadonlyArray<string> | undefined): void {
  if (mutate && mutate.length > 0) {
    return;
  }
  if (hasProjectStrykerConfig(project)) {
    return;
  }
  throw new MutToolchainError(
    MUT_ERROR_CODES.mutatePatternRequired,
    `No mutation scope was given and no Stryker config file was found in "${project}". ` +
      'Pass --mutate <patterns...> (for example --mutate "src/**/*.ts") or add a stryker.conf.js at the project root.'
  );
}

/** True when the project root carries a config file Stryker would read. */
function hasProjectStrykerConfig(project: string): boolean {
  return STRYKER_CONFIG_FILE_NAMES.some((name) => existsSync(resolve(project, name)));
}

/**
 * Run Stryker with the project as the CWD, restoring the previous CWD
 * afterwards. Serialised so concurrent invocations cannot interleave.
 */
async function runInProject(
  project: string,
  options: StrykerCliOptions
): Promise<ReadonlyArray<StrykerMutant>> {
  return runExclusive(async () => {
    const previousCwd = process.cwd();
    try {
      process.chdir(project);
      const Stryker = (await import('@stryker-mutator/core')).Stryker;
      return await new Stryker(options).runMutationTest();
    } catch (err: unknown) {
      throw toMutError(err);
    } finally {
      process.chdir(previousCwd);
    }
  });
}

/** Queue a unit of work so only one Stryker run owns the CWD at a time. */
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = runQueue.then(fn, fn);
  runQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** Map a Stryker failure onto a named error code. */
function toMutError(err: unknown): Error {
  if (err instanceof MutToolchainError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new MutToolchainError(classifyStrykerFailure(message), message, { cause: err });
}

/** A missing plugin / package / runner is a toolchain problem, not a generic failure. */
function classifyStrykerFailure(message: string): string {
  if (
    /cannot find .*plugin/i.test(message) ||
    /does not support the --testfiles option/i.test(message) ||
    /cannot find (?:package|module)/i.test(message) ||
    /ERR_MODULE_NOT_FOUND/.test(message)
  ) {
    return MUT_ERROR_CODES.toolchainUnavailable;
  }
  return MUT_ERROR_CODES.failed;
}
