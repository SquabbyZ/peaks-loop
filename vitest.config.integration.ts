// vitest.config.integration.ts — sibling to vitest.config.ts for tests that
// need filesystem fixtures, real git subprocesses, and isolated
// tmp-workspace state.
//
// Selected by `pnpm test:integration`, which passes `--config` explicitly
// (`vitest run --config vitest.config.integration.ts tests/integration`).
// Without that flag the run inherits the base config's `include`
// (`tests/unit/**/*.test.ts`) and its `exclude` (`tests/integration/**`), so it
// selects zero files and exits 0 — a green that ran nothing. That was the
// state of the script until rid 2026-09-13-leftover-cleanup item 3.1.
//
// What this config adds over the base: an `include` that also matches
// `*.e2e.test.ts` files.
import { existsSync } from 'node:fs';
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

// PEAKS_BUILD_AVAILABLE — diagnosis E2 (2026-09-15).
//
// 7 tests in this suite (plan-cli.test.ts ×6, ac8-empirical.test.ts ×1) are
// wrapped in `describe.skip` / `it.skip` unless this env var is exactly '1'.
// A repo-wide grep found it set in .github/**, scripts/** and package.json:
// zero hits. So those 7 tests had NEVER executed anywhere, and the skip read
// as a deliberate deferral rather than as a permanently-false switch.
//
// The tests spawn the BUILT CLI (`bin/peaks.js` -> `dist/`). That is the real
// precondition, and it is checkable, so bind the switch to it instead of to
// whether someone remembered to export a variable. A dirty checkout with a
// missing dist still skips (truthfully); a built checkout — which is what the
// CI integration job produces via `npm run build` before this suite — runs
// them. An explicitly-set PEAKS_BUILD_AVAILABLE always wins.
const binPeaks = resolve(projectRoot, 'bin', 'peaks.js');
const distProgram = resolve(projectRoot, 'dist', 'cli', 'program.js');
if (process.env.PEAKS_BUILD_AVAILABLE === undefined) {
  process.env.PEAKS_BUILD_AVAILABLE =
    existsSync(binPeaks) && existsSync(distProgram) ? '1' : '0';
}

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: [srcAlias, jsToTsAlias],
  },
  test: {
    include: ['tests/integration/**/*.e2e.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/unit/**', 'tests/e2e/**'],
    setupFiles: ['./tests/unit/_setup/index.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    passWithNoTests: true,
  },
});
