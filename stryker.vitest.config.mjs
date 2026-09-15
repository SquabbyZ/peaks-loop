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
 * This config tells Stryker's vitest-runner to only run the loop test
 * files for coverage analysis.
 *
 * Slice: 2026-07-01-wire-real-mut-run
 *
 * ---------------------------------------------------------------------
 * REPAIRED 2026-09-15 (diagnosis E3). Until this date the `include` below
 * named five files under `tests/unit/loop/`, a directory that no longer
 * exists (deleted by f17aa377 on 2026-07-30, rebuilt as tests/unit/**, and
 * never re-created), and `setupFiles` named `./tests/vitest.setup.ts`,
 * which was deleted in the same commit. So Stryker's vitest-runner
 * selected ZERO test files and the dry run could not complete.
 *
 * The repair also had to add the `~/src/**` alias. Without it the included
 * test file failed to LOAD ("Cannot find module
 * '~/src/cli/commands/verdict-aggregate-command'") — every test file in
 * this repo imports production code through that alias, so this config
 * could never have run any of the five files it used to name, even while
 * they existed.
 *
 * The replacement is deliberately NOT a re-created `tests/unit/loop/`:
 * a repo-wide grep shows the surviving coverage of the mutation surface is
 * ONE file (verdict-aggregate-missing-evidence.test.ts, which reaches
 * evaluator-dispatcher.ts through the CLI command layer). NOTHING in the
 * repo imports monotonic-guard.ts, monotonic-runner.ts or run-driver.ts —
 * three of the four files stryker.conf.js mutates have zero test coverage.
 * That is a real gap, reported rather than papered over; pointing this
 * config at a fatter list would not have created the missing tests.
 * ---------------------------------------------------------------------
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const srcAlias = {
  find: /^~\/src\/(.*)$/,
  replacement: resolve(projectRoot, 'src', '$1'),
};
const jsToTsAlias = {
  find: /^~\/src\/(.*)\.js$/,
  replacement: resolve(projectRoot, 'src', '$1') + '.ts',
};

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: [srcAlias, jsToTsAlias],
  },
  test: {
    include: [
      'tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts',
    ],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    // The include list above must never silently select zero files again —
    // that is exactly how this config rotted unnoticed for six weeks.
    passWithNoTests: false,
  },
});
