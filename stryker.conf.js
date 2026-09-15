// @ts-check
/**
 * Stryker config for peaks-loop (peaks mut run).
 * Slice: 2026-07-01-wire-real-mut-run
 * karpathy §2: minimum config; no plugins list, no framework extension.
 */
export default {
  mutate: [
    'src/services/loop/evaluator-dispatcher.ts',
    'src/services/loop/monotonic-guard.ts',
    'src/services/loop/monotonic-runner.ts',
    'src/services/loop/run-driver.ts',
  ],
  // `pathFilters` used to sit here. It was REMOVED 2026-09-15 (diagnosis E3):
  // Stryker 8 has no such option — every run printed
  //   WARN OptionsValidator Unknown stryker config option "pathFilters"
  // and the key did nothing. Repo-relative paths in byFile[].file are now
  // produced by `normalize()` in
  // packages/peaks-loop-mut/src/services/mut/production-stryker.ts, which
  // strips `project` from Stryker's absolute `fileName` — the same job the
  // comment here always claimed, done in the only place that can do it.
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  timeoutMS: 30_000,
  concurrency: 2,
  plugins: ['@stryker-mutator/vitest-runner'],
  // Point the vitest-runner at a minimal config that only includes the loop
  // test files. The main vitest.config.ts pulls in the full suite, which
  // includes CLI tests that call process.chdir() — those fail in Stryker's
  // forced-threaded vitest workers. See stryker.vitest.config.mjs.
  vitest: {
    configFile: './stryker.vitest.config.mjs',
    // `related: true` (the default) narrows the dry run to test files that
    // import the mutated sources. Nothing in the repo does: three of the
    // four files below (monotonic-guard / monotonic-runner / run-driver)
    // have NO importing test anywhere, and evaluator-dispatcher is imported
    // only by production code. With related on, Stryker aborts before the
    // mutation stage with "No tests were executed" — a config-shaped error
    // standing in for a coverage-shaped fact. Turning it off lets the run
    // reach the mutation stage and say the true thing instead: with perTest
    // coverage analysis every one of these mutants is NoCoverage, the report
    // records killRate 0, and `mut run` exits non-zero. See the diagnosis
    // report for the uncovered-mutation-surface finding.
    related: false,
  },
};
