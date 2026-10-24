// @ts-check
/**
 * Stryker config for peaks-loop — the repository's own dogfood run.
 *
 * Slice: 2026-07-01-wire-real-mut-run
 * karpathy §2: minimum config — the test runner and the single plugin below are
 * the only framework settings.
 *
 * THIS FILE IS AN OPTIONAL FALLBACK, NOT A REQUIREMENT. Since the `peaks mut`
 * CLI was rebuilt (rid 029) the Stryker configuration is built
 * PROGRAMMATICALLY from the flags — `--mutate` (the mutation scope) and
 * `--test-files` — by `peaks-loop-mut` → `buildStrykerOptions`. The CLI's own
 * options win over this file: Stryker deep-merges the cliOptions over the
 * config file it read (`@stryker-mutator/core` → `config/config-reader.ts` →
 * `deepMerge(options, cliOptions)`).
 *
 * So, for a `peaks mut run`:
 *   - the CLI OVERRIDES `mutate` (when `--mutate` is passed), `testFiles`,
 *     `reporters`, `logLevel` / `fileLogLevel`, `allowConsoleColors` and
 *     `vitest.related`;
 *   - this file still OWNS the test runner, the timing, the concurrency, the
 *     coverage mode, the plugin list (the CLI appends the vitest runner it
 *     resolved from its own installation rather than replacing this list) and
 *     `vitest.configFile` — the CLI supplies those only for a project that
 *     has no Stryker config of its own.
 *
 * The mutate scope below is the fallback for a run that passes no `--mutate`.
 * Every target is imported by a test, and all four are covered by the ONE test
 * file `stryker.vitest.config.mjs` includes —
 * `tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts` — at
 * 75.43% / 15.51% / 55.55% / 58.82% of their LINES, so the dry run has
 * something to execute and the mutants get coverage instead of NoCoverage.
 *
 * The previous four targets (`src/services/loop/{evaluator-dispatcher,
 * monotonic-guard,monotonic-runner,run-driver}.ts`) were the other story, and
 * the sentence about them used to be wrong. MEASURED 2026-10-24 with the same
 * value-import scan the peaks-mut parity guard uses (a type-only import does
 * not count): THREE of the four — evaluator-dispatcher, monotonic-guard and
 * monotonic-runner — are value-imported by no test at all, and the fourth,
 * run-driver, by exactly ONE test file —
 * `tests/unit/services/loop/loop-observability-emission.test.ts` — which
 * `stryker.vitest.config.mjs` does NOT include.
 *
 * Every coverage figure in this header names the file it was measured FROM.
 * Measured
 * from `tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts`
 * alone — the ONE test file `stryker.vitest.config.mjs` includes — all four of
 * the previous targets measure 0% of their LINES: 0 of 177 lines in
 * evaluator-dispatcher, 0 of 75 in monotonic-guard, 0 of 94 in monotonic-runner
 * and 0 of 139 in run-driver, so a dogfood run over them reported NoCoverage,
 * killRate 0 and exit 1. Measured from
 * `tests/unit/services/loop/loop-observability-emission.test.ts` alone, the
 * same four measure 0% of their lines in evaluator-dispatcher (0 of 177), 40%
 * in monotonic-guard (30 of 75), 10.63% in monotonic-runner (10 of 94) and
 * 60.43% in run-driver (84 of 139) — but that file is not in the run, so its
 * coverage reaches no mutant.
 */
export default {
  mutate: [
    'src/cli/commands/verdict-aggregate-command.ts',
    'src/cli/cli-helpers.ts',
    'src/services/workflow/pipeline-verify-qa-phase.ts',
    'src/shared/path-safety.ts'
  ],
  // `pathFilters` used to sit here. It was REMOVED 2026-09-15 (diagnosis E3):
  // Stryker has no such option — it is absent from the installed
  // `@stryker-mutator/core` 9.6.1 schema — so every run printed
  //   WARN OptionsValidator Unknown stryker config option "pathFilters"
  // and the key did nothing. Repo-relative paths in byFile[].file are now
  // produced by `normalizeMutants()` in
  // packages/peaks-loop-mut/src/services/mut/stryker-result.ts, which
  // strips `project` from Stryker's absolute `fileName` — the same job the
  // comment here always claimed, done in the only place that can do it.
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  timeoutMS: 30_000,
  concurrency: 2,
  plugins: ['@stryker-mutator/vitest-runner'],
  // Point the vitest-runner at a minimal config that includes ONLY the test
  // file covering the mutate targets above. The main vitest.config.ts pulls in
  // the whole unit suite (600+ files) and adds a globalSetup that builds the
  // workspace packages; the suite also includes CLI tests that call
  // process.chdir(), which fail in Stryker's forced-threaded vitest workers.
  // See stryker.vitest.config.mjs.
  vitest: {
    configFile: './stryker.vitest.config.mjs',
    // `related: true` (the Stryker default) narrows the dry run to the test
    // files that IMPORT the mutated sources, and a mutated file that no test
    // imports makes Stryker abort before the mutation stage with "No tests
    // were executed".
    //
    // MEASURED after the CLI was rebuilt (rid 029): the CLI now forces this
    // OFF by itself — `buildStrykerOptions` sets `vitest.related = false`
    // whenever `--test-files` is given, and `--test-files` is a REQUIRED
    // option on `peaks mut run` / `peaks mut mutants`. The CLI's options win
    // over this file, so this line is redundant for a `peaks mut` run; it is
    // kept so a direct `npx stryker run` in this repo behaves the same way.
    related: false
  }
};
