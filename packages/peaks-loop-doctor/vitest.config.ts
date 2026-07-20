import { defineConfig } from 'vitest/config';

/**
 * peaks-loop-doctor standalone vitest config.
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
  },
});