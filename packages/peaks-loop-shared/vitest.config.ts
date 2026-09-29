import { defineConfig } from 'vitest/config';

/**
 * peaks-loop-shared standalone vitest config.
 *
 * Only tests files under this package's tests/ tree.
 * Does NOT pull in the main peaks-loop vitest config or any other
 * workspace package's tests.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30000,
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
    // require, and tests/shared.test.ts is what this collects.
    passWithNoTests: false
  }
});
