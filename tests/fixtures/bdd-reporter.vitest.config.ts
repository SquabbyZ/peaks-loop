// tests/fixtures/bdd-reporter.vitest.config.ts
//
// Config for the nested vitest run that `tests/unit/reporters/bdd-reporter.test.ts`
// spawns against its own generated fixture files.
//
// Why a second config exists at all: those fixtures must NOT match the
// project's unit include glob (`tests/unit/**/*.test.ts`). While they did,
// vitest's collector — which globs once at run start and imports each file
// seconds later — could enumerate a fixture that the test's `afterEach` had
// already deleted, and fail the whole suite with `Cannot find module` for a
// file that no longer existed. `tsc` reads the same tree, so a fixture deleted
// mid-type-check aborted the program with a lone `TS6053`.
//
// Pointing the nested run at this config is what lets the fixtures live
// outside that glob and still be discovered. `root` is this directory, so
// `include` is resolved against it and matches only the reporter fixtures.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(dirname(fileURLToPath(import.meta.url))),
  test: {
    include: ['bdd-reporter-tmp/**/*.test.ts']
  }
});
