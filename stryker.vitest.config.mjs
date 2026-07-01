// @ts-check
/**
 * Minimal vitest config for Stryker's dry-run.
 *
 * Why this exists: stryker.conf.js drives the production mutation surface
 * (the 4 src/services/loop/*.ts files) and uses Stryker's vitest-runner
 * plugin to compute perTest coverage. The project's main vitest.config.ts
 * has `pool: 'forks', poolOptions.forks.singleFork: true` and pulls in the
 * full test suite (180+ files). The full suite includes CLI tests that
 * call `process.chdir()` — which Stryker's vitest-runner rejects because
 * it forces `pool: 'threads'` (workers can't chdir).
 *
 * This config tells Stryker's vitest-runner to only run the 5 loop test
 * files for coverage analysis. The result: a clean dry-run against the
 * mutation surface this slice is targeting, without dragging in the
 * chdir-using CLI tests.
 *
 * Slice: 2026-07-01-wire-real-mut-run
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/loop/evaluator-dispatcher.test.ts',
      'tests/unit/loop/monotonic-guard.test.ts',
      'tests/unit/loop/run-driver.test.ts',
      'tests/unit/loop/spec-bootstrap.test.ts',
      'tests/unit/loop/spec-cli.test.ts',
    ],
    setupFiles: ['./tests/vitest.setup.ts'],
  },
});
