// vitest.config.integration.ts — sibling to vitest.config.ts for tests that
// need filesystem fixtures, real git subprocesses, and isolated
// tmp-workspace state.
//
// Triggers when `pnpm test:integration` is invoked (script does
// `vitest run tests/integration`) so we override the base config's
// `include` to also match `*.e2e.test.ts` files.
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
