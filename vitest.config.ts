// Minimal vitest config for the 2026-07-30 test-rebuild epic.
//
// Background: the previous 464-line config defined two projects (fast / slow),
// a global setup that stashed the real `.peaks/.session.json` file, and
// per-file setupFiles that pinned `process.cwd()`. Together they let the
// 559-file unit suite consume hours of wall clock and required
// `fileParallelism: false` to avoid rename races on shared session files.
//
// That entire machinery was bound to the legacy unit tests (now deleted).
// The rebuild starts from a clean slate: no global setup, no per-file cwd
// pin, no per-test timeout inflation, no two-project split. The next slice
// (`bootstrap-infrastructure`) will rewrite this file to land the new
// antfu-style test infrastructure (tmp workspaces, explicit dependency
// injection, no real fs/clock/network in unit tests).
//
// For the duration of the epic this config deliberately matches ZERO test
// files so `pnpm test:full` exits 0 in <1s instead of running the previous
// hour-long suite or hitting the 120s testTimeout cliff.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: projectRoot,
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      // No real fs / subprocess tests in the rebuild slice.
      // Heavy suites live in tests/integration/** and are run separately.
      'tests/integration/**',
      'tests/e2e/**',
      'node_modules/**',
    ],
    // Until the new infrastructure slice lands, the rebuild has zero
    // .test.ts files. vitest defaults to exit 1 in that case, which
    // would falsely fail `pnpm test:full`. Honor the empty-set as
    // success so the epic can progress slice-by-slice without a
    // green/red noise floor.
    passWithNoTests: true,
  },
});
