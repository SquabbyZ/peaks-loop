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
  // Strip the workspace root from every reported file path so byFile[].file
  // is repo-relative (e.g. "src/services/loop/...") instead of an absolute
  // Windows path. The negative glob drops generated test artefacts.
  pathFilters: ['src/services/loop/**', '!*.test.*'],
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  timeoutMS: 30_000,
  concurrency: 2,
  plugins: ['@stryker-mutator/vitest-runner'],
  // Point the vitest-runner at a minimal config that only includes the 5
  // loop test files. The main vitest.config.ts pulls in the full suite,
  // which includes CLI tests that call process.chdir() — those fail in
  // Stryker's forced-threaded vitest workers. See stryker.vitest.config.mjs.
  vitest: {
    configFile: './stryker.vitest.config.mjs',
  },
};
