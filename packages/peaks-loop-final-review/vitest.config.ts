import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    environment: 'node',
    // Bump from the 5s default to absorb Windows file-I/O spikes from
    // antivirus scanning of mkdtempSync/mkdirSync/writeFileSync/rmSync
    // under pnpm -r concurrency (17-26s spikes observed); 30s is safe.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});