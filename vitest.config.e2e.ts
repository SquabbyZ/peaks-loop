// vitest.config.e2e.ts — the config that finally selects `tests/e2e/**`.
//
// Why this file exists (diagnosis 2026-09-15 E1): BOTH other configs excluded
// `tests/e2e/**` — vitest.config.ts (base, `include` is `tests/unit/**`) and
// vitest.config.integration.ts (explicit `exclude`). No script and no CI step
// selected it, so the 5 real E2E tests in `tests/e2e/critical-paths.test.ts`
// had never executed once. `passWithNoTests: true` on the other two configs
// meant nothing ever went red about it.
//
// The tests drive the CLI in-process via `runCli` (no spawn, no dist), so
// this config needs no build step. It is deliberately SERIAL
// (`fileParallelism: false`): `runCli` calls `process.chdir()` and reads
// `process.exitCode`, which are process-global.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { maxWorkers as workerCount } from './vitest.workers';

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
    // Shared with the other three configs so the value cannot drift; see
    // `vitest.workers.ts` for the default and the PEAKS_VITEST_MAX_WORKERS override.
    maxWorkers: workerCount,
    // Two suites that must run OUTSIDE the unit collection glob:
    //   - tests/e2e/**            : real CLI paths, never selected anywhere
    //                               before 2026-09-15 (diagnosis E1)
    //   - tests/unit/_samples/**  : the 4-dimension sample the testing
    //                               standard cites. Documentation, not
    //                               product coverage (diagnosis E9) — it
    //                               runs here so it cannot rot, but it is
    //                               not counted in the unit total.
    include: ['tests/e2e/**/*.test.ts', 'tests/unit/_samples/**/*.test.ts'],
    exclude: ['node_modules/**'],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    // Deliberately NOT set. If this config selects zero files, that is the
    // exact "green that ran nothing" failure mode this config exists to end.
    passWithNoTests: false,
  },
});
