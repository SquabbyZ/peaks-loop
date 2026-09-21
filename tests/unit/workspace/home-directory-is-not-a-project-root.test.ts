/**
 * `resolveCanonicalProjectRoot` is fail-open by design: when it can find no
 * project marker it returns the start path unchanged ("better to write to the
 * cwd than to refuse the command"). A fresh terminal's cwd IS `$HOME`, so
 * `--project .` there resolved to the user's home — and every write that
 * followed landed in it. Observed: `peaks workspace init --project .` from
 * `$HOME` created `.peaks/`, `.gitignore`, `.codegraph/` and, worst,
 * `.claude/settings.local.json` in the user's home directory, which is a live
 * config file shared by every project on the machine.
 *
 * The refusal is the write path's, not the resolver's: 85 call sites use the
 * fail-open helper, most of them reads, and refusing inside it would break
 * `peaks status` / `peaks dashboard` / `peaks memory` the moment someone runs
 * them from their home directory. These cases pin the write-path guard, and pin
 * that it is EXACT-home only — `~/my-project` is an ordinary project.
 *
 * Run with: pnpm vitest run tests/unit/workspace/home-directory-is-not-a-project-root.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  UnsafeProjectRootError,
  assertWritableProjectRoot,
  isUserHomeProjectRoot,
  resolveWritableProjectRoot
} from '~/src/services/config/config-safety';

describe('the user’s home directory is never a writable project root', () => {
  it('when the path IS the home directory, should refuse it', () => {
    // given: the home directory itself
    const home = homedir();
    // when/then: the predicate says so, and the assert throws a typed error
    expect(isUserHomeProjectRoot(home)).toBe(true);
    expect(() => assertWritableProjectRoot(home)).toThrow(UnsafeProjectRootError);
  });

  it('when the home directory is spelled differently, should still refuse it', () => {
    // given: the same directory written the other way. Separator folding applies
    //        on every platform (`normalizePath`); case folding is Windows-only
    //        (`projectRootCompareKey`), so the case variant is asserted there
    //        and only there — a case-variant expectation on Linux would be
    //        testing a rule the code does not claim.
    const spellings = [homedir().replace(/\\/g, '/')];
    if (process.platform === 'win32') spellings.push(homedir().toUpperCase());
    // when/then: every spelling is recognized as the home directory
    for (const spelling of spellings) {
      expect(isUserHomeProjectRoot(spelling), `spelling "${spelling}" not recognized`).toBe(true);
    }
  });

  it('when the project is INSIDE the home directory, should allow it', () => {
    // given: `~/my-project` — an ordinary project, and the case where a
    //        too-eager guard would do harm
    const project = join(homedir(), 'my-project');
    // when/then: neither the predicate nor the assert touches it
    expect(isUserHomeProjectRoot(project)).toBe(false);
    expect(() => assertWritableProjectRoot(project)).not.toThrow();
  });

  it('when the project is a sibling of the home directory, should allow it', () => {
    // given: a directory outside home entirely
    const sibling = resolve(homedir(), '..', 'some-other-project');
    // when/then
    expect(isUserHomeProjectRoot(sibling)).toBe(false);
    expect(() => assertWritableProjectRoot(sibling)).not.toThrow();
  });

  it(
    'when resolving for a write, should refuse a start path that resolves to home',
    () => {
      // given: the exact CLI shape of the incident — `--project .` with cwd=$HOME
      // when/then: the WRITE resolver refuses what the read resolver returns
      expect(() => resolveWritableProjectRoot(homedir())).toThrow(UnsafeProjectRootError);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when resolving for a write, should return the same root as the read resolver otherwise',
    () => {
      // given: an ordinary directory that is not the home directory
      const project = mkdtempSync(join(tmpdir(), 'peaks-writable-root-'));
      try {
        // when/then: the guarded helper is the unguarded one plus the refusal —
        //            it must not otherwise change the answer (no demotion, no
        //            extra canonicalisation)
        expect(resolveWritableProjectRoot(project)).toBe(resolve(project));
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
