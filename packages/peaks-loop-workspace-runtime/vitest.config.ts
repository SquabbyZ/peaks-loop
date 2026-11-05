/**
 * peaks-loop-workspace-runtime standalone vitest config.
 *
 * Only tests files under this package's tests/ tree, never the root config or a
 * sibling package's tests. The worker cap is the repository-wide policy, imported
 * from `vitest.workers.ts` rather than restated as a number — esbuild inlines a
 * relative specifier into this config's own bundle, so the import resolves at
 * load time. `tests/unit/standards/vitest-worker-cap.test.ts` walks the tree and
 * names any config that drops the import or hard-codes a number instead.
 *
 * `passWithNoTests: false` because this package's only evidence is its own
 * cases: an empty collection is a red run, not a green one.
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
    maxWorkers: workerCount,
    passWithNoTests: false
  }
});
