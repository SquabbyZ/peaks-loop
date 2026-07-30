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

const srcAlias = {
  find: /^~\/src\/(.*)$/,
  replacement: resolve(projectRoot, 'src', '$1'),
};
const jsToTsAlias = {
  find: /^~\/src\/(.*)\.js$/,
  replacement: resolve(projectRoot, 'src', '$1') + '.ts',
};

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
    passWithNoTests: true,
  },
});

