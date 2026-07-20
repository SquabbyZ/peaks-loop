import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    environment: 'node',
    // Bump from the 5s default to absorb Windows file-I/O spikes from
    // antivirus scanning of mkdtempSync/mkdirSync/writeFileSync/rmSync in
    // the handoff fixtures. Under pnpm -r concurrency, mkdtempSync /
    // mkdirSync / writeFileSync can spike to 17-26s on Windows under
    // antivirus load, so 30s is the safe ceiling (15s was insufficient).
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});