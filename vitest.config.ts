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

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: projectRoot,
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'tests/integration/**',
      'tests/e2e/**',
      'node_modules/**',
    ],
    // No global setup file: the rebuild's tmp-workspace helper is
    // opt-in per test (withTmpWorkspacePerTest), and we never touch
    // the real .peaks/.session.json or .peaks/.active-skill.json.
    // setupFiles: ['./tests/unit/_setup/index.ts'] is a no-op marker
    // (the file re-exports nothing); kept so future per-test setup
    // can hang off it without another config edit.
    setupFiles: ['./tests/unit/_setup/index.ts'],
    // Default per-test budget. Slice 3 of the rebuild epic verified
    // that the antfu-style pure / DI tests run in <100ms; 10s is
    // already 100x headroom and matches the project's "fail fast"
    // preference. Tests that legitimately need more MUST pass an
    // explicit `it('name', fn, { timeout: ... })`.
    testTimeout: 10_000,
    hookTimeout: 5_000,
    // antfu-style parallelism: each test file runs in its own fork,
    // so tmp workspaces never collide and shared env mutations are
    // confined to the file that issued them.
    pool: 'forks',
    fileParallelism: true,
    // vitest defaults to exit 1 when no tests match the include
    // pattern. The rebuild progresses slice-by-slice; the empty-set
    // must read as success so pnpm test:full stays green while
    // individual domain slices land.
    passWithNoTests: true,
  },
});

