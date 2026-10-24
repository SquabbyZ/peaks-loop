// @ts-check
/**
 * Minimal vitest config for Stryker's dry-run.
 *
 * Why this exists: stryker.conf.js drives the production mutation surface
 * (four targets — two under src/cli, one under src/services/workflow and one
 * under src/shared; the list itself lives in stryker.conf.js) and uses
 * Stryker's vitest-runner plugin to compute perTest coverage. The project's
 * main vitest.config.ts sets `pool: 'forks'` and pulls in the whole unit
 * suite (600+ files). That suite includes CLI tests that
 * call `process.chdir()` — which Stryker's vitest-runner rejects because
 * it forces `pool: 'threads'` (workers can't chdir).
 *
 * This config tells Stryker's vitest-runner to run exactly ONE test file for
 * coverage analysis — `tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts`,
 * the one that covers the four mutate targets.
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
 * '~/src/cli/commands/verdict-aggregate-command'") — the file this config
 * includes imports its production code through that alias
 * (`tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts:39`),
 * so it cannot load without it. The five files the include list used to name
 * did NOT: they imported production code by RELATIVE path
 * (`../../../src/…`), so the missing alias was not why they
 * could not run.
 *
 * The replacement is deliberately NOT a re-created `tests/unit/loop/`:
 * a repo-wide scan shows the surviving coverage of the mutation surface is
 * ONE file (verdict-aggregate-missing-evidence.test.ts), and that file does
 * cover the four targets stryker.conf.js mutates today — measured from
 * `verdict-aggregate-missing-evidence.test.ts` on 2026-10-24: 75.43% /
 * 15.51% / 55.55% / 58.82% of their LINES. Pointing this config at a fatter
 * list would not have created the missing tests.
 * ---------------------------------------------------------------------
 *
 * CORRECTED 2026-10-24 (rid 030, the `peaks mut` truthfulness slice). The
 * 2026-09-15 repair record above is KEPT, with ONE clause in it corrected in
 * place: the `~/src/**` alias sentence was written about every test file, and
 * it holds only of the file this config includes — that file imports its
 * production code through the alias
 * (`tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts:39`).
 * It does not hold of every test file (measured 2026-10-24): a repo-wide scan
 * finds the alias used by only a minority of the test files under `tests/`,
 * and the five files the include list used to name imported production code
 * by RELATIVE path (the 2026-09-15 record above). Three statements in and
 * around the record were true only for a moment, and are corrected here
 * against a measurement:
 *   - "the 4 src/services/loop/*.ts files" was the mutation scope until
 *     2026-10-24; stryker.conf.js mutates four different files now.
 *   - "only run the loop test files" was true until 2026-09-15 and is stale
 *     now: TODAY's include list names ONE CLI test file —
 *     `tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts` —
 *     and no loop test file. (Until 2026-09-15 it named five
 *     `tests/unit/loop/` files — the 2026-09-15 record above says so.)
 *   - "NOTHING in the repo imports monotonic-guard.ts, monotonic-runner.ts or
 *     run-driver.ts" is false for run-driver.ts —
 *     tests/unit/services/loop/loop-observability-emission.test.ts
 *     value-imports it. Of the four files `stryker.conf.js` used to mutate,
 *     THREE (evaluator-dispatcher, monotonic-guard, monotonic-runner) are
 *     value-imported by no test at all, and the fourth (run-driver) by that
 *     test file — which this config does NOT include.
 *
 * Every coverage figure names the file it was measured FROM. Measured from
 * `tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts` alone —
 * the ONE test file this config includes — the four files `stryker.conf.js`
 * used to mutate measure 0% of their LINES: 0 of 177 lines in
 * evaluator-dispatcher, 0 of 75 in monotonic-guard, 0 of 94 in monotonic-runner
 * and 0 of 139 in run-driver. Measured from
 * `tests/unit/services/loop/loop-observability-emission.test.ts` alone, the
 * same four measure 0% of their lines in evaluator-dispatcher (0 of 177), 40%
 * in monotonic-guard (30 of 75), 10.63% in monotonic-runner (10 of 94) and
 * 60.43% in run-driver (84 of 139). The CLI command module that imports
 * evaluator-dispatcher.ts (loop-eval-eval-command.ts) is not loaded by
 * `tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts` either
 * — 0 of its 51 lines ran. Measured with the same value-import scan the
 * peaks-mut parity guard uses.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const srcAlias = {
  find: /^~\/src\/(.*)$/,
  replacement: resolve(projectRoot, 'src', '$1')
};
const jsToTsAlias = {
  find: /^~\/src\/(.*)\.js$/,
  replacement: resolve(projectRoot, 'src', '$1') + '.ts'
};

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: [srcAlias, jsToTsAlias]
  },
  test: {
    include: ['tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts'],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    // The include list above must never silently select zero files again —
    // that is exactly how this config rotted unnoticed for six weeks.
    passWithNoTests: false
  }
});
