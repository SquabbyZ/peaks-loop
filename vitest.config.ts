// Minimal vitest config for the 2026-07-30 test-rebuild epic.
//
// Background: the previous 464-line config defined two projects (fast / slow),
// a global setup that stashed the real `.peaks/.session.json` file, and
// per-file setupFiles that pinned `process.cwd()`. Together they let the
// 559-file unit suite consume hours of wall clock and required
// `fileParallelism: false` to avoid rename races on shared session files.
//
// That entire machinery was bound to the legacy unit tests (now deleted).
// The rebuild runs on antfu-style tmp workspaces (no shared real .peaks/**
// state) and explicit dependency injection, so file parallelism is safe
// again — no shared mutable files, no real network, no real subprocess
// in unit tests.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
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

// 4.0.17: cap vitest worker concurrency to end full-suite starvation timeouts.
// Uncapped `pool: 'forks'` + `fileParallelism: true` on a 16-core box spawns
// ~15 fork workers; two test files additionally spawn real `node` subprocesses
// (`statusline-cli-integration.test.ts` × 24, `bump-version-ac7.test.ts` × 8),
// pushing runnable processes past core count. `testTimeout` measures wall clock,
// so descheduled tests burn their 30 s budget while doing zero work. Measured
// oversubscription was 8.8× (aggregate test time 3359 s vs wall 383 s on 16 cores).
// Schedule `maxWorkers = floor(cpus/2)` so workers never exceed core count, with
// PEAKS_VITEST_MAX_WORKERS override for CI tuning. Floor of 2 keeps 2-core boxes
// from collapsing to 1 worker. Validation: 17 timeouts → 0, 705 → 722 pass,
// wall 383.67 s → 362.21 s on the 16-core measurement box.
const defaultMaxWorkers = Math.max(2, Math.floor(cpus().length / 2));
const maxWorkers = process.env.PEAKS_VITEST_MAX_WORKERS
  ? Number(process.env.PEAKS_VITEST_MAX_WORKERS)
  : defaultMaxWorkers;

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: [srcAlias, jsToTsAlias],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'tests/integration/**',
      'tests/e2e/**',
      'node_modules/**',
    ],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: true,
    maxWorkers,
    passWithNoTests: true,
    // 4.0.17 perf slice 3 commit 2: cache compiled test files to disk
    // so subsequent runs skip the TS transform pass for unchanged files.
    // Estimate: 30-60s cold savings, 10-20% warm savings on the 1853s
    // aggregate transform+import time.
    cache: {
      dir: './node_modules/.cache/vitest',
    },
    // 4.0.17 perf slice 3 commit 3: prebundle peaks-loop-shared (the
    // most-imported workspace package) via vite's deps.optimizer.
    // Without this, every worker re-resolves the workspace package
    // through node_modules at module-load time. Estimate: 100-200s
    // saving on the 802s aggregate import time.
    deps: {
      optimizer: {
        ssr: {
          include: ['peaks-loop-shared'],
        },
      },
    },
  },
});

