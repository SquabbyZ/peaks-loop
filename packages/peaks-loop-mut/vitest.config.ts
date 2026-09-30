/**
 * peaks-loop-mut standalone vitest config.
 *
 * Only tests files under this package's tests/ tree.
 * Does NOT pull in the main peaks-loop vitest config or any other
 * workspace package's tests.
 *
 * The worker cap is the repository-wide policy, imported from `vitest.workers.ts`
 * at the repo root instead of restated as a number here. That import does load:
 * vite bundles a config with esbuild, and esbuild INLINES relative specifiers
 * (only bare package specifiers are externalised), so the policy module is
 * compiled into this config's own bundle. The `.js` spelling is what the NodeNext
 * program in `config/eslint/tsconfig.lint.json` needs — unlike the root configs,
 * this file is in that program. `tests/unit/standards/vitest-worker-cap.test.ts`
 * walks the filesystem and names any config that drops the import or hard-codes
 * a number in its place.
 */
import { defineConfig } from 'vitest/config';
import { maxWorkers as workerCount } from '../../vitest.workers.js';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30000,
    pool: 'forks',
    maxWorkers: workerCount
  }
});
