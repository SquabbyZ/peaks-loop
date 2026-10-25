// tests/unit/release/production-stryker-test-files.test.ts
//
// The rid-t6g-mut-builder-purity guard for the PUBLISHED package: a missing
// `--test-files` path must never reach Stryker, and the CLI is NOT the only
// way into the mutation pipeline.
//
// WHY IT LIVES HERE. `tests/unit/release/` already holds the mut package's own
// runtime guard (`mut-runtime-dependency.test.ts`), and it is a directory the
// affected-test classifier REACHES: `tests/unit/scripts/test-changed-guard-tier.test.ts`
// requires every directory under `tests/unit/` to be reachable by a rule or recorded
// in `UNREACHABLE_UNIT_DIRS`, so a new directory is a contract in its own right.
// A first version of this file lived in `tests/unit/mut/` and reddened that guard.
//
// WHY THIS FILE IS NOT THE CLI GUARD. `tests/unit/cli/mut-test-file-not-found.test.ts`
// proves the COMMAND refuses a missing test file. This file proves the
// LIBRARY refuses one: `runMutation()` with the production invoker, with no
// CLI anywhere in the path. A programmatic caller of the published
// `peaks-loop-mut` package never goes through `src/cli/`, so the CLI guard
// says nothing about it.
//
// WHY THE CHECK IS NOT IN THE OPTIONS BUILDER. `buildStrykerOptions()` is
// PURE — it never reads the file system, so it cannot know whether a path
// exists. Its own unit tests prove that: they run against a project root that
// does not exist (`C:/tmp/does-not-need-to-exist`). The check therefore sits
// at the layer that owns the Stryker call
// (`packages/peaks-loop-mut/src/services/mut/production-stryker.ts`).
//
// HOW "STRYKER WAS NEVER CALLED" IS MEASURED. `runInProject()` chdirs into
// the project IMMEDIATELY before it constructs Stryker, so a `process.chdir`
// spy is a faithful witness for "was the Stryker call site entered at all?".
// No module mocking is involved, and that matters: the package resolves
// `@stryker-mutator/core` from its OWN pnpm store entry, not from the root's
// devDependency, so `vi.mock('@stryker-mutator/core')` would not intercept
// the package's import. The control arm below proves the spy is not vacuous:
// with an EXISTING test file the same spy DOES fire.
//
// The fixture lives OUTSIDE the repository (`mkdtempSync` under `os.tmpdir()`):
// a temp directory nested inside the checkout is resolved up to the repository
// root by vitest / vite / tsconfig.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProductionStrykerInvoker, MutToolchainError, runMutation } from 'peaks-loop-mut';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/release/production-stryker-test-files.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The missing path, relative to the project root. */
const MISSING = 'tests/does-not-exist.test.ts';

/** The path that exists in the fixture, relative to the project root. */
const EXISTING = 'tests/add.test.ts';

/**
 * The marker only the chdir boundary can produce. The control arm throws it
 * from the spied `process.chdir`, which is the FIRST statement of the
 * Stryker call site — so seeing it proves the call site was entered, without
 * running a real mutation.
 */
const RUN_PHASE_MARKER = 'peaks-mut-run-phase-reached';

describe('peaks-loop-mut — the production invoker refuses a missing test file', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'peaks-mut-prod-'));
    mkdirSync(join(project, 'src'), { recursive: true });
    mkdirSync(join(project, 'tests'), { recursive: true });
    writeFileSync(
      join(project, 'src', 'add.ts'),
      'export const add = (a: number, b: number): number => a + b;\n'
    );
    writeFileSync(
      join(project, 'tests', 'add.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        "it('adds', () => {",
        '  expect(1).toBe(1);',
        '});',
        ''
      ].join('\n')
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // `maxRetries` because a fixture that a real Stryker run touched can still
    // be held open on Windows; the guard's own state never runs Stryker, so
    // this is only the safety net for the failure path.
    rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  describe('(behavior) — the programmatic entry point raises the named code', () => {
    it('when a caller runs a missing test file, should fail with MUT_TEST_FILE_NOT_FOUND', async () => {
      // given: a programmatic caller of the published package — no CLI in the path
      // when: it runs a mutation whose test file does not exist
      // then: the failure carries the named code, not the catch-all
      const invokeStryker = createProductionStrykerInvoker();

      await expect(
        runMutation({
          project,
          testFiles: [MISSING],
          mutate: ['src/add.ts'],
          invokeStryker
        })
      ).rejects.toMatchObject({ code: 'MUT_TEST_FILE_NOT_FOUND' });
    });

    it('when the test file is missing, should never reach the Stryker call site', async () => {
      // given: a spy on the CWD change that opens the Stryker call site
      // when: the production invoker is asked to run a missing test file
      // then: the call site was never entered, so Stryker never saw the path
      const chdir = vi.spyOn(process, 'chdir');
      const invokeStryker = createProductionStrykerInvoker();

      await expect(
        invokeStryker({ project, testFiles: [MISSING], mutate: ['src/add.ts'] })
      ).rejects.toThrow();
      expect(chdir).not.toHaveBeenCalled();
    });
  });

  describe('(integration) — the file system boundary is the real one', () => {
    it('when the test file exists, should reach the Stryker call site', async () => {
      // given: a spy that stops the run at the first statement of the call site
      // when: the production invoker runs an EXISTING test file
      // then: the call site WAS entered — the negative assertion above is real
      const originalChdir = process.chdir.bind(process);
      let seen = 0;
      const chdir = vi.spyOn(process, 'chdir').mockImplementation((directory: string) => {
        seen += 1;
        if (seen === 1) {
          throw new Error(RUN_PHASE_MARKER);
        }
        originalChdir(directory);
      });
      const invokeStryker = createProductionStrykerInvoker();

      const failure = await invokeStryker({
        project,
        testFiles: [EXISTING],
        mutate: ['src/add.ts']
      }).catch((err: unknown) => err);

      expect(chdir).toHaveBeenCalled();
      expect((failure as Error).message).toContain(RUN_PHASE_MARKER);
    });

    it('when the failure is raised, should carry the project root and the missing path', async () => {
      // given: a project whose test file does not exist
      // when: the production invoker is asked to run it
      // then: the machine-readable detail names the root and the path
      const invokeStryker = createProductionStrykerInvoker();

      const failure = await invokeStryker({
        project,
        testFiles: [MISSING],
        mutate: ['src/add.ts']
      }).catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(MutToolchainError);
      const details = (failure as MutToolchainError).details;
      expect(details.project).toBe(project);
      expect(details.missing).toEqual([MISSING]);
    });
  });

  describe('(render) — the machine-readable shape of the failure', () => {
    it('when the failure is raised, should carry exactly the named code', async () => {
      // given: a missing test file
      // when: the production invoker raises the failure
      // then: the code is the named one, never the catch-all or an unhandled error
      const invokeStryker = createProductionStrykerInvoker();

      const failure = await invokeStryker({
        project,
        testFiles: [MISSING],
        mutate: ['src/add.ts']
      }).catch((err: unknown) => err);

      const code = (failure as { code?: unknown }).code;
      expect(code).toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(code).not.toBe('MUT_FAILED');
      expect(code).not.toBe('UNHANDLED_ERROR');
    });
  });

  describe('(a11y) — the message a human reads', () => {
    it('when the failure is raised, should name the path relative to the project root', async () => {
      // given: a missing test file
      // when: the production invoker raises the failure
      // then: the message names the relative path and leaks no machine path
      const invokeStryker = createProductionStrykerInvoker();

      const failure = await invokeStryker({
        project,
        testFiles: [MISSING],
        mutate: ['src/add.ts']
      }).catch((err: unknown) => err);

      const message = (failure as Error).message;
      expect(message).toContain(MISSING);
      expect(message).not.toContain(project);
      expect(message).not.toContain('ENOENT');
    });

    it('when a near-miss exists, should offer it as a candidate', async () => {
      // given: a missing test file whose sibling exists
      // when: the production invoker raises the failure
      // then: the message offers the near miss, so the reader can fix the path
      const invokeStryker = createProductionStrykerInvoker();

      const failure = await invokeStryker({
        project,
        testFiles: [MISSING],
        mutate: ['src/add.ts']
      }).catch((err: unknown) => err);

      const message = (failure as Error).message;
      expect(message).toContain('Near-miss candidates');
      expect(message).toContain(EXISTING);
    });
  });
});
