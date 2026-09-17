// vitest.config.lint.ts — doc / prose checks, run OUTSIDE `tests/unit/**`.
//
// Why this file exists (diagnosis E8, 2026-09-15): `tests/lint/**` used to
// live under `tests/unit/cli/`, so a linter that reads README files was
// collected by the unit glob and reported as six passing unit tests of
// `src/`. That made doc drift and code regression indistinguishable in the
// suite report, and it inflated the unit total with coverage that does not
// exist. The assertions were never the problem; being addressed as unit
// tests was.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { maxWorkers as workerCount } from './vitest.workers';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: projectRoot,
  test: {
    // Shared with the other three configs so the value cannot drift; see
    // `vitest.workers.ts` for the default and the PEAKS_VITEST_MAX_WORKERS override.
    maxWorkers: workerCount,
    include: ['tests/lint/**/*.test.ts'],
    exclude: ['node_modules/**'],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    pool: 'forks',
    fileParallelism: false,
    // A lint config that matches nothing must not report a green.
    passWithNoTests: false,
  },
});
