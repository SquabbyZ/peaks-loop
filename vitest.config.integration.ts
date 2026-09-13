// vitest.config.integration.ts — sibling to vitest.config.ts for tests that
// need filesystem fixtures, real git subprocesses, and isolated
// tmp-workspace state.
//
// Selected by `pnpm test:integration`, which passes `--config` explicitly
// (`vitest run --config vitest.config.integration.ts tests/integration`).
// Without that flag the run inherits the base config's `include`
// (`tests/unit/**/*.test.ts`) and its `exclude` (`tests/integration/**`), so it
// selects zero files and exits 0 — a green that ran nothing. That was the
// state of the script until rid 2026-09-13-leftover-cleanup item 3.1.
//
// What this config adds over the base: an `include` that also matches
// `*.e2e.test.ts` files.
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
    include: ['tests/integration/**/*.e2e.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/unit/**', 'tests/e2e/**'],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    passWithNoTests: true,
  },
});
