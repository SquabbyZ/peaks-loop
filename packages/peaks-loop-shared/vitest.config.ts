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
    passWithNoTests: true,
  },
});