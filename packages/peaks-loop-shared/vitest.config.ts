/**
 * peaks-loop-shared standalone vitest config.
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
    maxWorkers: workerCount,
    // The peaks-loop-shared package's public surface (fs / paths /
    // version) is exercised through the root tests/unit/packages
    // (was) — that was deleted as redundant in commit 08e92d8f. The
    // shared package has no package-local test files because the
    // root suite is the canonical test surface for these pure
    // utilities. Without passWithNoTests the empty workspace would
    // fail pnpm -r run test under the new test:full wrapper.
    //
    // 2026-09-29 (a2): the history above is true, the decision it justified
    // is not. `tests/unit/packages/` was deleted and never replaced, so this
    // published package reported green while collecting zero files
    // ("No test files found, exiting with code 0", measured on the aggregate
    // `pnpm -r --filter ./packages/* run test`). An empty test set now fails,
    // the way vitest.config.e2e.ts:56 and vitest.config.lint.ts:29 already
    // require, and tests/paths-fs.test.ts + tests/result-version.test.ts are
    // what this collects (split from tests/shared.test.ts on 2026-09-29,
    // slice b1-filesplit-campaign, for the §4 row-5 line cap).
    passWithNoTests: false
  }
});
