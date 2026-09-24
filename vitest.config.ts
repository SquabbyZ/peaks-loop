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
import { defineConfig } from 'vitest/config';
import { maxWorkers as workerCount } from './vitest.workers';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const srcAlias = {
  find: /^~\/src\/(.*)$/,
  replacement: resolve(projectRoot, 'src', '$1')
};
const jsToTsAlias = {
  find: /^~\/src\/(.*)\.js$/,
  replacement: resolve(projectRoot, 'src', '$1') + '.ts'
};

// 4.0.17: cap vitest worker concurrency to end full-suite starvation timeouts.
// Uncapped `pool: 'forks'` + `fileParallelism: true` on a 16-core box spawns
// ~15 fork workers; two test files additionally spawn real `node` subprocesses
// (`statusline-cli-integration.test.ts` × 24, `bump-version-ac7.test.ts` × 8),
// pushing runnable processes past core count. `testTimeout` measures wall clock,
// so descheduled tests burn their 30 s budget while doing zero work. Measured
// oversubscription was 8.8× (aggregate test time 3359 s vs wall 383 s on 16 cores).
// The fix at the time was `maxWorkers = floor(cpus/2)`, which took 17 timeouts
// → 0 and 705 → 722 pass (wall 383.67 s → 362.21 s on the 16-core box).
//
// The live policy is now a FIXED 2, defined once in `vitest.workers.ts` and
// imported as `workerCount` by all four vitest configs. See that file for why
// the number changed (load-shaped flakes at higher concurrency look exactly
// like real failures) and for the `PEAKS_VITEST_MAX_WORKERS` escape hatch.
const maxWorkers = workerCount;

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: [srcAlias, jsToTsAlias]
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'tests/integration/**',
      'tests/e2e/**',
      // Diagnosis E9 (2026-09-15): this file is the 4-dimension SAMPLE that
      // `.peaks/standards/typescript/testing.md` points readers at. It was
      // inside the collection glob, so every `pnpm test` run counted it as
      // product coverage. It stays at this path (the standards doc cites it)
      // but runs from vitest.config.e2e.ts, outside the unit total.
      'tests/unit/_samples/**',
      'node_modules/**'
    ],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    // The workspace packages are NOT aliased to their `src/` (see the aliases
    // above): they resolve through `node_modules` to built `dist/`, because
    // their `dist/` is the separately published artifact under test. That makes
    // a package build a real prerequisite of every file that imports one, and
    // this preflight is where it is enforced — build it once when it is
    // missing, refuse to run when it is stale. See
    // `tests/_global-setup/packages-build.ts` for the coverage of each entry
    // point and `scripts/packages-build-prerequisite.mjs` for the policy.
    globalSetup: ['./tests/_global-setup/packages-build.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: true,
    maxWorkers,
    passWithNoTests: true
  }
});
